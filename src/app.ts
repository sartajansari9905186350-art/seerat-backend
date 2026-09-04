import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import adminRouter from './routes/index';
import { mobileRouter } from './routes/mobile.routes';
import { apiRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { env } from './config/env';
import { logger } from './utils/logger';
import { query } from './config/database';
import { ResponseUtil } from './utils/response';

const app: Express = express();

// Security Headers
app.use(helmet());

// CORS Policy
app.use(cors({
  origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request Logging
app.use(morgan('combined', { stream: { write: (msg: string) => logger.info(msg.trim()) } }));

// Rate Limiting
app.use('/api/', apiRateLimiter);

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await query('SELECT 1 as healthy');
    let adminsCount = 0;
    let adminAccounts: any[] = [];

    try {
      const adminCheck = await query(`
        SELECT id, name, email, role, status, 
               (password_hash IS NOT NULL AND (password_hash LIKE '$2a$%' OR password_hash LIKE '$2b$%' OR password_hash LIKE '$2y$%') AND LENGTH(password_hash) = 60) as has_valid_bcrypt_hash,
               created_at
        FROM admin_users
        ORDER BY created_at ASC
      `);
      adminsCount = adminCheck.rows.length;
      adminAccounts = adminCheck.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        status: r.status,
        has_valid_bcrypt_hash: r.has_valid_bcrypt_hash,
        created_at: r.created_at
      }));
    } catch (adminErr: any) {
      // Table might not exist yet
    }

    ResponseUtil.success(res, {
      status: 'healthy',
      database: 'connected',
      admins_count: adminsCount,
      admin_accounts: adminAccounts,
      timestamp: new Date()
    });
  } catch (err: any) {
    ResponseUtil.error(res, 'DB_ERROR', 'Database connectivity error', 500, err.message);
  }
});

// Mount Admin REST API
app.use('/api/admin', adminRouter);

// Mount Mobile App REST API
app.use('/api', mobileRouter);

// Centralized Error Handling
app.use(errorHandler);

export default app;
