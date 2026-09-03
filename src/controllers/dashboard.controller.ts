import { Request, Response, NextFunction } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { ResponseUtil } from '../utils/response';

export class DashboardController {
  async getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await dashboardService.getStats();
      ResponseUtil.success(res, stats);
    } catch (err) {
      next(err);
    }
  }
}

export const dashboardController = new DashboardController();
