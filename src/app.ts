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
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await query('SELECT 1 as healthy');
    let adminsCount = 0;
    let adminAccounts: any[] = [];

    try {
      const adminCheck = await query(`
        SELECT id, name, email, role, status, 
               (password_hash IS NOT NULL AND (password_hash LIKE '$2a$%' OR password_hash LIKE '$2b$%' OR password_hash LIKE '$2y$%') AND LENGTH(password_hash) = 60) as has_valid_bcrypt_hash,
               created_at
        FROM admin_users
        ORDER BY created_at ASC
      `);
      adminsCount = adminCheck.rows.length;
      adminAccounts = adminCheck.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        status: r.status,
        has_valid_bcrypt_hash: r.has_valid_bcrypt_hash,
        created_at: r.created_at
      }));
    } catch (adminErr: any) {
      // Table might not exist yet
    }

    let dbHost = 'unknown';
    try {
      const parsed = new URL(process.env.DATABASE_URL || '');
      dbHost = parsed.hostname;
    } catch {}

    ResponseUtil.success(res, {
      status: 'healthy',
      database: 'connected',
      db_host: dbHost,
      admins_count: adminsCount,
      admin_accounts: adminAccounts,
      storage: {
        has_supabase_url: !!process.env.SUPABASE_URL,
        has_supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        supabase_url: env.supabaseUrl || 'not-set',
        bucket: env.supabaseStorageBucket
      },
      timestamp: new Date()
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

// Public endpoint for video streaming with full HTTP Range (206 Partial Content) support
app.get('/api/uploads/videos/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);

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

      // Default chunk size is 2MB or remaining file size
      let end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + (2 * 1024 * 1024) - 1, totalSize - 1);
      if (end >= totalSize) {
        end = totalSize - 1;
      }

      if (isNaN(start) || start >= totalSize || start < 0 || start > end) {
        res.status(416).set('Content-Range', `bytes */${totalSize}`).send();
        return;
      }

      const chunkSize = (end - start) + 1;
      // PostgreSQL substring is 1-indexed
      const sqlStart = start + 1;

      const chunkResult = await query(
        'SELECT substring(video_data FROM $1 FOR $2) as chunk FROM video_blobs WHERE filename = $3',
        [sqlStart, chunkSize, cleanFilename]
      );

      if (!chunkResult.rows.length || !chunkResult.rows[0].chunk) {
        return res.status(404).json({ success: false, message: 'Video chunk not found' });
      }

      const chunk = chunkResult.rows[0].chunk;

      res.status(206);
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunk.length.toString(),
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      res.send(chunk);
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
