import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { query } from '../config/database';
import { b2Storage } from './b2Storage.service';

const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/3gpp',
  'video/avi',
  'video/x-msvideo',
  'video/x-m4v',
  'video/m4v'
];

const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm', '.3gp', '.avi', '.m4v'];
const MAX_VIDEO_SIZE_BYTES = (env.maxFileSizeMb || 50) * 1024 * 1024; // 50 MB

export interface VideoValidationResult {
  valid: boolean;
  error?: string;
  extension: string;
  mimeType: string;
}

export class VideoStorageService {
  private client: SupabaseClient | null = null;
  private bucketName: string;

  constructor() {
    this.bucketName = 'reels-videos';
    this.initClient();
  }

  private initClient(): void {
    if (env.supabaseUrl && env.supabaseServiceRoleKey) {
      try {
        this.client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        logger.info(`[VideoStorage] Supabase client initialized for bucket '${this.bucketName}'`);
      } catch (err: any) {
        logger.error('[VideoStorage] Failed to initialize Supabase client:', err.message);
      }
    } else {
      logger.info('[VideoStorage] Supabase credentials not present; using persistent PostgreSQL video blobs table.');
    }
  }

  /**
   * Validate uploaded video buffer, size, MIME type and magic bytes
   */
  validateVideo(file: Express.Multer.File): VideoValidationResult {
    if (!file || !file.buffer || file.buffer.length === 0) {
      return { valid: false, error: 'No video file provided.', extension: '', mimeType: '' };
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      return {
        valid: false,
        error: `Video exceeds maximum allowed size of ${env.maxFileSizeMb || 50} MB.`,
        extension: '',
        mimeType: ''
      };
    }

    const buf = file.buffer;
    let detectedMime = '';
    let detectedExt = '';

    const rawMime = (file.mimetype || '').toLowerCase();
    const rawExt = path.extname(file.originalname || '').toLowerCase();

    // Check for MP4 / MOV / M4V ftyp box (bytes 4..7 === 'ftyp')
    if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buf.length >= 12 ? buf.toString('ascii', 8, 12) : '';
      if (brand.startsWith('qt')) {
        detectedMime = 'video/quicktime';
        detectedExt = '.mov';
      } else if (rawExt === '.m4v' || brand.toLowerCase().includes('m4v')) {
        detectedMime = 'video/x-m4v';
        detectedExt = '.m4v';
      } else {
        detectedMime = 'video/mp4';
        detectedExt = '.mp4';
      }
    } else if (buf.length >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
      // EBML header (WebM or MKV)
      detectedMime = 'video/webm';
      detectedExt = '.webm';
    } else if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'AVI ') {
      detectedMime = 'video/avi';
      detectedExt = '.avi';
    }

    const isMimeAllowed = ALLOWED_VIDEO_MIME_TYPES.some(m => rawMime.includes(m.replace('video/', '')));
    const isExtAllowed = ALLOWED_VIDEO_EXTENSIONS.includes(rawExt);

    if (!detectedMime && !isMimeAllowed && !isExtAllowed) {
      return {
        valid: false,
        error: 'Unsupported video format. Please upload an authentic MP4, MOV, M4V, or WEBM video.',
        extension: '',
        mimeType: ''
      };
    }

    const finalMime = detectedMime || (isMimeAllowed ? rawMime : 'video/mp4');
    const finalExt = detectedExt || (isExtAllowed ? rawExt : '.mp4');

    return {
      valid: true,
      extension: finalExt,
      mimeType: finalMime
    };
  }

  /**
   * Upload video to persistent storage (Backblaze B2 primary + PostgreSQL video_blobs fallback)
   */
  async uploadVideo(file: Express.Multer.File, userId: string): Promise<{
    videoUrl: string;
    filename: string;
    fileSize: number;
    mimeType: string;
    storageProvider?: 'B2' | 'LOCAL';
  }> {
    const validation = this.validateVideo(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueFilename = `reel_${cleanUserId}_${Date.now()}_${uuidv4().slice(0, 8)}${validation.extension}`;
    const fileSize = file.size || file.buffer.length;
    const mimeType = validation.mimeType;
    const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://seerat-backend.onrender.com' : `http://localhost:${env.port}`);
    const videoUrl = `${baseUrl}/api/uploads/videos/${uniqueFilename}`;

    // 1. Primary: Backblaze B2 Storage (Zero database egress, zero local disk loss)
    if (b2Storage.isConfigured()) {
      const b2Key = `videos/${uniqueFilename}`;
      try {
        await b2Storage.uploadVideo(file.buffer, mimeType, b2Key);
        logger.info(`[VideoStorage] Video stored successfully in B2 (${b2Key}). Public URL: ${videoUrl}`);
        return {
          videoUrl,
          filename: uniqueFilename,
          fileSize,
          mimeType,
          storageProvider: 'B2'
        };
      } catch (b2Err: any) {
        logger.error(`[VideoStorage] B2 upload failed: ${b2Err.message}`);
        throw new Error('Failed to upload video to media storage. Please try again.');
      }
    }

    // 2. Fallback: Persistent PostgreSQL BYTEA storage (Used when B2 is unconfigured in dev)
    logger.info(`[VideoStorage] B2 unconfigured. Storing video ${uniqueFilename} (${(fileSize / (1024 * 1024)).toFixed(2)} MB) in PostgreSQL video_blobs...`);
    const blobId = uuidv4();
    await query(
      `INSERT INTO video_blobs (id, filename, mime_type, file_size, video_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (filename) DO UPDATE
       SET video_data = EXCLUDED.video_data, file_size = EXCLUDED.file_size, mime_type = EXCLUDED.mime_type`,
      [blobId, uniqueFilename, mimeType, fileSize, file.buffer]
    );

    logger.info(`[VideoStorage] Video stored successfully in PostgreSQL video_blobs. Public URL: ${videoUrl}`);
    return {
      videoUrl,
      filename: uniqueFilename,
      fileSize,
      mimeType,
      storageProvider: 'LOCAL'
    };
  }

  /**
   * Stream video byte range from PostgreSQL video_blobs
   */
  async getVideoChunk(filename: string, start: number, length: number): Promise<{
    chunk: Buffer;
    totalSize: number;
    mimeType: string;
  } | null> {
    // Note: In PostgreSQL substring(bytea from start for count) is 1-indexed
    const sqlStart = start + 1;
    const result = await query(
      `SELECT file_size, mime_type, substring(video_data FROM $1 FOR $2) as chunk
       FROM video_blobs
       WHERE filename = $3`,
      [sqlStart, length, filename]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      chunk: row.chunk,
      totalSize: parseInt(row.file_size, 10),
      mimeType: row.mime_type || 'video/mp4'
    };
  }

  /**
   * Get total video metadata (size, mime) without reading full buffer into memory
   */
  async getVideoMetadata(filename: string): Promise<{
    totalSize: number;
    mimeType: string;
  } | null> {
    const result = await query(
      `SELECT file_size, mime_type FROM video_blobs WHERE filename = $1`,
      [filename]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      totalSize: parseInt(result.rows[0].file_size, 10),
      mimeType: result.rows[0].mime_type || 'video/mp4'
    };
  }

  /**
   * Upload thumbnail image to Backblaze B2 (or persistent fallback)
   */
  async uploadThumbnail(file: Express.Multer.File | { buffer: Buffer; mimetype?: string; originalname?: string }, userId: string): Promise<{
    thumbnailUrl: string;
    filename: string;
    fileSize: number;
    mimeType: string;
  }> {
    const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const mimeType = file.mimetype || 'image/jpeg';
    const ext = mimeType.includes('webp') ? '.webp' : mimeType.includes('png') ? '.png' : '.jpg';
    const uniqueFilename = `thumb_${cleanUserId}_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
    const buffer = file.buffer;
    const fileSize = buffer.length;
    const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://seerat-backend.onrender.com' : `http://localhost:${env.port}`);
    const thumbnailUrl = `${baseUrl}/api/uploads/thumbnails/${uniqueFilename}`;

    if (b2Storage.isConfigured()) {
      const b2Key = `thumbnails/${uniqueFilename}`;
      try {
        await b2Storage.uploadThumbnail(buffer, mimeType, b2Key);
        logger.info(`[VideoStorage] Thumbnail stored successfully in B2 (${b2Key}). Public URL: ${thumbnailUrl}`);
        return {
          thumbnailUrl,
          filename: uniqueFilename,
          fileSize,
          mimeType
        };
      } catch (b2Err: any) {
        logger.error(`[VideoStorage] B2 thumbnail upload failed: ${b2Err.message}`);
      }
    }

    // Fallback: save to video_blobs
    const blobId = uuidv4();
    await query(
      `INSERT INTO video_blobs (id, filename, mime_type, file_size, video_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (filename) DO UPDATE
       SET video_data = EXCLUDED.video_data, file_size = EXCLUDED.file_size, mime_type = EXCLUDED.mime_type`,
      [blobId, uniqueFilename, mimeType, fileSize, buffer]
    );

    return {
      thumbnailUrl,
      filename: uniqueFilename,
      fileSize,
      mimeType
    };
  }
}

export const videoStorage = new VideoStorageService();
