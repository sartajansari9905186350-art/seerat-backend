import { Response, NextFunction } from 'express';
import { auditRepository } from '../repositories/audit.repository';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class AuditController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { action = 'ALL', targetType = 'ALL', adminId = 'ALL', search = '', page = '1', limit = '30' } = req.query;

      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 30;

      const result = await auditRepository.findAll({
        action: action as string,
        targetType: targetType as string,
        adminId: adminId as string,
        search: search as string,
        page: pageNum,
        limit: limitNum
      });

      ResponseUtil.success(res, result.logs, undefined, 200, {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        count: result.logs.length
      });
    } catch (err) {
      next(err);
    }
  }
}

export const auditController = new AuditController();
