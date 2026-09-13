import express, { Express } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import adminRouter from './routes/index';
import { mobileRouter } from './routes/mobile.routes';
import { apiRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { env } from './config/env';
import { logger } from './utils/logger';
import { query } from './config/database';
import { ResponseUtil } from './utils/response';
import { fcmService } from './services/fcm.service';
import { b2Storage } from './services/b2Storage.service';
import { getDefaultThumbnailBuffer } from './assets/defaultThumbnail';

const app: Express = express();

// Security Headers - explicitly allow cross-origin media access
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

// CORS Policy with Range headers support
app.use(cors({
  origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length']
}));

// Request Logging
app.use(morgan('combined', { stream: { write: (msg: string) => logger.info(msg.trim()) } }));

// Rate Limiting
app.use('/api/', apiRateLimiter);

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1 as healthy');

    ResponseUtil.success(res, {
      status: 'healthy',
      database: 'connected',
      b2: {
        is_configured: b2Storage.isConfigured(),
        bucket: env.b2BucketName
      }
    });
  } catch (err: any) {
    ResponseUtil.error(res, 'DB_ERROR', 'Database connectivity error', 500, err.message);
  }
});

// Public endpoint to serve uploaded profile photos (from persistent PostgreSQL storage)
app.get('/api/uploads/profile-photos/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);
    const result = await query(
      'SELECT mime_type, image_data FROM profile_photo_blobs WHERE filename = $1',
      [cleanFilename]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Photo not found' });
    }
    const { mime_type, image_data } = result.rows[0];
    res.set('Content-Type', mime_type || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.send(image_data);
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving photo' });
  }
});

// Public endpoint to serve lightweight thumbnail images (prevents Coil from downloading full MP4s)
app.get('/api/uploads/thumbnails/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);

    // Default / fallback branded thumbnail
    if (cleanFilename === 'default.jpg' || cleanFilename === 'default.png' || cleanFilename.startsWith('default')) {
      const buffer = getDefaultThumbnailBuffer();
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*'
      });
      return res.send(buffer);
    }

    // Check if thumbnail exists in Backblaze B2
    if (b2Storage.isConfigured()) {
      const b2Key = `thumbnails/${cleanFilename}`;
      const hasThumb = await b2Storage.hasObject(b2Key);
      if (hasThumb) {
        const streamed = await b2Storage.streamObject(b2Key, undefined, res);
        if (streamed) {
          return;
        }
      }
    }

    // Fallback: Return branded lightweight Islamic poster image
    const fallbackBuffer = getDefaultThumbnailBuffer();
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*'
    });
    return res.send(fallbackBuffer);
  } catch (err: any) {
    logger.error(`Error retrieving thumbnail ${req.params.filename}:`, err.message);
    const fallbackBuffer = getDefaultThumbnailBuffer();
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*'
    });
    res.send(fallbackBuffer);
  }
});

// Public endpoint for video streaming with full HTTP Range (206 Partial Content) support
app.get('/api/uploads/videos/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);

    // 1. Primary: Stream directly from Backblaze B2 if object exists (Zero Supabase database egress)
    if (b2Storage.isConfigured()) {
      const b2Key = `videos/${cleanFilename}`;
      const existsInB2 = await b2Storage.hasObject(b2Key);
      if (existsInB2) {
        const streamed = await b2Storage.streamObject(b2Key, req.headers.range, res);
        if (streamed) {
          return;
        }
      }
    }

    // 2. Legacy Fallback: Stream from PostgreSQL video_blobs table
    const metaResult = await query(
      'SELECT file_size, mime_type FROM video_blobs WHERE filename = $1',
      [cleanFilename]
    );

    if (!metaResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Video file not found' });
    }

    const totalSize = parseInt(metaResult.rows[0].file_size, 10);
    const mimeType = metaResult.rows[0].mime_type || 'video/mp4';

    const range = req.headers.range;

    if (range) {
      // Byte Range Request (ExoPlayer & HTML5 video seek/stream)
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);

      // If client specified an explicit end, use it; otherwise stream to end of file
      let end: number;
      if (parts[1] && parts[1].trim() !== '') {
        end = parseInt(parts[1], 10);
      } else {
        end = totalSize - 1;
      }
      if (end >= totalSize) {
        end = totalSize - 1;
      }

      if (isNaN(start) || start >= totalSize || start < 0 || start > end) {
        res.status(416).set('Content-Range', `bytes */${totalSize}`).send();
        return;
      }

      const totalBytesToSend = (end - start) + 1;

      res.status(206);
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': totalBytesToSend.toString(),
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });

      // Stream in 1MB chunks to keep memory usage low while streaming complete range
      const CHUNK_SIZE = 1024 * 1024; // 1 MB
      let current = start;
      let isAborted = false;

      req.on('close', () => {
        isAborted = true;
      });

      while (current <= end && !isAborted && !res.writableEnded) {
        const nextLen = Math.min(CHUNK_SIZE, (end - current) + 1);
        const sqlStart = current + 1; // PostgreSQL substring is 1-indexed

        const chunkResult = await query(
          'SELECT substring(video_data FROM $1 FOR $2) as chunk FROM video_blobs WHERE filename = $3',
          [sqlStart, nextLen, cleanFilename]
        );

        if (!chunkResult.rows.length || !chunkResult.rows[0].chunk) {
          break;
        }

        const chunk = chunkResult.rows[0].chunk;
        const canContinue = res.write(chunk);
        if (!canContinue && !isAborted) {
          await new Promise<void>((resolve) => {
            res.once('drain', () => resolve());
            req.once('close', () => resolve());
          });
        }
        current += nextLen;
      }

      if (!res.writableEnded) {
        res.end();
      }
    } else {
      // Full Video Request
      const fullResult = await query(
        'SELECT video_data FROM video_blobs WHERE filename = $1',
        [cleanFilename]
      );

      if (!fullResult.rows.length) {
        return res.status(404).json({ success: false, message: 'Video not found' });
      }

      res.status(200);
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Length': totalSize.toString(),
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      res.send(fullResult.rows[0].video_data);
    }
  } catch (err: any) {
    logger.error(`Error streaming video ${req.params.filename}:`, err.message);
    res.status(500).json({ success: false, message: 'Error streaming video' });
  }
});

// Mount Admin REST API
app.use('/api/admin', adminRouter);

// Mount Mobile App REST API
app.use('/api', mobileRouter);

// Centralized Error Handling
app.use(errorHandler);

export default app;
