import { withTransaction } from '../config/database';
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

    return {
      user,
      posts: submissions.posts,
      reels: submissions.reels,
      reports: submissions.reports
    };
  }

  async suspendUser(
    id: string,
    reason: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ) {
    return withTransaction(async (client) => {
      const user = await userRepository.findById(id);
      if (!user) throw new Error('USER_NOT_FOUND');

      await client.query(
        `UPDATE users SET status = 'SUSPENDED', suspension_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [reason, id]
      );

      // Temporarily hide user's approved content
      await client.query(`UPDATE posts SET status = 'SUSPENDED' WHERE user_id = $1 AND status = 'APPROVED'`, [id]);
      await client.query(`UPDATE reels SET status = 'SUSPENDED' WHERE user_id = $1 AND status = 'APPROVED'`, [id]);

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'SUSPENDED_USER',
          targetType: 'USER',
          targetId: id,
          reason,
          details: { username: user.username, name: user.name },
          ipAddress,
          userAgent
        },
        client
      );

      return { id, username: user.username, status: 'SUSPENDED' };
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
