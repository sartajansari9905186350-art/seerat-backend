import { Response, NextFunction } from 'express';
import { staffService } from '../services/staff.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class StaffController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const staff = await staffService.listStaff();
      ResponseUtil.success(res, staff);
    } catch (err) {
      next(err);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, email, password, role } = req.body;
      const currentAdmin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      const created = await staffService.createStaff(
        { name, email, passwordPlain: password, role },
        currentAdmin,
        ipAddress,
        userAgent
      );

      ResponseUtil.success(res, created, `Staff member "${created.name}" created successfully.`, 201);
    } catch (err) {
      next(err);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { name, role, status } = req.body;
      const currentAdmin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      const updated = await staffService.updateStaff(
        id,
        { name, role, status },
        currentAdmin,
        ipAddress,
        userAgent
      );

      ResponseUtil.success(res, updated, `Staff member "${updated.name}" updated successfully.`);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const currentAdmin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await staffService.deleteStaff(id, currentAdmin, ipAddress, userAgent);

      ResponseUtil.success(res, null, 'Staff member removed.');
    } catch (err) {
      next(err);
    }
  }
}

export const staffController = new StaffController();
