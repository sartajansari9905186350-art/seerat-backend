import { pool } from '../src/config/database';

async function applyUpdates() {
  console.log('Connecting to database and applying idempotent schema updates...');
  
  await pool.query(`
    -- Add suspension columns to users
    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP WITH TIME ZONE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by UUID;

    -- Create not_interested_reels table
    CREATE TABLE IF NOT EXISTS not_interested_reels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reel_id UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_not_interested UNIQUE (user_id, reel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_not_interested_user ON not_interested_reels(user_id);
    CREATE INDEX IF NOT EXISTS idx_not_interested_reel ON not_interested_reels(reel_id);

    -- Create user_warnings table
    CREATE TABLE IF NOT EXISTS user_warnings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
        reason VARCHAR(255) NOT NULL,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_user_warnings_user ON user_warnings(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_warnings_created_at ON user_warnings(created_at DESC);

    -- Unique index on reports to prevent duplicates for open/pending reports
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reporter_target ON reports(reporter_id, target_type, target_id) WHERE status IN ('PENDING', 'OPEN');
  `);

  console.log('✅ Schema updates applied successfully!');
  await pool.end();
}

applyUpdates().catch(err => {
  console.error('❌ Schema update error:', err);
  process.exit(1);
});
