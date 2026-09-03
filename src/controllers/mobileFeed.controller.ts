import { Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';

export class MobileFeedController {
  async getFeed(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { category, page = '1', limit = '20' } = req.query;
      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 20;
      const offset = (pageNum - 1) * limitNum;
      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';

      const conditions: string[] = ["p.status = 'APPROVED'"];
      const params: any[] = [];

      if (category && category !== 'all' && category !== 'All') {
        params.push(category);
        conditions.push(`(LOWER(c.slug) = LOWER($${params.length}) OR LOWER(c.name) = LOWER($${params.length}) OR CAST(c.id AS TEXT) = $${params.length})`);
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      params.push(currentUserId);
      const currentUserIdParamIndex = params.length;

      params.push(limitNum, offset);
      const limitParamIndex = params.length - 1;
      const offsetParamIndex = params.length;

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
        LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = $${currentUserIdParamIndex}
        LEFT JOIN saves s ON s.post_id = p.id AND s.user_id = $${currentUserIdParamIndex}
        LEFT JOIN follows f ON f.follower_id = $${currentUserIdParamIndex} AND f.following_id = p.user_id
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `;

      const result = await query(sql, params);

      const formattedPosts = result.rows.map(r => ({
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

      ResponseUtil.success(res, formattedPosts);
    } catch (err) {
      next(err);
    }
  }

  async getFollowingFeed(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const currentUserId = req.user!.id;
      const { page = '1', limit = '20' } = req.query;
      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

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
               TRUE as is_following
        FROM posts p
        JOIN follows f ON p.user_id = f.following_id AND f.follower_id = $1
        JOIN users u ON p.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN media m ON p.media_id = m.id
        LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = $1
        LEFT JOIN saves s ON s.post_id = p.id AND s.user_id = $1
        WHERE p.status = 'APPROVED'
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await query(sql, [currentUserId, limitNum, offset]);

      const formattedPosts = result.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        user: {
          id: r.creator_id,
          name: r.creator_name,
          username: r.creator_username,
          profile_photo: r.creator_photo || '',
          is_verified: r.creator_verified || false,
          is_following: true
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
        is_following: true,
        created_at: new Date(r.created_at).toLocaleDateString()
      }));

      ResponseUtil.success(res, formattedPosts);
    } catch (err) {
      next(err);
    }
  }
}

export const mobileFeedController = new MobileFeedController();
