import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { query } from '../config/database';
import { supabaseStorage } from '../services/supabaseStorage.service';
import { adminRepository } from '../repositories/admin.repository';

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

  async uploadProfilePhoto(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.admin) {
        ResponseUtil.error(res, 'UNAUTHORIZED', 'Not authenticated', 401);
        return;
      }

      if (!req.file) {
        ResponseUtil.error(res, 'NO_FILE', 'No photo file provided. Please include an image file under field name "photo".', 400);
        return;
      }

      const adminId = req.admin.id;
      const existing = await adminRepository.findById(adminId);
      const oldAvatar = existing?.avatar_url;

      // Upload to Supabase Storage
      const newPhotoUrl = await supabaseStorage.uploadProfilePhoto(req.file, 'admins', adminId);

      // Update in PostgreSQL
      await query(
        `UPDATE admin_users SET avatar_url = $1, admin_profile_photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newPhotoUrl, adminId]
      );

      // Clean up previous photo
      if (oldAvatar && oldAvatar !== newPhotoUrl) {
        await supabaseStorage.deleteProfilePhoto(oldAvatar);
      }

      const updated = await authService.getProfile(adminId);
      ResponseUtil.success(res, updated, 'Admin profile photo updated successfully.');
    } catch (err: any) {
      ResponseUtil.error(res, 'PHOTO_UPLOAD_FAILED', err.message || 'Failed to upload admin profile photo.', 400);
    }
  }

  async removeProfilePhoto(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.admin) {
        ResponseUtil.error(res, 'UNAUTHORIZED', 'Not authenticated', 401);
        return;
      }

      const adminId = req.admin.id;
      const existing = await adminRepository.findById(adminId);
      const oldAvatar = existing?.avatar_url;

      await query(
        `UPDATE admin_users SET avatar_url = '', admin_profile_photo_url = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [adminId]
      );

      if (oldAvatar) {
        await supabaseStorage.deleteProfilePhoto(oldAvatar);
      }

      const updated = await authService.getProfile(adminId);
      ResponseUtil.success(res, updated, 'Admin profile photo removed successfully.');
    } catch (err: any) {
      ResponseUtil.error(res, 'PHOTO_REMOVE_FAILED', err.message || 'Failed to remove admin profile photo.', 400);
    }
  }
}

export const authController = new AuthController();
