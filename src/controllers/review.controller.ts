import { Response, NextFunction } from 'express';
import { moderationService } from '../services/moderation.service';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class ReviewController {
  async getQueue(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        status = 'PENDING_REVIEW',
        contentType,
        category,
        aiStatus,
        search,
        page = '1',
        limit = '20'
      } = req.query;

      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 20;

      const result = await moderationService.getQueue({
        status: status as string,
        contentType: contentType as string,
        category: category as string,
        aiStatus: aiStatus as string,
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

  async approve(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { contentType = 'POST', notes = '' } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await moderationService.approveContent(id, contentType, admin, notes, ipAddress, userAgent);

      ResponseUtil.success(res, { id, status: 'APPROVED' }, `${contentType} #${id.slice(0, 8)} approved and published.`);
    } catch (err) {
      next(err);
    }
  }

  async reject(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { contentType = 'POST', rejectionReason, customNotes = '' } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await moderationService.rejectContent(id, contentType, rejectionReason, customNotes, admin, ipAddress, userAgent);

      ResponseUtil.success(res, { id, status: 'REJECTED' }, `${contentType} #${id.slice(0, 8)} rejected with reason recorded.`);
    } catch (err) {
      next(err);
    }
  }

  async flag(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { contentType = 'POST', notes = '' } = req.body;
      const admin = req.admin!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      await moderationService.flagContent(id, contentType, notes, admin, ipAddress, userAgent);

      ResponseUtil.success(res, { id, status: 'FLAGGED' }, `${contentType} #${id.slice(0, 8)} flagged for senior theological review.`);
    } catch (err) {
      next(err);
    }
  }

  async bulk(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { items, action, rejectionReason, notes = '' } = req.body;
      const admin = req.admin!;

      if (!Array.isArray(items) || items.length === 0) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Items array is required and cannot be empty.', 400);
        return;
      }

      if (!['APPROVE', 'REJECT', 'FLAG'].includes(action)) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Action must be APPROVE, REJECT, or FLAG.', 400);
        return;
      }

      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'];

      const result = await moderationService.bulkModeration(
        items,
        action,
        admin,
        rejectionReason,
        notes,
        ipAddress,
        userAgent
      );

      ResponseUtil.success(
        res,
        result,
        `Processed ${items.length} items: ${result.successCount} succeeded, ${result.failureCount} failed.`
      );
    } catch (err) {
      next(err);
    }
  }
}

export const reviewController = new ReviewController();

