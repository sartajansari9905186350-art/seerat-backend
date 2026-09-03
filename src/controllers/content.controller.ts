import { Response, NextFunction } from 'express';
import { contentRepository } from '../repositories/content.repository';
import { moderationService } from '../services/moderation.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { ContentType } from '../models/content.model';

export class ContentController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        contentType = 'ALL',
        category = 'ALL',
        status = 'ALL',
        search = '',
        page = '1',
        limit = '25'
      } = req.query;

      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 25;

      const result = await contentRepository.getUnifiedContent({
        contentType: contentType as string,
        category: category as string,
        status: status as string,
        search: search as string,
        page: pageNum,
        limit: limitNum
      });

      ResponseUtil.success(res, result.items, undefined, 200, {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        count: result.items.length
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { contentType = 'POST' } = req.query;

      const content = await contentRepository.findById(id, contentType as ContentType);
      if (!content) {
        ResponseUtil.error(res, 'NOT_FOUND', 'Content item not found.', 404);
        return;
      }

      ResponseUtil.success(res, content);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { contentType = 'POST', reason = 'Removed by administrator' } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await moderationService.removeContent(id, contentType, reason, admin, ipAddress, userAgent);

      ResponseUtil.success(res, { id, status: 'REMOVED' }, `${contentType} #${id.slice(0, 8)} removed successfully.`);
    } catch (err) {
      next(err);
    }
  }

  async restore(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { contentType = 'POST' } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await moderationService.restoreContent(id, contentType, admin, ipAddress, userAgent);

      ResponseUtil.success(res, { id, status: 'APPROVED' }, `${contentType} #${id.slice(0, 8)} restored to Approved status.`);
    } catch (err) {
      next(err);
    }
  }
}

export const contentController = new ContentController();
