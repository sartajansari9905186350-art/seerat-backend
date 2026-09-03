import { query } from '../config/database';

export class SettingsRepository {
  async getAll(): Promise<{ settings: Record<string, any>; categories: any[] }> {
    const [settingsRes, categoriesRes] = await Promise.all([
      query('SELECT key, value, description, category, updated_at FROM system_settings'),
      query('SELECT id, name, slug, arabic_name, description, sort_order, is_active FROM categories ORDER BY sort_order ASC')
    ]);

    const settingsMap: Record<string, any> = {};
    settingsRes.rows.forEach(r => {
      settingsMap[r.key] = r.value;
    });

    return {
      settings: settingsMap,
      categories: categoriesRes.rows
    };
  }

  async update(key: string, value: any, adminId: string): Promise<any> {
    const res = await query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
       RETURNING key, value`,
      [key, JSON.stringify(value), adminId]
    );
    return res.rows[0];
  }
}

export const settingsRepository = new SettingsRepository();
