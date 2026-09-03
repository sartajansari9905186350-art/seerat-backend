import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import { query } from '../config/database';
import { AdminAuditLog, AuditAction, AuditTargetType } from '../models/audit.model';
import { logger } from '../utils/logger';

export class AuditRepository {
  async record(
    log: {
      adminId?: string;
      adminName: string;
      adminEmail: string;
      action: AuditAction;
      targetType: AuditTargetType;
      targetId?: string;
      reason?: string;
      details?: Record<string, any>;
      ipAddress?: string;
      userAgent?: string;
    },
    client?: PoolClient
  ): Promise<void> {
    const sql = `
      INSERT INTO admin_audit_logs (id, admin_id, admin_name, admin_email, action, target_type, target_id, reason, details, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    const params = [
      uuidv4(),
      log.adminId || null,
      log.adminName,
      log.adminEmail,
      log.action,
      log.targetType,
      log.targetId ? String(log.targetId) : null,
      log.reason || '',
      JSON.stringify(log.details || {}),
      log.ipAddress || '127.0.0.1',
      log.userAgent || ''
    ];

    try {
      if (client) {
        await client.query(sql, params);
      } else {
        await query(sql, params);
      }
    } catch (err) {
      logger.error('Failed to append to immutable admin audit log:', err);
    }
  }

  async findAll(options: {
    action?: string;
    targetType?: string;
    adminId?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<{ logs: AdminAuditLog[]; total: number }> {
    const { action, targetType, adminId, search, page, limit } = options;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (action && action !== 'ALL') {
      params.push(action);
      conditions.push(`action = $${params.length}`);
    }

    if (targetType && targetType !== 'ALL') {
      params.push(targetType);
      conditions.push(`target_type = $${params.length}`);
    }

    if (adminId && adminId !== 'ALL') {
      params.push(adminId);
      conditions.push(`admin_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.toLowerCase().trim()}%`);
      conditions.push(
        `(LOWER(admin_name) LIKE $${params.length} OR LOWER(admin_email) LIKE $${params.length} OR LOWER(reason) LIKE $${params.length} OR CAST(target_id AS TEXT) LIKE $${params.length})`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT id, admin_id, admin_name, admin_email, action, target_type, target_id,
             reason, details, ip_address, user_agent, created_at
      FROM admin_audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const [dataRes, countRes] = await Promise.all([
      query<AdminAuditLog>(sql, params),
      query<{ total: string }>(`SELECT COUNT(*) as total FROM admin_audit_logs ${whereClause}`, params.slice(0, conditions.length))
    ]);

    return {
      logs: dataRes.rows,
      total: parseInt(countRes.rows[0]?.total || '0', 10)
    };
  }
}

export const auditRepository = new AuditRepository();
