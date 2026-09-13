import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Response } from 'express';
import { Readable } from 'stream';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export class B2StorageService {
  private s3Client: S3Client | null = null;
  private bucketName: string;
  private endpoint: string;
  private region: string;

  constructor() {
    this.bucketName = env.b2BucketName || 'seerat-media';
    this.endpoint = env.b2Endpoint || 'https://s3.us-east-005.backblazeb2.com';
    this.region = env.b2Region || 'us-east-005';
    this.initClient();
  }

  private initClient(): void {
    if (env.b2ApplicationKeyId && env.b2ApplicationKey) {
      try {
        this.s3Client = new S3Client({
          endpoint: this.endpoint,
          region: this.region,
          credentials: {
            accessKeyId: env.b2ApplicationKeyId,
            secretAccessKey: env.b2ApplicationKey
          },
          forcePathStyle: true
        });
        logger.info(`[B2Storage] Client initialized for bucket '${this.bucketName}' on endpoint '${this.endpoint}'`);
      } catch (err: any) {
        logger.error('[B2Storage] Initialization failed:', err.message);
        this.s3Client = null;
      }
    } else {
      logger.info('[B2Storage] B2 credentials not present; fallback storage active.');
    }
  }

  /**
   * Returns whether Backblaze B2 is configured with valid credentials
   */
  isConfigured(): boolean {
    return Boolean(this.s3Client && env.b2ApplicationKeyId && env.b2ApplicationKey);
  }

  /**
   * Upload video binary buffer to Backblaze B2
   */
  async uploadVideo(
    buffer: Buffer,
    mimeType: string,
    key: string
  ): Promise<{ key: string; size: number }> {
    if (!this.s3Client) {
      throw new Error('B2 storage is not configured.');
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType || 'video/mp4',
        CacheControl: 'private, max-age=31536000'
      });

      await this.s3Client.send(command);
      logger.info(`[B2Storage] Uploaded video object: ${key} (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);

      return {
        key,
        size: buffer.length
      };
    } catch (err: any) {
      logger.error(`[B2Storage] Failed to upload video object ${key}: ${err.message}`);
      throw new Error(`Media storage upload failed: ${err.message}`);
    }
  }

  /**
   * Upload thumbnail image buffer to Backblaze B2
   */
  async uploadThumbnail(
    buffer: Buffer,
    mimeType: string,
    key: string
  ): Promise<{ key: string; size: number }> {
    if (!this.s3Client) {
      throw new Error('B2 storage is not configured.');
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType || 'image/jpeg',
        CacheControl: 'public, max-age=86400, immutable'
      });

      await this.s3Client.send(command);
      logger.info(`[B2Storage] Uploaded thumbnail object: ${key} (${(buffer.length / 1024).toFixed(1)} KB)`);

      return {
        key,
        size: buffer.length
      };
    } catch (err: any) {
      logger.error(`[B2Storage] Failed to upload thumbnail object ${key}: ${err.message}`);
      throw new Error(`Thumbnail storage upload failed: ${err.message}`);
    }
  }

  /**
   * Check if an object exists in B2
   */
  async hasObject(key: string): Promise<boolean> {
    if (!this.s3Client) return false;

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });
      await this.s3Client.send(command);
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      logger.warn(`[B2Storage] HeadObject check failed for ${key}: ${err.message}`);
      return false;
    }
  }

  /**
   * Get object metadata (size, contentType)
   */
  async getObjectMetadata(key: string): Promise<{ size: number; contentType: string } | null> {
    if (!this.s3Client) return null;

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });
      const response = await this.s3Client.send(command);
      return {
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'video/mp4'
      };
    } catch {
      return null;
    }
  }

  /**
   * Stream object with full HTTP Range (206 Partial Content / 200 OK) support
   * Pipes directly to Express response without buffering in memory.
   */
  async streamObject(
    key: string,
    rangeHeader: string | undefined,
    res: Response
  ): Promise<boolean> {
    if (!this.s3Client) return false;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Range: rangeHeader
      });

      const s3Response = await this.s3Client.send(command);

      const status = rangeHeader && s3Response.ContentRange ? 206 : 200;
      res.status(status);

      const headers: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Content-Type': s3Response.ContentType || 'video/mp4',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'private, max-age=86400'
      };

      if (s3Response.ContentRange) {
        headers['Content-Range'] = s3Response.ContentRange;
      }
      if (s3Response.ContentLength !== undefined) {
        headers['Content-Length'] = s3Response.ContentLength.toString();
      }

      res.set(headers);

      const stream = s3Response.Body as Readable;
      if (!stream) {
        return false;
      }

      let isAborted = false;
      res.on('close', () => {
        isAborted = true;
        if (typeof stream.destroy === 'function') {
          stream.destroy();
        }
      });

      stream.on('error', (streamErr) => {
        if (!isAborted) {
          logger.warn(`[B2Storage] Stream error for ${key}: ${streamErr.message}`);
          if (!res.headersSent) {
            res.status(500).end();
          }
        }
      });

      stream.pipe(res);
      return true;
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      logger.error(`[B2Storage] Error streaming object ${key}: ${err.message}`);
      return false;
    }
  }

  /**
   * Generate secure presigned URL for time-limited authorized playback
   */
  async getSignedPlaybackUrl(key: string, expiresInSeconds: number = 3600): Promise<string | null> {
    if (!this.s3Client) return null;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });
      return await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
    } catch (err: any) {
      logger.error(`[B2Storage] Failed to generate signed URL for ${key}: ${err.message}`);
      return null;
    }
  }

  /**
   * Delete object safely from B2
   */
  async deleteObject(key: string): Promise<boolean> {
    if (!this.s3Client) return false;

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });
      await this.s3Client.send(command);
      logger.info(`[B2Storage] Deleted object: ${key}`);
      return true;
    } catch (err: any) {
      logger.warn(`[B2Storage] Error deleting object ${key}: ${err.message}`);
      return false;
    }
  }
}

export const b2Storage = new B2StorageService();
