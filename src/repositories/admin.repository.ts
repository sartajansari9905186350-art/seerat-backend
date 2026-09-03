import { query } from '../config/database';
import { AdminUser, AdminRole, AdminStatus } from '../models/admin.model';

export class AdminRepository {
  async findByEmail(email: string): Promise<AdminUser | null> {
    const res = await query<AdminUser>(
      `SELECT id, name, email, password_hash, role, status, avatar_url, last_login_at, created_at, updated_at
       FROM admin_users
       WHERE LOWER(email) = $1`,
      [email.toLowerCase().trim()]
    );
    return res.rows[0] || null;
  }

  async findById(id: string): Promise<AdminUser | null> {
    const res = await query<AdminUser>(
      `SELECT id, name, email, password_hash, role, status, avatar_url, last_login_at, created_at, updated_at
       FROM admin_users
       WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async findAll(): Promise<Omit<AdminUser, 'password_hash'>[]> {
    const res = await query<Omit<AdminUser, 'password_hash'>>(
      `SELECT id, name, email, role, status, avatar_url, last_login_at, created_at, updated_at
       FROM admin_users
       ORDER BY created_at ASC`
    );
    return res.rows;
  }

  async create(admin: { id: string; name: string; email: string; password_hash: string; role: AdminRole }): Promise<AdminUser> {
    const res = await query<AdminUser>(
      `INSERT INTO admin_users (id, name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
       RETURNING *`,
      [admin.id, admin.name, admin.email, admin.password_hash, admin.role]
    );
    return res.rows[0];
  }

  async updateLastLogin(id: string): Promise<void> {
    await query(`UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
  }

  async update(id: string, updates: { name?: string; role?: AdminRole; status?: AdminStatus }): Promise<AdminUser | null> {
    const fields: string[] = [];
    const params: any[] = [id];

    if (updates.name) {
      params.push(updates.name);
      fields.push(`name = $${params.length}`);
    }
    if (updates.role) {
      params.push(updates.role);
      fields.push(`role = $${params.length}`);
    }
    if (updates.status) {
      params.push(updates.status);
      fields.push(`status = $${params.length}`);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');

    const res = await query<AdminUser>(
      `UPDATE admin_users SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );
    return res.rows[0] || null;
  }

  async delete(id: string): Promise<AdminUser | null> {
    const res = await query<AdminUser>(
      `DELETE FROM admin_users WHERE id = $1 RETURNING *`,
      [id]
    );
    return res.rows[0] || null;
  }
}

export const adminRepository = new AdminRepository();
