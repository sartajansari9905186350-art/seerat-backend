export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  phone?: string;
  password_hash: string;
  status: UserStatus;
  is_verified: boolean;
  is_private: boolean;
  suspension_reason?: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserProfile {
  user_id: string;
  bio: string;
  profile_photo: string;
  followers_count: number;
  following_count: number;
  posts_count: number;
  reels_count: number;
  likes_count: number;
  website: string;
  updated_at: Date;
}

export interface UserDetailDTO extends User {
  bio?: string;
  profile_photo?: string;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
  reels_count?: number;
  report_count?: number;
}
