import app from './app';
import { env } from './config/env';
import { testConnection, query } from './config/database';
import { logger } from './utils/logger';
import { runMigration } from '../database/migrate';

const checkAndInitSchema = async (): Promise<void> => {
  try {
    // Ensure phone_otps table exists
    await query(`
      CREATE TABLE IF NOT EXISTS phone_otps (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50) NOT NULL,
        otp VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        attempts INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON phone_otps(phone);`);

    const res = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    if (!res.rows[0]?.exists) {
      logger.info('Database tables not found. Initializing PostgreSQL schema on database...');
      await runMigration();
      logger.info('Database schema initialized successfully.');
    } else {
      logger.info('Database tables verified. Ready for operation.');
    }

    // Ensure is_profile_completed column exists on users table
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_profile_completed BOOLEAN DEFAULT TRUE;`);
    } catch (colErr: any) {
      logger.warn('Could not ensure is_profile_completed column:', colErr.message);
    }


  } catch (err: any) {
    logger.warn('Schema check warning, attempting migration if needed:', err.message);
    try {
      await runMigration();
    } catch (migErr: any) {
      logger.error('Migration error:', migErr);
    }
  }
};

const startServer = async (): Promise<void> => {
  try {
    // Verify PostgreSQL connectivity
    await testConnection();

    // Check and initialize schema on fresh database if empty
    await checkAndInitSchema();

    app.listen(env.port, () => {
      logger.info(`=======================================================`);
      logger.info(`  SEERAT Admin Backend running on port: ${env.port}`);
      logger.info(`  Environment: ${env.nodeEnv}`);
      logger.info(`  Health Endpoint: http://localhost:${env.port}/api/health`);
      logger.info(`=======================================================`);
    });
  } catch (err: any) {
    logger.error('CRITICAL: Server startup failed due to database connection error.', err);
    process.exit(1);
  }
};

startServer();
