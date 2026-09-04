import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';
import { aiModerationService } from '../services/aiModeration.service';


export class MobilePostController {
  async createPost(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const {
        categoryId = 1,
        contentType = 'TEXT',
        textContent = '',
        arabicText = '',
        translationText = '',
        referenceSource = '',
        mediaUrl = null,
        language = 'en'
      } = req.body;

      if (!textContent && !arabicText && !translationText && !mediaUrl) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Please provide post text, Islamic verse/hadith, or media.', 400);
        return;
      }

      const postId = uuidv4();
      let mediaId: string | null = null;

      await withTransaction(async (client) => {
        if (mediaUrl) {
          mediaId = uuidv4();
          await client.query(
            `INSERT INTO media (id, owner_id, media_type, url, thumbnail_url, status)
             VALUES ($1, $2, $3, $4, $5, 'READY')`,
            [mediaId, userId, contentType === 'PHOTO' ? 'PHOTO' : 'VIDEO', mediaUrl, mediaUrl]
          );
        }

        // Post created with status PENDING_REVIEW (mandatory moderation)
        await client.query(
          `INSERT INTO posts (id, user_id, category_id, content_type, text_content, arabic_text, translation_text, reference_source, media_id, language, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING_REVIEW')`,
          [postId, userId, categoryId, contentType, textContent, arabicText, translationText, referenceSource, mediaId, language]
        );

        // Queue in moderation_reviews
        await client.query(
          `INSERT INTO moderation_reviews (id, content_type, content_id, user_id, status)
           VALUES ($1, 'POST', $2, $3, 'PENDING_REVIEW')`,
          [uuidv4(), postId, userId]
        );

        // Alert Admin Review Queue
        await client.query(
          `INSERT INTO admin_notifications (id, type, title, message, target_type, target_id, is_read)
           VALUES ($1, 'PENDING_REVIEW', 'New Post Submitted', $2, 'POST', $3, FALSE)`,
          [uuidv4(), `${req.user!.name} submitted a new post for Islamic review.`, postId]
        );

        // Update user profile post count
        await client.query(
          `UPDATE profiles SET posts_count = posts_count + 1 WHERE user_id = $1`,
          [userId]
        );
      });

      // Perform AI Islamic content screening (advisory; strictly maintains PENDING_REVIEW)
      let aiResult: any = null;
      try {
        aiResult = await aiModerationService.screenContent({
          contentType: 'POST',
          contentId: postId,
          textContent,
          arabicText,
          translationText,
          referenceSource,
          mediaUrl
        });
      } catch (aiErr: any) {
        // Fail-safe guarantee: failure to screen never impedes submission and never publishes
      }

      // Fetch category name
      const catRes = await query('SELECT name FROM categories WHERE id = $1', [categoryId]);
      const categoryName = catRes.rows[0]?.name || 'All';

      const createdPost = {
        id: postId,
        user_id: userId,
        user: {
          id: userId,
          name: req.user!.name,
          username: req.user!.username
        },
        category_id: categoryId,
        category_name: categoryName,
        content_type: contentType,
        text_content: textContent,
        arabic_text: arabicText,
        translation_text: translationText,
        reference_source: referenceSource,
        media_url: mediaUrl,
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
        createdPost,
        'Your content has been submitted for Islamic moderation review and will appear in the feed once approved.',
        201
      );
    } catch (err) {
      next(err);
    }
  }

  async deletePost(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { postId } = req.params;

      const postRes = await query('SELECT user_id FROM posts WHERE id = $1', [postId]);
      if (postRes.rows.length === 0) {
        ResponseUtil.error(res, 'NOT_FOUND', 'Post not found.', 404);
        return;
      }

      if (postRes.rows[0].user_id !== userId) {
        ResponseUtil.error(res, 'FORBIDDEN', 'You do not have permission to delete this post.', 403);
        return;
      }

      await withTransaction(async (client) => {
        await client.query(`UPDATE posts SET status = 'REMOVED' WHERE id = $1`, [postId]);
        await client.query(
          `UPDATE profiles SET posts_count = GREATEST(posts_count - 1, 0) WHERE user_id = $1`,
          [userId]
        );
      });

      ResponseUtil.success(res, null, 'Post deleted successfully.');
    } catch (err) {
      next(err);
    }
  }
}

export const mobilePostController = new MobilePostController();
