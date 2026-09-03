import { Response, NextFunction } from 'express';
import { settingsService } from '../services/settings.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class SettingsController {
  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await settingsService.getSettings();
      ResponseUtil.success(res, data);
    } catch (err) {
      next(err);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { key, value } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      if (!key || typeof value !== 'object') {
        ResponseUtil.error(res, 'BAD_REQUEST', 'Setting key and JSON value payload are required.', 400);
        return;
      }

      const updated = await settingsService.updateSetting(key, value, admin, ipAddress, userAgent);
      ResponseUtil.success(res, updated, `Settings for "${key}" updated successfully.`);
    } catch (err) {
      next(err);
    }
  }
}

export const settingsController = new SettingsController();
