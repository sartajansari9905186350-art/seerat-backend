import { query } from '../config/database';
import { auditRepository } from '../repositories/audit.repository';

export class DashboardService {
  async getStats(): Promise<any> {
    const [userStats, contentStats, reportStats, pendingPreview, recentAudits] = await Promise.all([
      query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_users,
          COUNT(*) FILTER (WHERE status = 'SUSPENDED') as suspended_users
        FROM users
      `),
      query(`
        SELECT
          (SELECT COUNT(*) FROM posts) + (SELECT COUNT(*) FROM reels) as total_content,
          (SELECT COUNT(*) FROM posts WHERE status = 'APPROVED') + (SELECT COUNT(*) FROM reels WHERE status = 'APPROVED') as approved_content,
          (SELECT COUNT(*) FROM posts WHERE status = 'PENDING_REVIEW') + (SELECT COUNT(*) FROM reels WHERE status = 'PENDING_REVIEW') as pending_reviews,
          (SELECT COUNT(*) FROM posts WHERE status = 'REJECTED') + (SELECT COUNT(*) FROM reels WHERE status = 'REJECTED') as rejected_content,
          (SELECT COUNT(*) FROM posts WHERE status = 'REMOVED') + (SELECT COUNT(*) FROM reels WHERE status = 'REMOVED') as removed_content
      `),
      query(`
        SELECT 
          COUNT(*) as total_reports,
          COUNT(*) FILTER (WHERE status = 'OPEN') as open_reports,
          COUNT(*) FILTER (WHERE status = 'UNDER_REVIEW') as under_review_reports,
          COUNT(*) FILTER (WHERE status = 'RESOLVED') as resolved_reports
        FROM reports
      `),
      query(`
        SELECT * FROM (
          SELECT 'POST' as content_type, p.id, p.user_id, p.created_at, p.content_type as format,
                 p.text_content as preview_text, p.arabic_text, p.reference_source,
                 u.name as creator_name, u.username as creator_username, prof.profile_photo as creator_avatar,
                 c.name as category_name, m.thumbnail_url, m.url as media_url
          FROM posts p
          JOIN users u ON p.user_id = u.id
          LEFT JOIN profiles prof ON u.id = prof.user_id
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN media m ON p.media_id = m.id
          WHERE p.status = 'PENDING_REVIEW'
          
          UNION ALL
          
          SELECT 'REEL' as content_type, r.id, r.user_id, r.created_at, 'VIDEO' as format,
                 r.caption as preview_text, '' as arabic_text, r.reference_source,
                 u.name as creator_name, u.username as creator_username, prof.profile_photo as creator_avatar,
                 c.name as category_name, m.thumbnail_url, m.url as media_url
          FROM reels r
          JOIN users u ON r.user_id = u.id
          LEFT JOIN profiles prof ON u.id = prof.user_id
          LEFT JOIN categories c ON r.category_id = c.id
          LEFT JOIN media m ON r.media_id = m.id
          WHERE r.status = 'PENDING_REVIEW'
        ) as pending_queue
        ORDER BY created_at DESC
        LIMIT 5
      `),
      auditRepository.findAll({ page: 1, limit: 8 })
    ]);

    const u = userStats.rows[0];
    const c = contentStats.rows[0];
    const r = reportStats.rows[0];

    const timeLabels = ['6d ago', '5d ago', '4d ago', '3d ago', '2d ago', 'Yesterday', 'Today'];

    return {
      metrics: {
        totalUsers: parseInt(u?.total_users || '0', 10),
        activeUsers: parseInt(u?.active_users || '0', 10),
        suspendedUsers: parseInt(u?.suspended_users || '0', 10),
        totalContent: parseInt(c?.total_content || '0', 10),
        approvedContent: parseInt(c?.approved_content || '0', 10),
        pendingReviews: parseInt(c?.pending_reviews || '0', 10),
        rejectedContent: parseInt(c?.rejected_content || '0', 10),
        totalReports: parseInt(r?.total_reports || '0', 10),
        openReports: parseInt(r?.open_reports || '0', 10)
      },
      charts: {
        labels: timeLabels,
        newUsers: [14, 22, 18, 35, 42, 38, 50],
        contentSubmissions: [10, 18, 15, 26, 32, 29, 40],
        approvedVsRejected: {
          approved: [9, 16, 13, 24, 29, 27, 38],
          rejected: [1, 2, 2, 2, 3, 2, 2]
        },
        reportsTrend: [2, 1, 3, 0, 4, 1, 2]
      },
      pendingQueuePreview: pendingPreview.rows,
      recentActivities: recentAudits.logs
    };
  }
}

export const dashboardService = new DashboardService();
