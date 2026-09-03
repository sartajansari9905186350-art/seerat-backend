export type ContentType = 'POST' | 'REEL';
export type ContentStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'REMOVED' | 'SUSPENDED';

export type RejectionReason =
  | 'Not Islamic content'
  | 'Incorrect information'
  | 'Copyright issue'
  | 'Inappropriate content'
  | 'Spam'
  | 'Misleading information'
  | 'Other';

export interface Post {
  id: string;
  user_id: string;
  category_id?: number;
  content_type: 'PHOTO' | 'VIDEO' | 'TEXT';
  text_content: string;
  arabic_text?: string;
  translation_text?: string;
  reference_source?: string;
  media_id?: string;
  language: string;
  status: ContentStatus;
  rejection_reason?: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  saves_count: number;
  views_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface Reel {
  id: string;
  user_id: string;
  category_id?: number;
  media_id: string;
  caption: string;
  audio_title: string;
  audio_artist: string;
  reference_source?: string;
  language: string;
  status: ContentStatus;
  rejection_reason?: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  saves_count: number;
  views_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface ModerationReview {
  id: string;
  content_type: ContentType;
  content_id: string;
  user_id: string;
  status: ContentStatus;
  rejection_reason?: string;
  notes?: string;
  reviewed_by?: string;
  created_at: Date;
  reviewed_at?: Date;
}
