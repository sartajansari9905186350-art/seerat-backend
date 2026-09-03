import path from 'path';
import fs from 'fs';
import { logger } from '../src/utils/logger';

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');


const dataDir = path.resolve(__dirname, '../.data/postgres');

export const getPgInstance = () => {
  return new (EmbeddedPostgres as any)({
    port: 5432,
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
    persistent: true
  });
};

export const isPostgresRunning = async (): Promise<boolean> => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/postgres' });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    return true;
  } catch {
    return false;
  }
};

export const ensurePostgresRunning = async (): Promise<void> => {
  const alreadyRunning = await isPostgresRunning();
  if (alreadyRunning) {
    logger.info('[PostgreSQL Engine] Native PostgreSQL server is already active and accepting connections on port 5432.');
  } else {
    const pg = getPgInstance();
    if (!fs.existsSync(dataDir)) {
      logger.info(`[PostgreSQL Engine] Initializing persistent database cluster at ${dataDir}...`);
      await pg.initialise();
      logger.info('[PostgreSQL Engine] Database cluster initialized.');
    }

    try {
      logger.info('[PostgreSQL Engine] Starting native PostgreSQL server on port 5432...');
      await pg.start();
      logger.info('[PostgreSQL Engine] Native PostgreSQL server is running and ready for connections.');
    } catch (err: any) {
      logger.warn(`[PostgreSQL Engine] Startup notice: ${err?.message || err}`);
    }
  }

  // Ensure seerat_db exists
  try {
    const { Client } = require('pg');
    const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/postgres' });
    await client.connect();
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'seerat_db'");
    if (res.rowCount === 0) {
      logger.info('[PostgreSQL Engine] Creating production database "seerat_db" with UTF8 encoding...');
      await client.query("CREATE DATABASE seerat_db WITH ENCODING 'UTF8' TEMPLATE template0");
      logger.info('[PostgreSQL Engine] Database "seerat_db" created successfully.');
    } else {
      logger.info('[PostgreSQL Engine] Production database "seerat_db" verified.');
    }
    await client.end();
  } catch (err: any) {
    logger.debug(`[PostgreSQL Engine] DB check: ${err?.message || err}`);
  }
};

if (require.main === module) {
  ensurePostgresRunning()
    .then(() => {
      logger.info('[PostgreSQL Engine] Startup sequence completed.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('[PostgreSQL Engine] Startup failed:', err);
      process.exit(1);
    });
}

