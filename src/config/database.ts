import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

const isProductionOrCloud =
  env.nodeEnv === 'production' ||
  (Boolean(env.databaseUrl) && (
    env.databaseUrl.includes('supabase') ||
    env.databaseUrl.includes('render.com') ||
    env.databaseUrl.includes('sslmode=require') ||
    env.databaseUrl.includes('.pooler.')
  ));

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isProductionOrCloud ? { rejectUnauthorized: false } : undefined
});

pool.on('connect', (client) => {
  client.query("SET client_encoding = 'UTF8'");
});

pool.on('error', (err) => {
  logger.error('Unexpected database client error in connection pool', err);
});

export const testConnection = async (): Promise<void> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const res = await client.query('SELECT NOW()');
    logger.info(`PostgreSQL database connected successfully. DB Time: ${res.rows[0].now}`);
  } catch (err: any) {
    logger.error(`CRITICAL: PostgreSQL database connection failed at ${env.databaseUrl}: ${err.message}`);
    throw err;
  } finally {
    if (client) client.release();
  }
};

export const query = async <T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => {
  return pool.query<T>(text, params);
};

/**
 * Execute operations within an atomic PostgreSQL transaction (ACID compliant)
 */
export const withTransaction = async <T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

