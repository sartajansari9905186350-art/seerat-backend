import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { query } from '../config/database';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/pjpeg', 'image/x-png'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export class SupabaseStorageService {
  private client: SupabaseClient | null = null;
  private bucketName: string;
  private isBucketEnsured: boolean = false;

  constructor() {
    this.bucketName = env.supabaseStorageBucket || 'profile-photos';
    this.initClient();
  }

  private initClient(): void {
    if (env.supabaseUrl && env.supabaseServiceRoleKey) {
      try {
        this.client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        });
        logger.info(`[SupabaseStorage] Client initialized for URL: ${env.supabaseUrl} (Bucket: ${this.bucketName})`);
      } catch (err: any) {
        logger.error('[SupabaseStorage] Failed to initialize Supabase client:', err.message);
      }
    } else {
      logger.warn('[SupabaseStorage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Storage operations will use database persistent storage fallback.');
    }
  }

  /**
   * Automatically ensure bucket exists and has public read access
   */
  async ensureBucket(): Promise<boolean> {
    if (!this.client) {
      this.initClient();
      if (!this.client) return false;
    }

    if (this.isBucketEnsured) return true;

    try {
      const { data: buckets, error: listError } = await this.client.storage.listBuckets();
      if (listError) {
        logger.warn('[SupabaseStorage] Could not list buckets:', listError.message);
        return false;
      }

      const existing = buckets?.find((b: any) => b.name === this.bucketName || b.id === this.bucketName);
      if (!existing) {
        logger.info(`[SupabaseStorage] Creating public bucket '${this.bucketName}'...`);
        const { error: createError } = await this.client.storage.createBucket(this.bucketName, {
          public: true,
          fileSizeLimit: MAX_FILE_SIZE_BYTES,
          allowedMimeTypes: ALLOWED_MIME_TYPES
        });
        if (createError) {
          logger.error(`[SupabaseStorage] Failed to create bucket '${this.bucketName}':`, createError.message);
          return false;
        }
        logger.info(`[SupabaseStorage] Bucket '${this.bucketName}' created successfully.`);
      }

      this.isBucketEnsured = true;
      return true;
    } catch (err: any) {
      logger.error('[SupabaseStorage] Bucket verification failed:', err.message);
      return false;
    }
  }

  /**
   * Validate file buffer, MIME type, and size
   */
  validateFile(file: Express.Multer.File): { valid: boolean; error?: string; extension: string } {
    if (!file || !file.buffer || !file.buffer.length) {
      return { valid: false, error: 'No image file uploaded.', extension: '' };
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: 'Profile photo exceeds maximum allowed size of 5 MB.', extension: '' };
    }

    const buf = file.buffer;
    let detectedExt = '';

    // Verify magic bytes for real image integrity
    if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      detectedExt = '.jpg';
    } else if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      detectedExt = '.png';
    } else if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      detectedExt = '.webp';
    }

    const mime = (file.mimetype || '').toLowerCase();
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const isMimeValid = ALLOWED_MIME_TYPES.some(m => mime.includes(m.replace('image/', '')));
    const isExtValid = ALLOWED_EXTENSIONS.includes(rawExt);

    if (!detectedExt && !isMimeValid && !isExtValid) {
      return { valid: false, error: 'Unsupported file type. Please upload a JPG, JPEG, PNG, or WEBP image.', extension: '' };
    }

    const finalExt = detectedExt || (isExtValid ? rawExt : (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg'));
    return { valid: true, extension: finalExt };
  }

  /**
   * Upload profile photo to Supabase Storage (or persistent DB storage fallback)
   * Returns the permanent public URL
   */
  async uploadProfilePhoto(
    file: Express.Multer.File,
    entityType: 'users' | 'admins',
    entityId: string
  ): Promise<string> {
    // 1. Validation
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const cleanEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueFilename = `${uuidv4()}_${Date.now()}${validation.extension}`;

    // 2. If Supabase is configured, use Supabase Storage
    if (this.client && env.supabaseServiceRoleKey) {
      try {
        await this.ensureBucket();
        const storagePath = `${entityType}/${cleanEntityId}/${uniqueFilename}`;
        const { error: uploadError } = await this.client.storage
          .from(this.bucketName)
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype || 'image/jpeg',
            cacheControl: '3600',
            upsert: true
          });

        if (!uploadError) {
          const { data: publicUrlData } = this.client.storage
            .from(this.bucketName)
            .getPublicUrl(storagePath);

          if (publicUrlData?.publicUrl) {
            logger.info(`[SupabaseStorage] Successfully uploaded ${storagePath} to Supabase bucket '${this.bucketName}'`);
            return publicUrlData.publicUrl;
          }
        } else {
          logger.warn(`[SupabaseStorage] Supabase upload failed (${uploadError.message}), falling back to persistent DB storage...`);
        }
      } catch (sbErr: any) {
        logger.warn(`[SupabaseStorage] Exception during Supabase upload (${sbErr.message}), falling back to persistent DB storage...`);
      }
    }

    // 3. Fallback: Persistent PostgreSQL BYTEA storage (zero ephemeral disk loss, zero base64 in users table)
    logger.info(`[Storage] Saving photo ${uniqueFilename} to PostgreSQL persistent blobs table...`);
    const blobId = uuidv4();
    await query(
      `INSERT INTO profile_photo_blobs (id, entity_type, entity_id, filename, mime_type, image_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (filename) DO UPDATE
       SET image_data = EXCLUDED.image_data, mime_type = EXCLUDED.mime_type`,
      [blobId, entityType, cleanEntityId, uniqueFilename, file.mimetype || 'image/jpeg', file.buffer]
    );

    const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://seerat-backend.onrender.com' : `http://localhost:${env.port}`);
    const publicUrl = `${baseUrl}/api/uploads/profile-photos/${uniqueFilename}`;
    logger.info(`[Storage] Photo stored successfully. Public URL: ${publicUrl}`);
    return publicUrl;
  }

  /**
   * Delete old profile photo from Supabase Storage or PostgreSQL blobs table
   */
  async deleteProfilePhoto(photoUrl?: string | null): Promise<void> {
    if (!photoUrl) return;

    try {
      // 1. If stored in DB blobs table
      if (photoUrl.includes('/api/uploads/profile-photos/')) {
        const filename = path.basename(photoUrl.split('?')[0]);
        if (filename) {
          await query(`DELETE FROM profile_photo_blobs WHERE filename = $1`, [filename]);
          logger.info(`[Storage] Deleted old photo blob: ${filename}`);
        }
        return;
      }

      // 2. If stored in Supabase Storage
      if (this.client && photoUrl.includes(this.bucketName)) {
        const parts = photoUrl.split(`/${this.bucketName}/`);
        if (parts.length >= 2) {
          const storagePath = decodeURIComponent(parts[1].split('?')[0]);
          if (storagePath) {
            const { error } = await this.client.storage.from(this.bucketName).remove([storagePath]);
            if (!error) {
              logger.info(`[SupabaseStorage] Removed old photo from Supabase bucket: ${storagePath}`);
            }
          }
        }
      }
    } catch (err: any) {
      logger.warn('[Storage] Delete error (ignored):', err.message);
    }
  }
}

export const supabaseStorage = new SupabaseStorageService();
