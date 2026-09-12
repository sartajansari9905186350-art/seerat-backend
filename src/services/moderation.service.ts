import { v4 as uuidv4 } from 'uuid';
import { withTransaction } from '../config/database';
import { auditRepository } from '../repositories/audit.repository';
import { contentRepository } from '../repositories/content.repository';
import { ContentType, RejectionReason } from '../models/content.model';
import { AuthTokenPayload } from '../models/admin.model';
import { fcmService } from './fcm.service';

export class ModerationService {
  async getQueue(options: {
    status?: string;
    contentType?: string;
    category?: string;
    aiStatus?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    return contentRepository.getUnifiedContent(options);
  }

  async approveContent(
    id: string,
    contentType: ContentType,
    admin: AuthTokenPayload,
    notes: string = '',
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await withTransaction(async (client) => {
      const table = contentType === 'POST' ? 'posts' : 'reels';

      const updateRes = await client.query(
        `UPDATE ${table} 
         SET status = 'APPROVED', rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1 
         RETURNING user_id`,
        [id]
      );

      if (updateRes.rows.length === 0) {
        throw new Error('CONTENT_NOT_FOUND');
      }

      const userId = updateRes.rows[0].user_id;

      // Update / Record Moderation Review
      await client.query(
        `INSERT INTO moderation_reviews (id, content_type, content_id, user_id, status, notes, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, 'APPROVED', $5, $6, CURRENT_TIMESTAMP)`,
        [uuidv4(), contentType, id, userId, notes || 'Approved after Islamic review', admin.id]
      );

      // Notify User
      await client.query(
        `INSERT INTO notifications (id, user_id, type, ${contentType === 'POST' ? 'post_id' : 'reel_id'}, message)
         VALUES ($1, $2, 'CONTENT_APPROVED', $3, 'Your content has been approved and is now public.')`,
        [uuidv4(), userId, id]
      );
      fcmService.sendToUser(userId, {
        title: 'SEERAT',
        body: 'Your content has been approved and is now public.',
        data: {
          type: 'CONTENT_APPROVED',
          postId: contentType === 'POST' ? id : '',
          reelId: contentType === 'REEL' ? id : '',
          targetScreen: contentType === 'POST' ? 'POST_DETAIL' : 'REEL_DETAIL'
        }
      }).catch(() => {});

      // Record Audit Log
      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'APPROVED_CONTENT',
          targetType: contentType,
          targetId: id,
          reason: notes || 'Content approved after Islamic verification',
          ipAddress,
          userAgent
        },
        client
      );
    });
  }

  async rejectContent(
    id: string,
    contentType: ContentType,
    rejectionReason: RejectionReason,
    customNotes: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const fullReason = customNotes ? `${rejectionReason} - ${customNotes}` : rejectionReason;

    await withTransaction(async (client) => {
      const table = contentType === 'POST' ? 'posts' : 'reels';

      const updateRes = await client.query(
        `UPDATE ${table} 
         SET status = 'REJECTED', rejection_reason = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING user_id`,
        [fullReason, id]
      );

      if (updateRes.rows.length === 0) {
        throw new Error('CONTENT_NOT_FOUND');
      }

      const userId = updateRes.rows[0].user_id;

      await client.query(
        `INSERT INTO moderation_reviews (id, content_type, content_id, user_id, status, rejection_reason, notes, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, 'REJECTED', $5, $6, $7, CURRENT_TIMESTAMP)`,
        [uuidv4(), contentType, id, userId, rejectionReason, customNotes || '', admin.id]
      );

      await client.query(
        `INSERT INTO notifications (id, user_id, type, ${contentType === 'POST' ? 'post_id' : 'reel_id'}, message)
         VALUES ($1, $2, 'CONTENT_REJECTED', $3, $4)`,
        [uuidv4(), userId, id, `Your content was rejected. Reason: ${fullReason}`]
      );
      fcmService.sendToUser(userId, {
        title: 'SEERAT',
        body: `Your content was rejected. Reason: ${fullReason}`,
        data: {
          type: 'CONTENT_REJECTED',
          postId: contentType === 'POST' ? id : '',
          reelId: contentType === 'REEL' ? id : '',
          targetScreen: 'INBOX'
        }
      }).catch(() => {});

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'REJECTED_CONTENT',
          targetType: contentType,
          targetId: id,
          reason: fullReason,
          details: { rejectionReason, customNotes },
          ipAddress,
          userAgent
        },
        client
      );
    });
  }

  async flagContent(
    id: string,
    contentType: ContentType,
    notes: string = '',
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await withTransaction(async (client) => {
      const table = contentType === 'POST' ? 'posts' : 'reels';

      const updateRes = await client.query(
        `UPDATE ${table} 
         SET status = 'FLAGGED', rejection_reason = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING user_id`,
        [notes || 'Flagged for senior theological review', id]
      );

      if (updateRes.rows.length === 0) {
        throw new Error('CONTENT_NOT_FOUND');
      }

      const userId = updateRes.rows[0].user_id;

      await client.query(
        `INSERT INTO moderation_reviews (id, content_type, content_id, user_id, status, notes, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, 'FLAGGED', $5, $6, CURRENT_TIMESTAMP)`,
        [uuidv4(), contentType, id, userId, notes || 'Flagged for senior theological review', admin.id]
      );

      await client.query(
        `INSERT INTO admin_notifications (id, type, title, message, target_type, target_id, is_read)
         VALUES ($1, 'FLAGGED_CONTENT', 'Content Flagged for Senior Review', $2, $3, $4, FALSE)`,
        [uuidv4(), `${admin.name} flagged ${contentType} #${id.slice(0, 8)} for senior theological review: ${notes}`, contentType, id]
      );

      await client.query(
        `INSERT INTO notifications (id, user_id, type, ${contentType === 'POST' ? 'post_id' : 'reel_id'}, message)
         VALUES ($1, $2, 'CONTENT_FLAGGED', $3, 'Your content requires additional review.')`,
        [uuidv4(), userId, id]
      );
      fcmService.sendToUser(userId, {
        title: 'SEERAT',
        body: 'Your content requires additional review.',
        data: {
          type: 'CONTENT_FLAGGED',
          postId: contentType === 'POST' ? id : '',
          reelId: contentType === 'REEL' ? id : '',
          targetScreen: 'INBOX'
        }
      }).catch(() => {});

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'FLAGGED_CONTENT',
          targetType: contentType,
          targetId: id,
          reason: notes || 'Flagged for senior theological review',
          ipAddress,
          userAgent
        },
        client
      );
    });
  }

  async removeContent(
    id: string,
    contentType: ContentType,
    reason: string,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await withTransaction(async (client) => {
      const table = contentType === 'POST' ? 'posts' : 'reels';

      const updateRes = await client.query(
        `UPDATE ${table} 
         SET status = 'REMOVED', rejection_reason = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING id`,
        [reason, id]
      );

      if (updateRes.rows.length === 0) {
        throw new Error('CONTENT_NOT_FOUND');
      }

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'REMOVED_CONTENT',
          targetType: contentType,
          targetId: id,
          reason,
          ipAddress,
          userAgent
        },
        client
      );
    });
  }

  async restoreContent(
    id: string,
    contentType: ContentType,
    admin: AuthTokenPayload,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await withTransaction(async (client) => {
      const table = contentType === 'POST' ? 'posts' : 'reels';

      const updateRes = await client.query(
        `UPDATE ${table} 
         SET status = 'APPROVED', rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1 
         RETURNING id`,
        [id]
      );

      if (updateRes.rows.length === 0) {
        throw new Error('CONTENT_NOT_FOUND');
      }

      await auditRepository.record(
        {
          adminId: admin.id,
          adminName: admin.name,
          adminEmail: admin.email,
          action: 'RESTORED_CONTENT',
          targetType: contentType,
          targetId: id,
          reason: 'Restored to Approved status by moderator',
          ipAddress,
          userAgent
        },
        client
      );
    });
  }

  async bulkModeration(
    items: Array<{ id: string; contentType: ContentType }>,
    action: 'APPROVE' | 'REJECT' | 'FLAG',
    admin: AuthTokenPayload,
    rejectionReason?: RejectionReason,
    notes: string = '',
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    successCount: number;
    failureCount: number;
    results: Array<{ id: string; contentType: string; success: boolean; error?: string }>;
  }> {
    const results: Array<{ id: string; contentType: string; success: boolean; error?: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (const item of items) {
      try {
        if (action === 'APPROVE') {
          await this.approveContent(item.id, item.contentType, admin, notes, ipAddress, userAgent);
        } else if (action === 'REJECT') {
          const reason = rejectionReason || ('OTHER' as RejectionReason);
          await this.rejectContent(item.id, item.contentType, reason, notes, admin, ipAddress, userAgent);
        } else if (action === 'FLAG') {
          await this.flagContent(item.id, item.contentType, notes, admin, ipAddress, userAgent);
        }
        results.push({ id: item.id, contentType: item.contentType, success: true });
        successCount++;
      } catch (err: any) {
        results.push({ id: item.id, contentType: item.contentType, success: false, error: err.message });
        failureCount++;
      }
    }

    return { successCount, failureCount, results };
  }
}

export const moderationService = new ModerationService();
