import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, rememberMe } = req.body;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      const result = await authService.login(email, password, rememberMe, ipAddress, userAgent);

      ResponseUtil.success(res, result, 'Authentication successful.');
    } catch (err) {
      next(err);
    }
  }

  async logout(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.admin) {
        const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
        const userAgent = req.headers['user-agent'];
        await authService.logout(req.admin, ipAddress, userAgent);
      }
      ResponseUtil.success(res, null, 'Logged out successfully.');
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.admin) {
        ResponseUtil.error(res, 'UNAUTHORIZED', 'Not authenticated', 401);
        return;
      }
      const profile = await authService.getProfile(req.admin.id);
      if (!profile) {
        ResponseUtil.error(res, 'NOT_FOUND', 'Admin user not found', 404);
        return;
      }
      ResponseUtil.success(res, profile);
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ResponseUtil.success(
        res,
        null,
        'If an active administrative account exists with this email, recovery instructions have been recorded.'
      );
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
