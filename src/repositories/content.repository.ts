import { query } from '../config/database';
import { ContentStatus, ContentType } from '../models/content.model';

export class ContentRepository {
  async getUnifiedContent(options: {
    contentType?: string;
    category?: string;
    status?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<{ items: any[]; total: number }> {
    const { contentType, category, status, search, page, limit } = options;
    const offset = (page - 1) * limit;

    const postConditions: string[] = [];
    const reelConditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'ALL') {
      params.push(status);
      postConditions.push(`p.status = $${params.length}`);
      reelConditions.push(`r.status = $${params.length}`);
    }

    if (category && category !== 'ALL') {
      params.push(category);
      postConditions.push(`(LOWER(c.slug) = LOWER($${params.length}) OR CAST(c.id AS TEXT) = $${params.length})`);
      reelConditions.push(`(LOWER(c.slug) = LOWER($${params.length}) OR CAST(c.id AS TEXT) = $${params.length})`);
    }

    if (search) {
      params.push(`%${search.toLowerCase().trim()}%`);
      postConditions.push(
        `(LOWER(u.name) LIKE $${params.length} OR LOWER(u.username) LIKE $${params.length} OR LOWER(p.text_content) LIKE $${params.length} OR CAST(p.id AS TEXT) LIKE $${params.length})`
      );
      reelConditions.push(
        `(LOWER(u.name) LIKE $${params.length} OR LOWER(u.username) LIKE $${params.length} OR LOWER(r.caption) LIKE $${params.length} OR CAST(r.id AS TEXT) LIKE $${params.length})`
      );
    }

    const postWhere = postConditions.length > 0 ? `WHERE ${postConditions.join(' AND ')}` : '';
    const reelWhere = reelConditions.length > 0 ? `WHERE ${reelConditions.join(' AND ')}` : '';

    let unionSql = '';
    let countUnionSql = '';

    if (contentType === 'POST') {
      unionSql = `
        SELECT 'POST' as content_type, p.id, p.user_id, p.category_id, p.content_type as format,
               p.text_content as caption, p.arabic_text, p.translation_text, p.reference_source,
               p.language, p.status, p.rejection_reason, p.likes_count, p.comments_count, p.shares_count, p.views_count,
               p.ai_status, p.ai_confidence, p.ai_reason, p.ai_analyzed_at, p.ai_metadata,
               p.created_at, p.updated_at,
               u.name as creator_name, u.username as creator_username, prof.profile_photo as creator_photo, u.is_verified as creator_verified,
               c.name as category_name, c.slug as category_slug,
               m.id as media_id, m.url as media_url, m.thumbnail_url, m.duration,
               0 as report_count
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN media m ON p.media_id = m.id
        ${postWhere}
      `;
      countUnionSql = `SELECT COUNT(*) as total FROM posts p JOIN users u ON p.user_id = u.id LEFT JOIN categories c ON p.category_id = c.id ${postWhere}`;
    } else if (contentType === 'REEL') {
      unionSql = `
        SELECT 'REEL' as content_type, r.id, r.user_id, r.category_id, 'VIDEO' as format,
               r.caption, '' as arabic_text, '' as translation_text, r.reference_source,
               r.language, r.status, r.rejection_reason, r.likes_count, r.comments_count, r.shares_count, r.views_count,
               r.ai_status, r.ai_confidence, r.ai_reason, r.ai_analyzed_at, r.ai_metadata,
               r.created_at, r.updated_at,
               u.name as creator_name, u.username as creator_username, prof.profile_photo as creator_photo, u.is_verified as creator_verified,
               c.name as category_name, c.slug as category_slug,
               m.id as media_id, m.url as media_url, m.thumbnail_url, m.duration,
               0 as report_count
        FROM reels r
        JOIN users u ON r.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON r.category_id = c.id
        LEFT JOIN media m ON r.media_id = m.id
        ${reelWhere}
      `;
      countUnionSql = `SELECT COUNT(*) as total FROM reels r JOIN users u ON r.user_id = u.id LEFT JOIN categories c ON r.category_id = c.id ${reelWhere}`;
    } else {
      unionSql = `
        SELECT 'POST' as content_type, p.id, p.user_id, p.category_id, p.content_type as format,
               p.text_content as caption, p.arabic_text, p.translation_text, p.reference_source,
               p.language, p.status, p.rejection_reason, p.likes_count, p.comments_count, p.shares_count, p.views_count,
               p.ai_status, p.ai_confidence, p.ai_reason, p.ai_analyzed_at, p.ai_metadata,
               p.created_at, p.updated_at,
               u.name as creator_name, u.username as creator_username, prof.profile_photo as creator_photo, u.is_verified as creator_verified,
               c.name as category_name, c.slug as category_slug,
               m.id as media_id, m.url as media_url, m.thumbnail_url, m.duration,
               0 as report_count
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN media m ON p.media_id = m.id
        ${postWhere}

        UNION ALL

        SELECT 'REEL' as content_type, r.id, r.user_id, r.category_id, 'VIDEO' as format,
               r.caption, '' as arabic_text, '' as translation_text, r.reference_source,
               r.language, r.status, r.rejection_reason, r.likes_count, r.comments_count, r.shares_count, r.views_count,
               r.ai_status, r.ai_confidence, r.ai_reason, r.ai_analyzed_at, r.ai_metadata,
               r.created_at, r.updated_at,
               u.name as creator_name, u.username as creator_username, prof.profile_photo as creator_photo, u.is_verified as creator_verified,
               c.name as category_name, c.slug as category_slug,
               m.id as media_id, m.url as media_url, m.thumbnail_url, m.duration,
               0 as report_count
        FROM reels r
        JOIN users u ON r.user_id = u.id
        LEFT JOIN profiles prof ON u.id = prof.user_id
        LEFT JOIN categories c ON r.category_id = c.id
        LEFT JOIN media m ON r.media_id = m.id
        ${reelWhere}
      `;
      countUnionSql = `
        SELECT (
          (SELECT COUNT(*) FROM posts p JOIN users u ON p.user_id = u.id LEFT JOIN categories c ON p.category_id = c.id ${postWhere})
          +
          (SELECT COUNT(*) FROM reels r JOIN users u ON r.user_id = u.id LEFT JOIN categories c ON r.category_id = c.id ${reelWhere})
        ) as total
      `;
    }

    const pagedSql = `
      SELECT * FROM (
        ${unionSql}
      ) as unified_items
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const [dataRes, countRes] = await Promise.all([
      query(pagedSql, params),
      query<{ total: string }>(countUnionSql, params.slice(0, params.length - 2))
    ]);

    return {
      items: dataRes.rows,
      total: parseInt(countRes.rows[0]?.total || '0', 10)
    };
  }

  async findById(id: string, contentType: ContentType): Promise<any | null> {
    const table = contentType === 'POST' ? 'posts' : 'reels';
    const res = await query(
      `SELECT c.*, u.name as creator_name, u.username as creator_username, u.email as creator_email, prof.profile_photo as creator_photo,
              cat.name as category_name, cat.slug as category_slug,
              m.url as media_url, m.thumbnail_url
       FROM ${table} c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN profiles prof ON u.id = prof.user_id
       LEFT JOIN categories cat ON c.category_id = cat.id
       LEFT JOIN media m ON c.media_id = m.id
       WHERE c.id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }
}

export const contentRepository = new ContentRepository();
