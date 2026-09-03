import { Response, NextFunction } from 'express';
import { userService } from '../services/user.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class UserController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status = 'ALL', search = '', page = '1', limit = '20' } = req.query;

      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 20;

      const result = await userService.listUsers({
        status: status as string,
        search: search as string,
        page: pageNum,
        limit: limitNum
      });

      ResponseUtil.success(res, result.users, undefined, 200, {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        count: result.users.length
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = await userService.getUserDetails(id);
      ResponseUtil.success(res, data);
    } catch (err) {
      next(err);
    }
  }

  async suspend(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      const result = await userService.suspendUser(id, reason, admin, ipAddress, userAgent);

      ResponseUtil.success(res, result, `User @${result.username} suspended.`);
    } catch (err) {
      next(err);
    }
  }

  async unsuspend(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      const result = await userService.unsuspendUser(id, admin, ipAddress, userAgent);

      ResponseUtil.success(res, result, `User @${result.username} unsuspended.`);
    } catch (err) {
      next(err);
    }
  }

  async disable(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      const result = await userService.disableUser(id, admin, ipAddress, userAgent);

      ResponseUtil.success(res, result, `User @${result.username} disabled.`);
    } catch (err) {
      next(err);
    }
  }
}

export const userController = new UserController();
