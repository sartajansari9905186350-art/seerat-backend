import { Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';
import { supabaseStorage } from '../services/supabaseStorage.service';

export class MobileUserController {
  async getProfile(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';

      const userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified, u.is_private, u.status,
                p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count,
                (f.id IS NOT NULL) as is_following
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         LEFT JOIN follows f ON f.follower_id = $2 AND f.following_id = u.id
         WHERE u.id = $1`,
        [userId, currentUserId]
      );

      if (userRes.rows.length === 0) {
        ResponseUtil.error(res, 'USER_NOT_FOUND', 'User does not exist.', 404);
        return;
      }

      const u = userRes.rows[0];
      const profile = {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        phone: u.phone,
        bio: u.bio || '',
        profile_photo: u.profile_photo || '',
        is_verified: u.is_verified || false,
        is_private: u.is_private || false,
        status: u.status,
        followers_count: parseInt(u.followers_count || '0', 10),
        following_count: parseInt(u.following_count || '0', 10),
        posts_count: parseInt(u.posts_count || '0', 10),
        reels_count: parseInt(u.reels_count || '0', 10),
        is_following: u.is_following || false
      };

      ResponseUtil.success(res, profile);
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { name, bio, profilePhoto, isPrivate, is_private } = req.body;

      if (name) {
        await query('UPDATE users SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [name.trim(), userId]);
      }

      const privateVal = isPrivate !== undefined ? isPrivate : is_private;
      if (privateVal !== undefined) {
        await query('UPDATE users SET is_private = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [Boolean(privateVal), userId]);
      }

      if (bio !== undefined || profilePhoto !== undefined) {
        await query(
          `UPDATE profiles
           SET bio = COALESCE($1, bio),
               profile_photo = COALESCE($2, profile_photo),
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $3`,
          [bio !== undefined ? bio.trim() : null, profilePhoto !== undefined ? profilePhoto.trim() : null, userId]
        );
      }

      const userRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified, u.is_private, u.status,
                p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.id = $1`,
        [userId]
      );

      const u = userRes.rows[0];
      const profile = {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        phone: u.phone,
        bio: u.bio || '',
        profile_photo: u.profile_photo || '',
        is_verified: u.is_verified || false,
        is_private: u.is_private || false,
        status: u.status,
        followers_count: parseInt(u.followers_count || '0', 10),
        following_count: parseInt(u.following_count || '0', 10),
        posts_count: parseInt(u.posts_count || '0', 10),
        reels_count: parseInt(u.reels_count || '0', 10),
        is_following: false
      };

      ResponseUtil.success(res, profile, 'Profile updated.');
    } catch (err) {
      next(err);
    }
  }

  async deleteAccount(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      await query("UPDATE users SET status = 'DISABLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [userId]);
      ResponseUtil.success(res, 'Account deactivated.');
    } catch (err) {
      next(err);
    }
  }

  async getUserPosts(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';
      const isOwner = currentUserId === userId;

      const targetUserCheck = await query('SELECT is_private FROM users WHERE id = $1', [userId]);
      if (targetUserCheck.rows.length === 0) {
        ResponseUtil.error(res, 'USER_NOT_FOUND', 'User does not exist.', 404);
        return;
      }
      const isTargetPrivate = targetUserCheck.rows[0].is_private || false;
      if (isTargetPrivate && !isOwner) {
        const followCheck = await query("SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2 AND status = 'ACCEPTED'", [currentUserId, userId]);
        if (followCheck.rows.length === 0) {
          ResponseUtil.success(res, []);
          return;
        }
      }

      const statusCondition = isOwner ? "p.status IN ('APPROVED', 'PENDING_REVIEW')" : "p.status = 'APPROVED'";

      const sql = `
        SELECT p.id, p.user_id, p.category_id, p.content_type, p.text_content,
               p.arabic_text, p.translation_text, p.reference_source, p.language, p.status,
               p.likes_count, p.comments_count, p.shares_count, p.saves_count, p.views_count,
               p.created_at,
               c.name as category_name,
               m.url as media_url, m.thumbnail_url,
               u.id as creator_id, u.name as creator_name, u.username as creator_username,
               u.is_verified as creator_verified, prof.profile_photo as creator_photo,
               (l.id IS NOT NULL) as is_liked,
               (s.id IS NOT NULL) as is_saved,
               (f.id IS NOT NULL) as is_following
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN media m ON p.media_id = m.id
        LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = $2
        LEFT JOIN saves s ON s.post_id = p.id AND s.user_id = $2
        LEFT JOIN follows f ON f.follower_id = $2 AND f.following_id = p.user_id
        WHERE p.user_id = $1 AND ${statusCondition}
        ORDER BY p.created_at DESC
      `;

      const result = await query(sql, [userId, currentUserId]);

      const formatted = result.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        user: {
          id: r.creator_id,
          name: r.creator_name,
          username: r.creator_username,
          profile_photo: r.creator_photo || '',
          is_verified: r.creator_verified || false,
          is_following: r.is_following || false
        },
        category_id: r.category_id,
        category_name: r.category_name || 'All',
        content_type: r.content_type,
        text_content: r.text_content || '',
        arabic_text: r.arabic_text || '',
        translation_text: r.translation_text || '',
        reference_source: r.reference_source || '',
        media_url: r.media_url,
        thumbnail_url: r.thumbnail_url,
        language: r.language || 'en',
        status: r.status,
        likes_count: parseInt(r.likes_count || '0', 10),
        comments_count: parseInt(r.comments_count || '0', 10),
        shares_count: parseInt(r.shares_count || '0', 10),
        saves_count: parseInt(r.saves_count || '0', 10),
        views_count: parseInt(r.views_count || '0', 10),
        is_liked: r.is_liked || false,
        is_saved: r.is_saved || false,
        is_following: r.is_following || false,
        created_at: new Date(r.created_at).toLocaleDateString()
      }));

      ResponseUtil.success(res, formatted);
    } catch (err) {
      next(err);
    }
  }

  async getUserReels(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';
      const isOwner = currentUserId === userId;

      const targetUserCheck = await query('SELECT is_private FROM users WHERE id = $1', [userId]);
      if (targetUserCheck.rows.length === 0) {
        ResponseUtil.error(res, 'USER_NOT_FOUND', 'User does not exist.', 404);
        return;
      }
      const isTargetPrivate = targetUserCheck.rows[0].is_private || false;
      if (isTargetPrivate && !isOwner) {
        const followCheck = await query("SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2 AND status = 'ACCEPTED'", [currentUserId, userId]);
        if (followCheck.rows.length === 0) {
          ResponseUtil.success(res, []);
          return;
        }
      }

      const statusCondition = isOwner ? "r.status IN ('APPROVED', 'PENDING_REVIEW')" : "r.status = 'APPROVED'";

      const sql = `
        SELECT r.id, r.user_id, r.category_id, r.caption, r.reference_source, r.language,
               r.audio_title, r.audio_artist, m.duration as duration_seconds, r.status,
               r.likes_count, r.comments_count, r.shares_count, r.saves_count, r.views_count,
               r.created_at,
               c.name as category_name,
               m.url as video_url, m.thumbnail_url,
               u.id as creator_id, u.name as creator_name, u.username as creator_username,
               u.is_verified as creator_verified, prof.profile_photo as creator_photo,
               (l.id IS NOT NULL) as is_liked,
               (s.id IS NOT NULL) as is_saved,
               (f.id IS NOT NULL) as is_following
        FROM reels r
        JOIN users u ON r.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON r.category_id = c.id
        LEFT JOIN media m ON r.media_id = m.id
        LEFT JOIN likes l ON l.reel_id = r.id AND l.user_id = $2
        LEFT JOIN saves s ON s.reel_id = r.id AND s.user_id = $2
        LEFT JOIN follows f ON f.follower_id = $2 AND f.following_id = r.user_id
        WHERE r.user_id = $1 AND ${statusCondition}
        ORDER BY r.created_at DESC
      `;

      const result = await query(sql, [userId, currentUserId]);

      const formatted = result.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        user: {
          id: r.creator_id,
          name: r.creator_name,
          username: r.creator_username,
          profile_photo: r.creator_photo || '',
          is_verified: r.creator_verified || false,
          is_following: r.is_following || false
        },
        category_id: r.category_id,
        category_name: r.category_name || 'Quran',
        video_url: r.video_url || '',
        thumbnail_url: r.thumbnail_url || '',
        caption: r.caption || '',
        audio_title: r.audio_title || 'Original Islamic Audio',
        audio_artist: r.audio_artist || 'SEERAT Creator',
        reference_source: r.reference_source || '',
        language: r.language || 'en',
        status: r.status,
        likes_count: parseInt(r.likes_count || '0', 10),
        comments_count: parseInt(r.comments_count || '0', 10),
        shares_count: parseInt(r.shares_count || '0', 10),
        saves_count: parseInt(r.saves_count || '0', 10),
        views_count: parseInt(r.views_count || '0', 10),
        is_liked: r.is_liked || false,
        is_saved: r.is_saved || false,
        is_following: r.is_following || false,
        created_at: new Date(r.created_at).toLocaleDateString()
      }));

      ResponseUtil.success(res, formatted);
    } catch (err) {
      next(err);
    }
  }

  async getUserFollowers(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';

      const sql = `
        SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified,
               p.bio, p.profile_photo, p.followers_count, p.following_count,
               EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = $2 AND f2.following_id = u.id) as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        LEFT JOIN profiles p ON u.id = p.user_id
        WHERE f.following_id = $1
      `;

      const result = await query(sql, [userId, currentUserId]);
      const list = result.rows.map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        bio: u.bio || '',
        profile_photo: u.profile_photo || '',
        is_verified: u.is_verified || false,
        followers_count: parseInt(u.followers_count || '0', 10),
        following_count: parseInt(u.following_count || '0', 10),
        is_following: u.is_following || false
      }));

      ResponseUtil.success(res, list);
    } catch (err) {
      next(err);
    }
  }

  async getUserFollowing(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';

      const sql = `
        SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified,
               p.bio, p.profile_photo, p.followers_count, p.following_count,
               EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = $2 AND f2.following_id = u.id) as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        LEFT JOIN profiles p ON u.id = p.user_id
        WHERE f.follower_id = $1
      `;

      const result = await query(sql, [userId, currentUserId]);
      const list = result.rows.map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        bio: u.bio || '',
        profile_photo: u.profile_photo || '',
        is_verified: u.is_verified || false,
        followers_count: parseInt(u.followers_count || '0', 10),
        following_count: parseInt(u.following_count || '0', 10),
        is_following: u.is_following || false
      }));

      ResponseUtil.success(res, list);
    } catch (err) {
      next(err);
    }
  }

  async uploadPhoto(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        ResponseUtil.error(res, 'UNAUTHORIZED', 'Authentication required.', 401);
        return;
      }

      if (!req.file) {
        ResponseUtil.error(res, 'NO_FILE', 'No photo file provided in request. Please include an image file under field name "photo".', 400);
        return;
      }

      // Fetch existing photo to remove later
      const existingRes = await query(`SELECT profile_photo FROM profiles WHERE user_id = $1`, [user.id]);
      const oldPhoto = existingRes.rows[0]?.profile_photo;

      // Upload to Supabase Storage
      const newPhotoUrl = await supabaseStorage.uploadProfilePhoto(req.file, 'users', user.id);

      // Update PostgreSQL profiles and users tables
      await query(
        `UPDATE profiles SET profile_photo = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
        [newPhotoUrl, user.id]
      );
      await query(
        `UPDATE users SET profile_photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newPhotoUrl, user.id]
      );

      // Clean up old image from storage if it belonged to Supabase
      if (oldPhoto && oldPhoto !== newPhotoUrl) {
        await supabaseStorage.deleteProfilePhoto(oldPhoto);
      }

      // Fetch updated profile
      const updatedUserRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified, u.status, u.is_profile_completed,
                p.bio, p.profile_photo, p.profile_photo as profile_photo_url, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.id = $1`,
        [user.id]
      );

      ResponseUtil.success(res, updatedUserRes.rows[0], 'Profile photo updated successfully.');
    } catch (err: any) {
      ResponseUtil.error(res, 'PHOTO_UPLOAD_FAILED', err.message || 'Failed to upload profile photo.', 400);
    }
  }

  async removePhoto(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        ResponseUtil.error(res, 'UNAUTHORIZED', 'Authentication required.', 401);
        return;
      }

      const existingRes = await query(`SELECT profile_photo FROM profiles WHERE user_id = $1`, [user.id]);
      const oldPhoto = existingRes.rows[0]?.profile_photo;

      // Clear in PostgreSQL
      await query(
        `UPDATE profiles SET profile_photo = '', updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
        [user.id]
      );
      await query(
        `UPDATE users SET profile_photo_url = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [user.id]
      );

      // Remove from Supabase Storage
      if (oldPhoto) {
        await supabaseStorage.deleteProfilePhoto(oldPhoto);
      }

      // Fetch updated profile
      const updatedUserRes = await query(
        `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_verified, u.status, u.is_profile_completed,
                p.bio, p.profile_photo, p.profile_photo as profile_photo_url, p.followers_count, p.following_count, p.posts_count, p.reels_count
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.id = $1`,
        [user.id]
      );

      ResponseUtil.success(res, updatedUserRes.rows[0], 'Profile photo removed successfully.');
    } catch (err: any) {
      ResponseUtil.error(res, 'PHOTO_REMOVE_FAILED', err.message || 'Failed to remove profile photo.', 400);
    }
  }

  async search(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = ((req.query.q as string) || '').trim();
      const type = ((req.query.type as string) || 'ALL').toUpperCase();

      if (!q) {
        ResponseUtil.success(res, { users: [], posts: [] });
        return;
      }

      const pattern = `%${q}%`;
      let users: any[] = [];
      let posts: any[] = [];

      if (type === 'ALL' || type === 'USERS') {
        const usersRes = await query(
          `SELECT u.id, u.name, u.username, u.email, u.is_verified, u.is_private,
                  p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count
           FROM users u
           LEFT JOIN profiles p ON u.id = p.user_id
           WHERE (u.username ILIKE $1 OR u.name ILIKE $1) AND u.status = 'ACTIVE'
           LIMIT 20`,
          [pattern]
        );
        users = usersRes.rows.map(u => ({
          id: u.id,
          name: u.name,
          username: u.username,
          email: u.email,
          bio: u.bio || '',
          profile_photo: u.profile_photo || '',
          is_verified: u.is_verified || false,
          is_private: u.is_private || false,
          followers_count: parseInt(u.followers_count || '0', 10),
          following_count: parseInt(u.following_count || '0', 10),
          posts_count: parseInt(u.posts_count || '0', 10)
        }));
      }

      if (type === 'ALL' || type === 'POSTS') {
        const postsRes = await query(
          `SELECT p.id, p.user_id, p.content_type, p.media_url, p.thumbnail_url,
                  p.title, p.text_content, p.arabic_text, p.translation_text, p.reference_source,
                  p.language, p.category_id, p.status, p.likes_count, p.comments_count,
                  p.shares_count, p.saves_count, p.views_count, p.created_at,
                  c.name as category_name, c.arabic_name as category_arabic_name,
                  u.name as creator_name, u.username as creator_username,
                  u.is_verified as creator_verified, u.is_private as creator_private,
                  pr.profile_photo as creator_photo
           FROM posts p
           JOIN categories c ON p.category_id = c.id
           JOIN users u ON p.user_id = u.id
           LEFT JOIN profiles pr ON u.id = pr.user_id
           WHERE p.status = 'APPROVED'
             AND (p.title ILIKE $1 OR p.text_content ILIKE $1 OR p.arabic_text ILIKE $1 OR p.translation_text ILIKE $1 OR p.reference_source ILIKE $1 OR c.name ILIKE $1 OR u.name ILIKE $1 OR u.username ILIKE $1)
           ORDER BY p.created_at DESC
           LIMIT 20`,
          [pattern]
        );
        posts = postsRes.rows.map(p => ({
          id: p.id,
          user_id: p.user_id,
          content_type: p.content_type,
          media_url: p.media_url,
          thumbnail_url: p.thumbnail_url,
          title: p.title,
          text_content: p.text_content,
          arabic_text: p.arabic_text,
          translation_text: p.translation_text,
          reference_source: p.reference_source,
          language: p.language,
          category_id: p.category_id,
          category_name: p.category_name,
          category_arabic_name: p.category_arabic_name,
          status: p.status,
          likes_count: parseInt(p.likes_count || '0', 10),
          comments_count: parseInt(p.comments_count || '0', 10),
          shares_count: parseInt(p.shares_count || '0', 10),
          saves_count: parseInt(p.saves_count || '0', 10),
          views_count: parseInt(p.views_count || '0', 10),
          created_at: p.created_at,
          user: {
            id: p.user_id,
            name: p.creator_name,
            username: p.creator_username,
            profile_photo: p.creator_photo || '',
            is_verified: p.creator_verified || false,
            is_private: p.creator_private || false
          }
        }));
      }

      ResponseUtil.success(res, { users, posts });
    } catch (err) {
      next(err);
    }
  }
}

export const mobileUserController = new MobileUserController();
