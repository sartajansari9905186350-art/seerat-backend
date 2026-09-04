import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';
import { aiModerationService } from '../services/aiModeration.service';


export class MobileReelController {
  async getForYouReels(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = '1', limit = '10' } = req.query;
      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 10;
      const offset = (pageNum - 1) * limitNum;
      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';

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
        LEFT JOIN likes l ON l.reel_id = r.id AND l.user_id = $1
        LEFT JOIN saves s ON s.reel_id = r.id AND s.user_id = $1
        LEFT JOIN follows f ON f.follower_id = $1 AND f.following_id = r.user_id
        WHERE r.status = 'APPROVED'
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await query(sql, [currentUserId, limitNum, offset]);

      const formattedReels = result.rows.map(r => ({
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
        video_url: r.video_url || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        thumbnail_url: r.thumbnail_url || 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=600',
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

      ResponseUtil.success(res, formattedReels);
    } catch (err) {
      next(err);
    }
  }

  async getFollowingReels(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const currentUserId = req.user!.id;
      const { page = '1', limit = '10' } = req.query;
      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 10;
      const offset = (pageNum - 1) * limitNum;

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
               TRUE as is_following
        FROM reels r
        JOIN follows f ON r.user_id = f.following_id AND f.follower_id = $1
        JOIN users u ON r.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON r.category_id = c.id
        LEFT JOIN media m ON r.media_id = m.id
        LEFT JOIN likes l ON l.reel_id = r.id AND l.user_id = $1
        LEFT JOIN saves s ON s.reel_id = r.id AND s.user_id = $1
        WHERE r.status = 'APPROVED'
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await query(sql, [currentUserId, limitNum, offset]);

      const formattedReels = result.rows.map(r => ({
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
        category_name: r.category_name || 'Quran',
        video_url: r.video_url || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        thumbnail_url: r.thumbnail_url || 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53?w=600',
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
        is_following: true,
        created_at: new Date(r.created_at).toLocaleDateString()
      }));

      ResponseUtil.success(res, formattedReels);
    } catch (err) {
      next(err);
    }
  }

  async createReel(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const {
        categoryId = 2,
        videoUrl,
        thumbnailUrl,
        caption = '',
        audioTitle = 'Original Islamic Audio',
        audioArtist = 'SEERAT Creator',
        referenceSource = '',
        language = 'en'
      } = req.body;

      if (!videoUrl) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Video URL is required for Reel submission.', 400);
        return;
      }

      const reelId = uuidv4();
      const mediaId = uuidv4();

      await withTransaction(async (client) => {
        // Media Record
        await client.query(
          `INSERT INTO media (id, owner_id, media_type, url, thumbnail_url, status)
           VALUES ($1, $2, 'VIDEO', $3, $4, 'READY')`,
          [mediaId, userId, videoUrl, thumbnailUrl || videoUrl]
        );

        // Reel created as PENDING_REVIEW (mandatory moderation)
        await client.query(
          `INSERT INTO reels (id, user_id, category_id, media_id, caption, reference_source, language, audio_title, audio_artist, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_REVIEW')`,
          [reelId, userId, categoryId, mediaId, caption, referenceSource, language, audioTitle, audioArtist]
        );

        // Queue in moderation_reviews
        await client.query(
          `INSERT INTO moderation_reviews (id, content_type, content_id, user_id, status)
           VALUES ($1, 'REEL', $2, $3, 'PENDING_REVIEW')`,
          [uuidv4(), reelId, userId]
        );

        // Alert Admin Review Queue
        await client.query(
          `INSERT INTO admin_notifications (id, type, title, message, target_type, target_id, is_read)
           VALUES ($1, 'PENDING_REVIEW', 'New Reel Submitted', $2, 'REEL', $3, FALSE)`,
          [uuidv4(), `${req.user!.name} uploaded a new Islamic Reel for review.`, reelId]
        );

        // Update profile reels count
        await client.query(
          `UPDATE profiles SET reels_count = reels_count + 1 WHERE user_id = $1`,
          [userId]
        );
      });

      // Perform AI Islamic content screening (advisory; strictly maintains PENDING_REVIEW)
      let aiResult: any = null;
      try {
        aiResult = await aiModerationService.screenContent({
          contentType: 'REEL',
          contentId: reelId,
          caption,
          referenceSource,
          mediaUrl: videoUrl,
          audioTitle
        });
      } catch (aiErr: any) {
        // Fail-safe guarantee: failure to screen never impedes submission and never publishes
      }

      const catRes = await query('SELECT name FROM categories WHERE id = $1', [categoryId]);
      const categoryName = catRes.rows[0]?.name || 'Quran';

      const createdReel = {
        id: reelId,
        user_id: userId,
        user: {
          id: userId,
          name: req.user!.name,
          username: req.user!.username
        },
        category_id: categoryId,
        category_name: categoryName,
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl || videoUrl,
        caption,
        audio_title: audioTitle,
        audio_artist: audioArtist,
        reference_source: referenceSource,
        language,
        status: 'PENDING_REVIEW',
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        saves_count: 0,
        views_count: 0,
        is_liked: false,
        is_saved: false,
        is_following: false,
        created_at: 'Just now'
      };

      ResponseUtil.success(
        res,
        createdReel,
        'Your reel has been submitted for Islamic moderation review and will appear once approved.',
        201
      );
    } catch (err) {
      next(err);
    }
  }

  async recordReelView(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reelId } = req.params;
      await query('UPDATE reels SET views_count = views_count + 1 WHERE id = $1', [reelId]);
      ResponseUtil.success(res, true, 'View recorded.');
    } catch (err) {
      next(err);
    }
  }
}

export const mobileReelController = new MobileReelController();
