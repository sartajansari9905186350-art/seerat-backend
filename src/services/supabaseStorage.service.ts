import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
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
      logger.warn('[SupabaseStorage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Storage operations will require credentials.');
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
    if (!file || !file.buffer) {
      return { valid: false, error: 'No image file uploaded.', extension: '' };
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: 'File size exceeds 5 MB limit. Please select a smaller photo.', extension: '' };
    }

    const mime = file.mimetype.toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      return { valid: false, error: 'Unsupported file type. Please upload a JPG, JPEG, PNG, or WEBP image.', extension: '' };
    }

    // Determine safe extension from original name or MIME
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    let ext = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : '';
    if (!ext) {
      if (mime === 'image/jpeg' || mime === 'image/jpg') ext = '.jpg';
      else if (mime === 'image/png') ext = '.png';
      else if (mime === 'image/webp') ext = '.webp';
      else ext = '.jpg';
    }

    return { valid: true, extension: ext };
  }

  /**
   * Upload profile photo to Supabase Storage
   * Returns the permanent public CDN URL
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

    // 2. Client verification
    if (!this.client) {
      this.initClient();
      if (!this.client) {
        throw new Error('Supabase Storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render environment.');
      }
    }

    await this.ensureBucket();

    // 3. Generate safe path without trusting original filename
    // Logical structure: profile-photos/{entityType}/{entityId}/{uuid}.{ext}
    const cleanEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueFilename = `${uuidv4()}_${Date.now()}${validation.extension}`;
    const storagePath = `${entityType}/${cleanEntityId}/${uniqueFilename}`;

    // 4. Upload buffer to Supabase Storage
    const { error: uploadError } = await this.client.storage
      .from(this.bucketName)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      logger.error(`[SupabaseStorage] Upload error for ${storagePath}:`, uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // 5. Retrieve Public URL
    const { data: publicUrlData } = this.client.storage
      .from(this.bucketName)
      .getPublicUrl(storagePath);

    if (!publicUrlData?.publicUrl) {
      throw new Error('Failed to generate public URL for uploaded photo.');
    }

    return publicUrlData.publicUrl;
  }

  /**
   * Delete old profile photo from Supabase Storage if it belongs to our bucket
   */
  async deleteProfilePhoto(photoUrl?: string | null): Promise<void> {
    if (!photoUrl || !this.client) return;

    try {
      // Check if URL belongs to Supabase Storage
      if (!photoUrl.includes(this.bucketName)) return;

      // Extract storage path from URL
      // e.g. https://.../storage/v1/object/public/profile-photos/users/123/file.jpg
      const parts = photoUrl.split(`/${this.bucketName}/`);
      if (parts.length < 2) return;

      const storagePath = decodeURIComponent(parts[1].split('?')[0]);
      if (!storagePath) return;

      const { error } = await this.client.storage.from(this.bucketName).remove([storagePath]);
      if (error) {
        logger.warn(`[SupabaseStorage] Failed to delete previous image ${storagePath}:`, error.message);
      } else {
        logger.info(`[SupabaseStorage] Removed old photo from storage: ${storagePath}`);
      }
    } catch (err: any) {
      logger.warn('[SupabaseStorage] Delete error (ignored):', err.message);
    }
  }
}

export const supabaseStorage = new SupabaseStorageService();
