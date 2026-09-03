import { Response, NextFunction } from 'express';
import { reportService } from '../services/report.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class ReportController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status = 'ALL', reason = 'ALL', targetType = 'ALL', page = '1', limit = '20' } = req.query;

      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 20;

      const result = await reportService.listReports({
        status: status as string,
        reason: reason as string,
        targetType: targetType as string,
        page: pageNum,
        limit: limitNum
      });

      ResponseUtil.success(res, result.reports, undefined, 200, {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        count: result.reports.length
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = await reportService.getReportDetails(id);
      ResponseUtil.success(res, data);
    } catch (err) {
      next(err);
    }
  }

  async resolve(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { actionTaken = 'NONE', notes = '' } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await reportService.resolveReport(id, actionTaken, notes, admin, ipAddress, userAgent);

      ResponseUtil.success(res, { id, status: 'RESOLVED' }, 'Report resolved successfully.');
    } catch (err) {
      next(err);
    }
  }

  async dismiss(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await reportService.dismissReport(id, admin, ipAddress, userAgent);

      ResponseUtil.success(res, { id, status: 'DISMISSED' }, 'Report dismissed.');
    } catch (err) {
      next(err);
    }
  }
}

export const reportController = new ReportController();
