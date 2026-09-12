import { Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';
import { fcmService } from '../services/fcm.service';

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

  async deleteNotification(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const result = await query(
        'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rowCount === 0) {
        ResponseUtil.error(res, 'NOT_FOUND', 'Notification not found or not authorized', 404);
        return;
      }

      ResponseUtil.success(res, true, 'Notification deleted successfully.');
    } catch (err) {
      next(err);
    }
  }

  async registerToken(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { token, deviceType } = req.body;

      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'FCM device token is required.', 400);
        return;
      }

      const success = await fcmService.registerToken(userId, token.trim(), deviceType || 'ANDROID');
      if (success) {
        ResponseUtil.success(res, true, 'Device token registered successfully.');
      } else {
        ResponseUtil.error(res, 'SERVER_ERROR', 'Failed to register device token.', 500);
      }
    } catch (err) {
      next(err);
    }
  }

  async removeToken(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const token = req.body?.token || req.query?.token;

      await fcmService.removeToken(userId, typeof token === 'string' ? token.trim() : undefined);
      ResponseUtil.success(res, true, 'Device token removed successfully.');
    } catch (err) {
      next(err);
    }
  }
}

export const mobileNotificationController = new MobileNotificationController();
