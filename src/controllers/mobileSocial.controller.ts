import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';

export class MobileSocialController {
  async toggleLikePost(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { postId } = req.params;

      let isLiked = false;

      await withTransaction(async (client) => {
        const existing = await client.query(
          'SELECT id FROM likes WHERE user_id = $1 AND post_id = $2',
          [userId, postId]
        );

        if (existing.rows.length > 0) {
          await client.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
          await client.query('UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1', [postId]);
          isLiked = false;
        } else {
          await client.query(
            'INSERT INTO likes (id, user_id, post_id) VALUES ($1, $2, $3)',
            [uuidv4(), userId, postId]
          );
          await client.query('UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1', [postId]);
          isLiked = true;

          // Notify post owner
          const postOwner = await client.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
          if (postOwner.rows.length > 0 && postOwner.rows[0].user_id !== userId) {
            await client.query(
              `INSERT INTO notifications (id, user_id, actor_id, type, post_id, message)
               VALUES ($1, $2, $3, 'LIKE', $4, $5)`,
              [uuidv4(), postOwner.rows[0].user_id, userId, postId, `${req.user!.name} liked your post.`]
            );
          }
        }
      });

      ResponseUtil.success(res, isLiked);
    } catch (err) {
      next(err);
    }
  }

  async toggleLikeReel(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { reelId } = req.params;

      let isLiked = false;

      await withTransaction(async (client) => {
        const existing = await client.query(
          'SELECT id FROM likes WHERE user_id = $1 AND reel_id = $2',
          [userId, reelId]
        );

        if (existing.rows.length > 0) {
          await client.query('DELETE FROM likes WHERE user_id = $1 AND reel_id = $2', [userId, reelId]);
          await client.query('UPDATE reels SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1', [reelId]);
          isLiked = false;
        } else {
          await client.query(
            'INSERT INTO likes (id, user_id, reel_id) VALUES ($1, $2, $3)',
            [uuidv4(), userId, reelId]
          );
          await client.query('UPDATE reels SET likes_count = likes_count + 1 WHERE id = $1', [reelId]);
          isLiked = true;

          const reelOwner = await client.query('SELECT user_id FROM reels WHERE id = $1', [reelId]);
          if (reelOwner.rows.length > 0 && reelOwner.rows[0].user_id !== userId) {
            await client.query(
              `INSERT INTO notifications (id, user_id, actor_id, type, reel_id, message)
               VALUES ($1, $2, $3, 'LIKE', $4, $5)`,
              [uuidv4(), reelOwner.rows[0].user_id, userId, reelId, `${req.user!.name} liked your reel.`]
            );
          }
        }
      });

      ResponseUtil.success(res, isLiked);
    } catch (err) {
      next(err);
    }
  }

  async toggleSavePost(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { postId } = req.params;

      let isSaved = false;

      await withTransaction(async (client) => {
        const existing = await client.query(
          'SELECT id FROM saves WHERE user_id = $1 AND post_id = $2',
          [userId, postId]
        );

        if (existing.rows.length > 0) {
          await client.query('DELETE FROM saves WHERE user_id = $1 AND post_id = $2', [userId, postId]);
          await client.query('UPDATE posts SET saves_count = GREATEST(saves_count - 1, 0) WHERE id = $1', [postId]);
          isSaved = false;
        } else {
          await client.query(
            'INSERT INTO saves (id, user_id, post_id) VALUES ($1, $2, $3)',
            [uuidv4(), userId, postId]
          );
          await client.query('UPDATE posts SET saves_count = saves_count + 1 WHERE id = $1', [postId]);
          isSaved = true;
        }
      });

      ResponseUtil.success(res, isSaved);
    } catch (err) {
      next(err);
    }
  }

  async toggleSaveReel(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { reelId } = req.params;

      let isSaved = false;

      await withTransaction(async (client) => {
        const existing = await client.query(
          'SELECT id FROM saves WHERE user_id = $1 AND reel_id = $2',
          [userId, reelId]
        );

        if (existing.rows.length > 0) {
          await client.query('DELETE FROM saves WHERE user_id = $1 AND reel_id = $2', [userId, reelId]);
          await client.query('UPDATE reels SET saves_count = GREATEST(saves_count - 1, 0) WHERE id = $1', [reelId]);
          isSaved = false;
        } else {
          await client.query(
            'INSERT INTO saves (id, user_id, reel_id) VALUES ($1, $2, $3)',
            [uuidv4(), userId, reelId]
          );
          await client.query('UPDATE reels SET saves_count = saves_count + 1 WHERE id = $1', [reelId]);
          isSaved = true;
        }
      });

      ResponseUtil.success(res, isSaved);
    } catch (err) {
      next(err);
    }
  }

  async toggleFollow(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const followerId = req.user!.id;
      const { userId: followingId } = req.params;

      if (followerId === followingId) {
        ResponseUtil.error(res, 'BAD_REQUEST', 'You cannot follow yourself.', 400);
        return;
      }

      let isFollowing = false;

      await withTransaction(async (client) => {
        const existing = await client.query(
          'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
          [followerId, followingId]
        );

        if (existing.rows.length > 0) {
          await client.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
          await client.query('UPDATE profiles SET following_count = GREATEST(following_count - 1, 0) WHERE user_id = $1', [followerId]);
          await client.query('UPDATE profiles SET followers_count = GREATEST(followers_count - 1, 0) WHERE user_id = $1', [followingId]);
          isFollowing = false;
        } else {
          await client.query(
            'INSERT INTO follows (id, follower_id, following_id) VALUES ($1, $2, $3)',
            [uuidv4(), followerId, followingId]
          );
          await client.query('UPDATE profiles SET following_count = following_count + 1 WHERE user_id = $1', [followerId]);
          await client.query('UPDATE profiles SET followers_count = followers_count + 1 WHERE user_id = $1', [followingId]);
          isFollowing = true;

          // Notify user
          await client.query(
            `INSERT INTO notifications (id, user_id, actor_id, type, message)
             VALUES ($1, $2, $3, 'FOLLOW', $4)`,
            [uuidv4(), followingId, followerId, `${req.user!.name} started following you.`]
          );
        }
      });

      ResponseUtil.success(res, isFollowing);
    } catch (err) {
      next(err);
    }
  }

  async getComments(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { postId, reelId } = req.query;

      if (!postId && !reelId) {
        ResponseUtil.error(res, 'BAD_REQUEST', 'postId or reelId is required.', 400);
        return;
      }

      const currentUserId = req.user?.id || '00000000-0000-0000-0000-000000000000';

      const condition = postId ? 'c.post_id = $1' : 'c.reel_id = $1';
      const targetId = postId || reelId;

      const sql = `
        SELECT c.id, c.user_id, c.post_id, c.reel_id, c.parent_comment_id, c.content,
               c.likes_count, c.created_at,
               u.name as user_name, u.username, prof.profile_photo,
               (cl.comment_id IS NOT NULL) as is_liked
        FROM comments c
        JOIN users u ON c.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN comment_likes cl ON cl.comment_id = c.id AND cl.user_id = $2
        WHERE ${condition}
        ORDER BY c.created_at ASC
      `;

      const result = await query(sql, [targetId, currentUserId]);

      const comments = result.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        user: {
          id: r.user_id,
          name: r.user_name,
          username: r.username,
          profile_photo: r.profile_photo || ''
        },
        post_id: r.post_id,
        reel_id: r.reel_id,
        parent_comment_id: r.parent_comment_id,
        content: r.content,
        likes_count: parseInt(r.likes_count || '0', 10),
        is_liked: r.is_liked || false,
        created_at: new Date(r.created_at).toLocaleDateString()
      }));

      ResponseUtil.success(res, comments);
    } catch (err) {
      next(err);
    }
  }

  async addComment(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { postId, reelId, content, parentCommentId } = req.body;

      if (!content || (!postId && !reelId)) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Comment text and post/reel ID are required.', 400);
        return;
      }

      const commentId = uuidv4();

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO comments (id, user_id, post_id, reel_id, parent_comment_id, content)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [commentId, userId, postId || null, reelId || null, parentCommentId || null, content.trim()]
        );

        if (postId) {
          await client.query('UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1', [postId]);
          const postOwner = await client.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
          if (postOwner.rows.length > 0 && postOwner.rows[0].user_id !== userId) {
            await client.query(
              `INSERT INTO notifications (id, user_id, actor_id, type, post_id, message)
               VALUES ($1, $2, $3, 'COMMENT', $4, $5)`,
              [uuidv4(), postOwner.rows[0].user_id, userId, postId, `${req.user!.name} commented on your post: "${content.trim().slice(0, 30)}..."`]
            );
          }
        } else if (reelId) {
          await client.query('UPDATE reels SET comments_count = comments_count + 1 WHERE id = $1', [reelId]);
          const reelOwner = await client.query('SELECT user_id FROM reels WHERE id = $1', [reelId]);
          if (reelOwner.rows.length > 0 && reelOwner.rows[0].user_id !== userId) {
            await client.query(
              `INSERT INTO notifications (id, user_id, actor_id, type, reel_id, message)
               VALUES ($1, $2, $3, 'COMMENT', $4, $5)`,
              [uuidv4(), reelOwner.rows[0].user_id, userId, reelId, `${req.user!.name} commented on your reel: "${content.trim().slice(0, 30)}..."`]
            );
          }
        }
      });

      const userProfile = await query('SELECT profile_photo FROM profiles WHERE user_id = $1', [userId]);

      const createdComment = {
        id: commentId,
        user_id: userId,
        user: {
          id: userId,
          name: req.user!.name,
          username: req.user!.username,
          profile_photo: userProfile.rows[0]?.profile_photo || ''
        },
        post_id: postId || null,
        reel_id: reelId || null,
        parent_comment_id: parentCommentId || null,
        content: content.trim(),
        likes_count: 0,
        is_liked: false,
        created_at: 'Just now'
      };

      ResponseUtil.success(res, createdComment, 'Comment added successfully.', 201);
    } catch (err) {
      next(err);
    }
  }

  async deleteComment(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { commentId } = req.params;

      await withTransaction(async (client) => {
        const comment = await client.query('SELECT post_id, reel_id, user_id FROM comments WHERE id = $1', [commentId]);
        if (comment.rows.length === 0) {
          ResponseUtil.error(res, 'NOT_FOUND', 'Comment not found.', 404);
          return;
        }

        if (comment.rows[0].user_id !== userId) {
          ResponseUtil.error(res, 'FORBIDDEN', 'Cannot delete this comment.', 403);
          return;
        }

        const { post_id, reel_id } = comment.rows[0];
        await client.query('DELETE FROM comments WHERE id = $1', [commentId]);

        if (post_id) {
          await client.query('UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = $1', [post_id]);
        } else if (reel_id) {
          await client.query('UPDATE reels SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = $1', [reel_id]);
        }
      });

      ResponseUtil.success(res, 'Comment deleted.');
    } catch (err) {
      next(err);
    }
  }
}

export const mobileSocialController = new MobileSocialController();
