import { query } from '../config/database';

export class NotificationRepository {
  async getAdminNotifications(limit: number = 30): Promise<{ notifications: any[]; unreadCount: number }> {
    const res = await query(
      `SELECT id, type, title, message, target_type, target_id, is_read, created_at
       FROM admin_notifications
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    const unreadCount = res.rows.filter(n => !n.is_read).length;
    return {
      notifications: res.rows,
      unreadCount
    };
  }

  async markAsRead(id: string): Promise<void> {
    await query('UPDATE admin_notifications SET is_read = TRUE WHERE id = $1', [id]);
  }

  async markAllAsRead(): Promise<void> {
    await query('UPDATE admin_notifications SET is_read = TRUE');
  }

  async create(notification: { type: string; title: string; message: string; targetType?: string; targetId?: string }): Promise<void> {
    await query(
      `INSERT INTO admin_notifications (type, title, message, target_type, target_id, is_read)
       VALUES ($1, $2, $3, $4, $5, FALSE)`,
      [notification.type, notification.title, notification.message, notification.targetType || null, notification.targetId || null]
    );
  }
}

export const notificationRepository = new NotificationRepository();
