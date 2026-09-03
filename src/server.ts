import app from './app';
import { env } from './config/env';
import { testConnection } from './config/database';
import { logger } from './utils/logger';

const startServer = async (): Promise<void> => {
  try {
    // Verify PostgreSQL connectivity
    await testConnection();

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
