import { query } from '../config/database';
import { UserDetailDTO } from '../models/user.model';

export class UserRepository {
  async findAll(options: {
    status?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<{ users: UserDetailDTO[]; total: number }> {
    const { status, search, page, limit } = options;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`u.status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.toLowerCase().trim()}%`);
      conditions.push(
        `(LOWER(u.name) LIKE $${params.length} OR LOWER(u.username) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length} OR CAST(u.id AS TEXT) LIKE $${params.length})`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT u.id, u.name, u.username, u.email, u.phone, u.status, u.is_verified, u.suspension_reason, u.created_at, u.updated_at,
             p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count,
             0 as report_count
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const countSql = `SELECT COUNT(*) as total FROM users u ${whereClause}`;

    const [dataRes, countRes] = await Promise.all([
      query<UserDetailDTO>(sql, params),
      query<{ total: string }>(countSql, params.slice(0, conditions.length))
    ]);

    return {
      users: dataRes.rows,
      total: parseInt(countRes.rows[0]?.total || '0', 10)
    };
  }

  async findById(id: string): Promise<UserDetailDTO | null> {
    const res = await query<UserDetailDTO>(
      `SELECT u.id, u.name, u.username, u.email, u.phone, u.status, u.is_verified, u.suspension_reason, u.created_at, u.updated_at,
              p.bio, p.profile_photo, p.followers_count, p.following_count, p.posts_count, p.reels_count, p.likes_count, p.website
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED', reason?: string): Promise<UserDetailDTO | null> {
    const res = await query<UserDetailDTO>(
      `UPDATE users 
       SET status = $1, suspension_reason = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3 
       RETURNING *`,
      [status, reason || null, id]
    );
    return res.rows[0] || null;
  }

  async getUserSubmissions(userId: string): Promise<{ posts: any[]; reels: any[]; reports: any[] }> {
    const [posts, reels, reports] = await Promise.all([
      query(
        `SELECT p.*, c.name as category_name
         FROM posts p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 15`,
        [userId]
      ),
      query(
        `SELECT r.*, c.name as category_name, m.thumbnail_url, m.url as video_url
         FROM reels r
         LEFT JOIN categories c ON r.category_id = c.id
         LEFT JOIN media m ON r.media_id = m.id
         WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 15`,
        [userId]
      ),
      query(
        `SELECT r.*, u.name as reporter_name, u.username as reporter_username
         FROM reports r
         LEFT JOIN users u ON r.reporter_id = u.id
         WHERE r.target_id = $1 ORDER BY r.created_at DESC LIMIT 15`,
        [userId]
      )
    ]);

    return {
      posts: posts.rows,
      reels: reels.rows,
      reports: reports.rows
    };
  }
}

export const userRepository = new UserRepository();
