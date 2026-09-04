export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR';
export type AdminStatus = 'ACTIVE' | 'DISABLED';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: AdminRole;
  status: AdminStatus;
  avatar_url?: string;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AdminProfileDTO {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  status: AdminStatus;
  avatarUrl?: string;
  avatar_url?: string;
  admin_profile_photo_url?: string;
  lastLoginAt?: Date;
  createdAt: Date;
}

export interface AuthTokenPayload {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}
