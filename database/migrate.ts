import fs from 'fs';
import path from 'path';
import { pool, testConnection } from '../src/config/database';
import { logger } from '../src/utils/logger';

export const runMigration = async (): Promise<void> => {
  logger.info('Starting PostgreSQL schema migration for SEERAT...');

  try {
    await testConnection();

    let schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      schemaPath = path.join(__dirname, '../../database/schema.sql');
    }
    if (!fs.existsSync(schemaPath)) {
      schemaPath = path.join(process.cwd(), 'database/schema.sql');
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query("SET client_encoding = 'UTF8'");
      await client.query('BEGIN');
      await client.query(sql);

      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_profile_completed BOOLEAN DEFAULT TRUE;`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'EMAIL';`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id VARCHAR(255);`);
      await client.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(1024) DEFAULT '';`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(1024) DEFAULT '';`);
      await client.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';`);
      await client.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;`);
      await client.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';`);
      await client.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;`);
      await client.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;`);
      await client.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';`);
      await client.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;`);
      await client.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';`);
      await client.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;`);
      await client.query(`ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;`);

      await client.query('COMMIT');
      logger.info('Database schema migration completed successfully.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error('CRITICAL: Database schema migration failed!', err);
    throw err;
  }
};

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
