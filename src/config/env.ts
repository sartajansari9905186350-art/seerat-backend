import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const env = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/seerat_db',
  jwtSecret: process.env.JWT_SECRET || 'seerat_super_secure_jwt_token_secret_key_2026_islamic_app',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  jwtRememberExpiresIn: process.env.JWT_REMEMBER_EXPIRES_IN || '30d',
  storageProvider: process.env.STORAGE_PROVIDER || 'LOCAL',
  cdnBaseUrl: process.env.CDN_BASE_URL || 'https://cdn.seerat.app',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
  facebookAppId: process.env.FACEBOOK_APP_ID || '',
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET || '',
  supabaseUrl: process.env.SUPABASE_URL || (() => {
    // Attempt auto-discovery from Supabase DATABASE_URL if provided
    const dbUrl = process.env.DATABASE_URL || '';
    const match = dbUrl.match(/postgres\.([a-z0-9_-]+):/) || dbUrl.match(/@db\.([a-z0-9_-]+)\.supabase/);
    return match ? `https://${match[1]}.supabase.co` : '';
  })(),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'profile-photos'
};
