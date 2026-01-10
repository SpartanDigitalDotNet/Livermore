import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { logger, validateEnv } from '@livermore/utils';
import { getDbClient } from '@livermore/database';
import { getRedisClient } from '@livermore/cache';
import { CoinbaseWebSocketService } from './services/coinbase-websocket.service';

/**
 * Livermore API Server
 *
 * Fastify-based backend server with tRPC endpoints
 * Handles Coinbase data ingestion and real-time updates
 */
async function start() {
  logger.info('🚀 Starting Livermore API server...');

  // Validate environment variables
  const config = validateEnv();
  logger.info('✅ Environment variables validated');

  // Create Fastify instance
  const fastify = Fastify({
    logger: false, // Using pino logger directly
  });

  // Register plugins
  await fastify.register(cors, {
    origin: true, // Allow all origins in development
  });

  await fastify.register(websocket);

  // Initialize database connection
  const db = getDbClient();
  logger.info('✅ Database connection established');

  // Initialize Redis connection
  const redis = getRedisClient();
  logger.info('✅ Redis connection established');

  // Health check endpoint
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
      },
    };
  });

  // Start Coinbase WebSocket data ingestion
  const coinbaseWsService = new CoinbaseWebSocketService(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem
  );

  await coinbaseWsService.start(['BTC-USD', 'ETH-USD', 'SOL-USD']);
  logger.info('✅ Coinbase WebSocket service started');

  // Start server
  const port = config.API_PORT;
  const host = config.API_HOST;

  try {
    await fastify.listen({ port, host });
    logger.info(`🎉 Server listening on ${host}:${port}`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down server...');

    coinbaseWsService.stop();
    await redis.quit();
    await fastify.close();

    logger.info('Server shut down successfully');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Start the server
start().catch((error) => {
  logger.error({ error: error?.message || error, stack: error?.stack }, 'Fatal error during server startup');
  console.error('Full error:', error);
  process.exit(1);
});
