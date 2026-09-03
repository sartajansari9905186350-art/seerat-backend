import { Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';

export class MobileNotificationController {
  async getNotifications(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;

      const sql = `
        SELECT n.id, n.user_id, n.actor_id, n.type, n.post_id, n.reel_id, n.message, n.is_read, n.created_at,
               u.name as actor_name, u.username as actor_username, prof.profile_photo as actor_photo
        FROM notifications n
        LEFT JOIN users u ON n.actor_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC
        LIMIT 50
      `;

      const result = await query(sql, [userId]);

      const formatted = result.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        actor: r.actor_id ? {
          id: r.actor_id,
          name: r.actor_name,
          username: r.actor_username,
          profile_photo: r.actor_photo || ''
        } : null,
        type: r.type,
        post_id: r.post_id,
        reel_id: r.reel_id,
        message: r.message,
        is_read: r.is_read || false,
        created_at: new Date(r.created_at).toLocaleDateString()
      }));

      ResponseUtil.success(res, formatted);
    } catch (err) {
      next(err);
    }
  }

  async markAsRead(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      await query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [id, userId]);
      ResponseUtil.success(res, true, 'Notification marked as read.');
    } catch (err) {
      next(err);
    }
  }
}

export const mobileNotificationController = new MobileNotificationController();
