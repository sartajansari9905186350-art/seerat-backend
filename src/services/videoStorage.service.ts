import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { query } from '../config/database';

const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime', // MOV
  'video/x-matroska', // MKV
  'video/webm',
  'video/3gpp',
  'video/avi',
  'video/x-msvideo'
];

const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm', '.3gp', '.avi'];
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

    // Check for MP4 / MOV ftyp box (bytes 4..7 === 'ftyp')
    if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buf.length >= 12 ? buf.toString('ascii', 8, 12) : '';
      if (brand.startsWith('qt')) {
        detectedMime = 'video/quicktime';
        detectedExt = '.mov';
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

    const rawMime = (file.mimetype || '').toLowerCase();
    const rawExt = path.extname(file.originalname || '').toLowerCase();

    const isMimeAllowed = ALLOWED_VIDEO_MIME_TYPES.some(m => rawMime.includes(m.replace('video/', '')));
    const isExtAllowed = ALLOWED_VIDEO_EXTENSIONS.includes(rawExt);

    if (!detectedMime && !isMimeAllowed && !isExtAllowed) {
      return {
        valid: false,
        error: 'Unsupported video format. Please upload an authentic MP4, MOV, or WEBM video.',
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
   * Upload video to persistent storage (PostgreSQL video_blobs + Supabase Storage fallback)
   */
  async uploadVideo(file: Express.Multer.File, userId: string): Promise<{
    videoUrl: string;
    filename: string;
    fileSize: number;
    mimeType: string;
  }> {
    const validation = this.validateVideo(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueFilename = `reel_${cleanUserId}_${Date.now()}_${uuidv4().slice(0, 8)}${validation.extension}`;
    const fileSize = file.size || file.buffer.length;
    const mimeType = validation.mimeType;

    // 1. If Supabase is configured and has key, attempt Supabase Storage
    if (this.client && env.supabaseServiceRoleKey) {
      try {
        const storagePath = `reels/${cleanUserId}/${uniqueFilename}`;
        const { error: uploadError } = await this.client.storage
          .from(this.bucketName)
          .upload(storagePath, file.buffer, {
            contentType: mimeType,
            cacheControl: '31536000',
            upsert: true
          });

        if (!uploadError) {
          const { data: publicUrlData } = this.client.storage
            .from(this.bucketName)
            .getPublicUrl(storagePath);

          if (publicUrlData?.publicUrl) {
            logger.info(`[VideoStorage] Video uploaded to Supabase Storage: ${storagePath}`);
            return {
              videoUrl: publicUrlData.publicUrl,
              filename: uniqueFilename,
              fileSize,
              mimeType
            };
          }
        }
      } catch (sbErr: any) {
        logger.warn(`[VideoStorage] Supabase upload error: ${sbErr.message}, storing in PostgreSQL video_blobs...`);
      }
    }

    // 2. Persistent PostgreSQL BYTEA storage (Zero data loss on Render ephemeral dynos)
    logger.info(`[VideoStorage] Storing video ${uniqueFilename} (${(fileSize / (1024 * 1024)).toFixed(2)} MB) in PostgreSQL video_blobs...`);
    const blobId = uuidv4();
    await query(
      `INSERT INTO video_blobs (id, filename, mime_type, file_size, video_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (filename) DO UPDATE
       SET video_data = EXCLUDED.video_data, file_size = EXCLUDED.file_size, mime_type = EXCLUDED.mime_type`,
      [blobId, uniqueFilename, mimeType, fileSize, file.buffer]
    );

    const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://seerat-backend.onrender.com' : `http://localhost:${env.port}`);
    const videoUrl = `${baseUrl}/api/uploads/videos/${uniqueFilename}`;

    logger.info(`[VideoStorage] Video stored successfully. Public URL: ${videoUrl}`);
    return {
      videoUrl,
      filename: uniqueFilename,
      fileSize,
      mimeType
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
}

export const videoStorage = new VideoStorageService();
