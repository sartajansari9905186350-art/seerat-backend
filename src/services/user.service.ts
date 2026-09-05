import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../config/database';
import { userRepository } from '../repositories/user.repository';
import { auditRepository } from '../repositories/audit.repository';
import { AuthTokenPayload } from '../models/admin.model';

export class UserService {
  async listUsers(options: { status?: string; search?: string; page: number; limit: number }) {
    return userRepository.findAll(options);
  }

  async getUserDetails(id: string) {
    const user = await userRepository.findById(id);
    if (!user) throw new Error('USER_NOT_FOUND');

    const submissions = await userRepository.getUserSubmissions(id);
    const warningsRes = await query('SELECT * FROM user_warnings WHERE user_id = $1 ORDER BY created_at DESC', [id]);

    return {
      user,
      posts: submissions.posts,
      reels: submissions.reels,
      reports: submissions.reports,
      warnings: warningsRes.rows
    };
  }

  async warnUser(
    id: string,
    reason: string,
    notes: string = '',
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    return withTransaction(async (client) => {
      const user = await userRepository.findById(id);
      if (!user) throw new Error('USER_NOT_FOUND');

      const warningId = uuidv4();
      await client.query(
        `INSERT INTO user_warnings (id, user_id, admin_id, reason, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [warningId, id, admin.id, reason, notes || '']
      );

      // Create inbox notification for user
      await client.query(
        `INSERT INTO notifications (id, user_id, type, message, created_at)
         VALUES ($1, $2, 'SYSTEM_ANNOUNCEMENT', $3, CURRENT_TIMESTAMP)`,
        [uuidv4(), id, `Your account has received a warning: ${reason}${notes ? ' - ' + notes : ''}`]
      );

      // Record audit log
      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'WARNED_USER',
          targetType: 'USER',
          targetId: id,
          reason,
          details: { username: user.username, notes },
          ipAddress,
          userAgent
        },
        client
      );

      const countRes = await client.query('SELECT COUNT(*) as cnt FROM user_warnings WHERE user_id = $1', [id]);
      const warningCount = parseInt(countRes.rows[0]?.cnt || '1', 10);

      return { id, username: user.username, warningCount, reason };
    });
  }

  async suspendUser(
    id: string,
    reason: string,
    duration: string = '24h',
    customUntil: string | undefined,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    return withTransaction(async (client) => {
      const user = await userRepository.findById(id);
      if (!user) throw new Error('USER_NOT_FOUND');

      let suspendedUntil: Date;
      const now = new Date();
      if (duration === '24h') {
        suspendedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      } else if (duration === '7d') {
        suspendedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      } else if (duration === '30d') {
        suspendedUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      } else if (duration === 'custom' && customUntil) {
        suspendedUntil = new Date(customUntil);
        if (isNaN(suspendedUntil.getTime()) || suspendedUntil <= now) {
          suspendedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        }
      } else {
        suspendedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      }

      await client.query(
        `UPDATE users 
         SET status = 'SUSPENDED', suspension_reason = $1, suspended_at = CURRENT_TIMESTAMP, 
             suspended_until = $2, suspended_by = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [reason, suspendedUntil, admin.id, id]
      );

      // Temporarily hide user's approved content
      await client.query(`UPDATE posts SET status = 'SUSPENDED' WHERE user_id = $1 AND status = 'APPROVED'`, [id]);
      await client.query(`UPDATE reels SET status = 'SUSPENDED' WHERE user_id = $1 AND status = 'APPROVED'`, [id]);

      // Notify user
      await client.query(
        `INSERT INTO notifications (id, user_id, type, message, created_at)
         VALUES ($1, $2, 'SYSTEM_ANNOUNCEMENT', $3, CURRENT_TIMESTAMP)`,
        [uuidv4(), id, `Your account is temporarily suspended until ${suspendedUntil.toUTCString()}. Reason: ${reason}`]
      );

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'SUSPENDED_USER',
          targetType: 'USER',
          targetId: id,
          reason,
          details: { username: user.username, duration, suspendedUntil: suspendedUntil.toISOString() },
          ipAddress,
          userAgent
        },
        client
      );

      return { id, username: user.username, status: 'SUSPENDED', suspendedUntil: suspendedUntil.toISOString() };
    });
  }

  async banUser(
    id: string,
    reason: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    if (admin.role !== 'SUPER_ADMIN') {
      throw new Error('FORBIDDEN_SUPER_ADMIN_REQUIRED');
    }

    return withTransaction(async (client) => {
      const user = await userRepository.findById(id);
      if (!user) throw new Error('USER_NOT_FOUND');

      await client.query(
        `UPDATE users 
         SET status = 'BANNED', suspension_reason = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [reason, id]
      );

      // Hide content
      await client.query(`UPDATE posts SET status = 'SUSPENDED' WHERE user_id = $1 AND status = 'APPROVED'`, [id]);
      await client.query(`UPDATE reels SET status = 'SUSPENDED' WHERE user_id = $1 AND status = 'APPROVED'`, [id]);

      await client.query(
        `INSERT INTO notifications (id, user_id, type, message, created_at)
         VALUES ($1, $2, 'SYSTEM_ANNOUNCEMENT', $3, CURRENT_TIMESTAMP)`,
        [uuidv4(), id, `Your account has been permanently banned from SEERAT. Reason: ${reason}`]
      );

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'BANNED_USER',
          targetType: 'USER',
          targetId: id,
          reason,
          details: { username: user.username, elevatedRole: 'SUPER_ADMIN' },
          ipAddress,
          userAgent
        },
        client
      );

      return { id, username: user.username, status: 'BANNED' };
    });
  }

  async unsuspendUser(
    id: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    return withTransaction(async (client) => {
      const user = await userRepository.findById(id);
      if (!user) throw new Error('USER_NOT_FOUND');

      await client.query(
        `UPDATE users SET status = 'ACTIVE', suspension_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );

      // Restore user's suspended content back to APPROVED
      await client.query(`UPDATE posts SET status = 'APPROVED' WHERE user_id = $1 AND status = 'SUSPENDED'`, [id]);
      await client.query(`UPDATE reels SET status = 'APPROVED' WHERE user_id = $1 AND status = 'SUSPENDED'`, [id]);

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'UNSUSPENDED_USER',
          targetType: 'USER',
          targetId: id,
          reason: 'User account restored to active standing',
          details: { username: user.username },
          ipAddress,
          userAgent
        },
        client
      );

      return { id, username: user.username, status: 'ACTIVE' };
    });
  }

  async disableUser(
    id: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    return withTransaction(async (client) => {
      const user = await userRepository.findById(id);
      if (!user) throw new Error('USER_NOT_FOUND');

      await client.query(
        `UPDATE users SET status = 'DISABLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'DISABLED_USER',
          targetType: 'USER',
          targetId: id,
          reason: 'Permanently disabled account',
          ipAddress,
          userAgent
        },
        client
      );

      return { id, username: user.username, status: 'DISABLED' };
    });
  }
}

export const userService = new UserService();
