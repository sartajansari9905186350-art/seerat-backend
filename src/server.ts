import app from './app';
import { env } from './config/env';
import { testConnection, query } from './config/database';
import { logger } from './utils/logger';
import { runMigration } from '../database/migrate';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

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
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'EMAIL';`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id VARCHAR(255);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_users_provider_user_id ON users(provider_user_id);`);
    } catch (colErr: any) {
      logger.warn('Could not ensure user provider and profile columns:', colErr.message);
    }

    // Ensure profile photo columns exist across users, profiles, and admin_users
    try {
      await query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(1024) DEFAULT '';`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(1024) DEFAULT '';`);
      await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(1024) DEFAULT '';`);
      await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS admin_profile_photo_url VARCHAR(1024) DEFAULT '';`);
      await query(`
        UPDATE users u
        SET profile_photo_url = p.profile_photo
        FROM profiles p
        WHERE u.id = p.user_id AND (u.profile_photo_url IS NULL OR u.profile_photo_url = '') AND p.profile_photo IS NOT NULL AND p.profile_photo != '';
      `);
      await query(`
        UPDATE admin_users
        SET admin_profile_photo_url = avatar_url
        WHERE (admin_profile_photo_url IS NULL OR admin_profile_photo_url = '') AND avatar_url IS NOT NULL AND avatar_url != '';
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS profile_photo_blobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(100) NOT NULL,
          filename VARCHAR(255) UNIQUE NOT NULL,
          mime_type VARCHAR(100) NOT NULL,
          image_data BYTEA NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_profile_photo_blobs_filename ON profile_photo_blobs(filename);
      `);
    } catch (photoColErr: any) {
      logger.warn('Could not ensure profile photo columns:', photoColErr.message);
    }

    // Ensure AI Islamic Content Moderation columns exist across posts, reels, and moderation_reviews
    try {
      await query(`
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;

        ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';
        ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;
        ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';
        ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE reels ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;

        ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'UNCERTAIN';
        ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(4,3) DEFAULT 0.500;
        ALTER TABLE moderation_reviews ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';
      `);
      logger.info('AI Content Moderation database schema verified.');
    } catch (aiColErr: any) {
      logger.warn('Could not ensure AI moderation columns:', aiColErr.message);
    }

    // Ensure authorized Super Admin accounts exist, are active, and have valid bcrypt credentials
    try {
      const adminTableCheck = await query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'admin_users'
        );
      `);

      if (adminTableCheck.rows[0]?.exists) {
        const existingAdmins = await query(`
          SELECT id, name, email, role, status, password_hash
          FROM admin_users
        `);

        logger.info(`[ADMIN CHECK] Found ${existingAdmins.rows.length} admin accounts in production database.`);

        const salt = await bcrypt.genSalt(12);
        const superAdminPass = process.env.ADMIN_INITIAL_PASSWORD || 'Seerat@99051';
        const superAdminHash = await bcrypt.hash(superAdminPass, salt);
        const altAdminHash = await bcrypt.hash('Admin@Seerat2026!', salt);
        const modHash = await bcrypt.hash('Mod@Seerat2026!', salt);

        // 1. Primary Authorized Super Admin: helpwaladost@gmail.com
        const primaryAdmin = existingAdmins.rows.find((a: any) => a.email.toLowerCase() === 'helpwaladost@gmail.com');
        if (!primaryAdmin) {
          logger.info('[ADMIN RECOVERY] Restoring primary SUPER_ADMIN (helpwaladost@gmail.com)...');
          await query(
            `INSERT INTO admin_users (id, name, email, password_hash, role, status, avatar_url)
             VALUES ($1, 'Sartaj Ansari', 'helpwaladost@gmail.com', $2, 'SUPER_ADMIN', 'ACTIVE', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150')
             ON CONFLICT (email) DO UPDATE
             SET role = 'SUPER_ADMIN', status = 'ACTIVE', password_hash = EXCLUDED.password_hash`,
            [uuidv4(), superAdminHash]
          );
        } else {
          logger.info('[ADMIN RECOVERY] Verifying and updating primary SUPER_ADMIN record...');
          await query(
            `UPDATE admin_users
             SET role = 'SUPER_ADMIN',
                 status = 'ACTIVE',
                 password_hash = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [superAdminHash, primaryAdmin.id]
          );
        }

        // 2. Platform Super Admin: admin@seerat.app
        const altAdmin = existingAdmins.rows.find((a: any) => a.email.toLowerCase() === 'admin@seerat.app');
        if (!altAdmin) {
          logger.info('[ADMIN RECOVERY] Restoring platform SUPER_ADMIN (admin@seerat.app)...');
          await query(
            `INSERT INTO admin_users (id, name, email, password_hash, role, status, avatar_url)
             VALUES ($1, 'SEERAT Chief Administrator', 'admin@seerat.app', $2, 'SUPER_ADMIN', 'ACTIVE', '')
             ON CONFLICT (email) DO UPDATE
             SET role = 'SUPER_ADMIN', status = 'ACTIVE', password_hash = EXCLUDED.password_hash`,
            [uuidv4(), altAdminHash]
          );
        } else {
          logger.info('[ADMIN RECOVERY] Verifying and updating platform SUPER_ADMIN record...');
          await query(
            `UPDATE admin_users
             SET role = 'SUPER_ADMIN',
                 status = 'ACTIVE',
                 password_hash = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [altAdminHash, altAdmin.id]
          );
        }

        // 3. Content Moderator: moderator@seerat.app
        const modAdmin = existingAdmins.rows.find((a: any) => a.email.toLowerCase() === 'moderator@seerat.app');
        if (!modAdmin) {
          await query(
            `INSERT INTO admin_users (id, name, email, password_hash, role, status, avatar_url)
             VALUES ($1, 'Zayd Al-Ansari', 'moderator@seerat.app', $2, 'MODERATOR', 'ACTIVE', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150')
             ON CONFLICT (email) DO UPDATE
             SET role = 'MODERATOR', status = 'ACTIVE', password_hash = EXCLUDED.password_hash`,
            [uuidv4(), modHash]
          );
        }
      }
    } catch (adminInitErr: any) {
      logger.warn('[ADMIN RECOVERY] Admin check warning:', adminInitErr.message);
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
