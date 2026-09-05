import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../config/database';
import { ResponseUtil } from '../utils/response';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';

export class MobileReportController {
  async submitReport(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const reporterId = req.user!.id;
      const { targetType, targetId, reason, details } = req.body;

      if (!targetType || !targetId || !reason) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'targetType, targetId, and reason are required.', 400);
        return;
      }

      // Check for duplicate pending/open report from this user
      const existing = await query(
        `SELECT id FROM reports 
         WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status IN ('PENDING', 'OPEN')`,
        [reporterId, targetType, targetId]
      );
      if (existing.rows.length > 0) {
        ResponseUtil.error(res, 'DUPLICATE_REPORT', 'You have already submitted a report for this content. Our moderation team is reviewing it.', 409);
        return;
      }

      const reportId = uuidv4();

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
          [reportId, reporterId, targetType, targetId, reason, details || '']
        );

        // Notify Admin Panel
        await client.query(
          `INSERT INTO admin_notifications (id, type, title, message, target_type, target_id, is_read)
           VALUES ($1, 'NEW_REPORT', 'New Community Report', $2, $3, $4, FALSE)`,
          [uuidv4(), `User reported a ${targetType} for ${reason}.`, targetType, targetId]
        );
      });

      ResponseUtil.success(
        res,
        'Thank you. Your report has been submitted to the SEERAT moderation team for Islamic policy review.',
        'Report submitted successfully.',
        201
      );
    } catch (err) {
      next(err);
    }
  }
}

export const mobileReportController = new MobileReportController();
