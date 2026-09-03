import { v4 as uuidv4 } from 'uuid';
import { withTransaction } from '../config/database';
import { auditRepository } from '../repositories/audit.repository';
import { contentRepository } from '../repositories/content.repository';
import { ContentType, RejectionReason } from '../models/content.model';
import { AuthTokenPayload } from '../models/admin.model';

export class ModerationService {
  async getQueue(options: {
    status?: string;
    contentType?: string;
    category?: string;
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
        `INSERT INTO notifications (id, user_id, type, message)
         VALUES ($1, $2, 'CONTENT_APPROVED', $3)`,
        [uuidv4(), userId, `Your Islamic ${contentType.toLowerCase()} has been approved and published to SEERAT.`]
      );

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
        `INSERT INTO notifications (id, user_id, type, message)
         VALUES ($1, $2, 'CONTENT_REJECTED', $3)`,
        [uuidv4(), userId, `Your submission could not be published. Reason: ${fullReason}`]
      );

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
}

export const moderationService = new ModerationService();
