import { Response, NextFunction } from 'express';
import { notificationRepository } from '../repositories/notification.repository';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class NotificationController {
  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await notificationRepository.getAdminNotifications();
      ResponseUtil.success(res, data);
    } catch (err) {
      next(err);
    }
  }

  async markRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await notificationRepository.markAsRead(id);
      ResponseUtil.success(res, null, 'Notification marked as read.');
    } catch (err) {
      next(err);
    }
  }

  async markAllRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await notificationRepository.markAllAsRead();
      ResponseUtil.success(res, null, 'All notifications marked as read.');
    } catch (err) {
      next(err);
    }
  }
}

export const notificationController = new NotificationController();
