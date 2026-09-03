import { env } from '../config/env';

export interface FormattedMedia {
  id: string;
  mediaType: string;
  url: string;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  storageProvider: string;
  status: string;
  createdAt: string;
}

export class MediaStorageService {
  private get provider() { return env.storageProvider; }
  private get cdnBaseUrl() { return env.cdnBaseUrl; }

  formatMedia(media: any): FormattedMedia | null {
    if (!media) return null;

    let fullUrl = media.url;
    let fullThumb = media.thumbnail_url;

    if (this.cdnBaseUrl && fullUrl && !fullUrl.startsWith('http')) {
      fullUrl = `${this.cdnBaseUrl.replace(/\/$/, '')}/${fullUrl.replace(/^\//, '')}`;
    }

    if (this.cdnBaseUrl && fullThumb && !fullThumb.startsWith('http')) {
      fullThumb = `${this.cdnBaseUrl.replace(/\/$/, '')}/${fullThumb.replace(/^\//, '')}`;
    }

    return {
      id: media.id,
      mediaType: media.media_type,
      url: fullUrl,
      thumbnailUrl: fullThumb,
      duration: media.duration,
      width: media.width,
      height: media.height,
      fileSize: media.file_size,
      mimeType: media.mime_type,
      storageProvider: media.storage_provider || this.provider,
      status: media.status,
      createdAt: media.created_at
    };
  }
}

export const mediaStorage = new MediaStorageService();
