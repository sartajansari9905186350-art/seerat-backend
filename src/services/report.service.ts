import { withTransaction, query } from '../config/database';
import { reportRepository } from '../repositories/report.repository';
import { auditRepository } from '../repositories/audit.repository';
import { AuthTokenPayload } from '../models/admin.model';

export class ReportService {
  async listReports(options: { status?: string; reason?: string; targetType?: string; page: number; limit: number }) {
    return reportRepository.findAll(options);
  }

  async getReportDetails(id: string) {
    const report = await reportRepository.findById(id);
    if (!report) throw new Error('REPORT_NOT_FOUND');

    let targetDetails = null;
    if (report.target_type === 'POST') {
      const p = await query(
        `SELECT p.*, u.name as creator_name, u.username as creator_username FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = $1`,
        [report.target_id]
      );
      targetDetails = p.rows[0] || null;
    } else if (report.target_type === 'REEL') {
      const r = await query(
        `SELECT r.*, u.name as creator_name, u.username as creator_username, m.url as media_url, m.thumbnail_url FROM reels r JOIN users u ON r.user_id = u.id LEFT JOIN media m ON r.media_id = m.id WHERE r.id = $1`,
        [report.target_id]
      );
      targetDetails = r.rows[0] || null;
    } else if (report.target_type === 'USER') {
      const u = await query(`SELECT id, name, username, email, status FROM users WHERE id = $1`, [report.target_id]);
      targetDetails = u.rows[0] || null;
    }

    return { report, targetDetails };
  }

  async resolveReport(
    id: string,
    actionTaken: string,
    notes: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    return withTransaction(async (client) => {
      const reportRes = await client.query('SELECT * FROM reports WHERE id = $1', [id]);
      if (reportRes.rows.length === 0) throw new Error('REPORT_NOT_FOUND');
      const report = reportRes.rows[0];

      if (actionTaken === 'REMOVED_CONTENT') {
        if (report.target_type === 'POST') {
          await client.query(`UPDATE posts SET status = 'REMOVED', rejection_reason = $1 WHERE id = $2`, ['Removed due to verified report', report.target_id]);
        } else if (report.target_type === 'REEL') {
          await client.query(`UPDATE reels SET status = 'REMOVED', rejection_reason = $1 WHERE id = $2`, ['Removed due to verified report', report.target_id]);
        }
      } else if (actionTaken === 'SUSPENDED_USER') {
        const targetUserId = report.target_type === 'USER' ? report.target_id : null;
        if (targetUserId) {
          await client.query(`UPDATE users SET status = 'SUSPENDED', suspension_reason = $1 WHERE id = $2`, [notes || 'Suspended after report audit', targetUserId]);
        }
      }

      await client.query(
        `UPDATE reports 
         SET status = 'RESOLVED', action_taken = $1, resolution_notes = $2, resolved_by = $3, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [actionTaken, notes, admin.id, id]
      );

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'RESOLVED_REPORT',
          targetType: 'REPORT',
          targetId: id,
          reason: notes || `Resolved report with action ${actionTaken}`,
          details: { actionTaken, targetType: report.target_type, targetId: report.target_id },
          ipAddress,
          userAgent
        },
        client
      );
    });
  }

  async dismissReport(
    id: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    return withTransaction(async (client) => {
      const reportRes = await client.query('SELECT * FROM reports WHERE id = $1', [id]);
      if (reportRes.rows.length === 0) throw new Error('REPORT_NOT_FOUND');

      await client.query(
        `UPDATE reports 
         SET status = 'DISMISSED', action_taken = 'DISMISSED', resolved_by = $1, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [admin.id, id]
      );

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'DISMISSED_REPORT',
          targetType: 'REPORT',
          targetId: id,
          reason: 'Report inspected and dismissed',
          ipAddress,
          userAgent
        },
        client
      );
    });
  }
}

export const reportService = new ReportService();
