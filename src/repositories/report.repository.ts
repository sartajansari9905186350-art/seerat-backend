import { query } from '../config/database';
import { Report } from '../models/report.model';

export class ReportRepository {
  async findAll(options: {
    status?: string;
    reason?: string;
    targetType?: string;
    page: number;
    limit: number;
  }): Promise<{ reports: any[]; total: number }> {
    const { status, reason, targetType, page, limit } = options;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    if (reason && reason !== 'ALL') {
      params.push(reason);
      conditions.push(`r.reason = $${params.length}`);
    }

    if (targetType && targetType !== 'ALL') {
      params.push(targetType);
      conditions.push(`r.target_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.details,
             r.status, r.action_taken, r.resolution_notes, r.created_at, r.resolved_at,
             u.name as reporter_name, u.username as reporter_username,
             adm.name as resolved_by_name
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      LEFT JOIN admin_users adm ON r.resolved_by = adm.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const [dataRes, countRes] = await Promise.all([
      query(sql, params),
      query<{ total: string }>(`SELECT COUNT(*) as total FROM reports r ${whereClause}`, params.slice(0, conditions.length))
    ]);

    return {
      reports: dataRes.rows,
      total: parseInt(countRes.rows[0]?.total || '0', 10)
    };
  }

  async findById(id: string): Promise<any | null> {
    const res = await query(
      `SELECT r.*, u.name as reporter_name, u.username as reporter_username, u.email as reporter_email
       FROM reports r
       LEFT JOIN users u ON r.reporter_id = u.id
       WHERE r.id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }
}

export const reportRepository = new ReportRepository();
