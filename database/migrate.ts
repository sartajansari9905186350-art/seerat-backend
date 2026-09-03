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
