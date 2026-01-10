import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { logger, validateEnv } from '@livermore/utils';
import { getDbClient } from '@livermore/database';
import { getRedisClient } from '@livermore/cache';
import { createContext } from '@livermore/trpc-config';
import { CoinbaseWebSocketService } from './services/coinbase-websocket.service';
import { IndicatorCalculationService } from './services/indicator-calculation.service';
import { AlertEvaluationService } from './services/alert-evaluation.service';
import { getDiscordService } from './services/discord-notification.service';
import { appRouter } from './routers';
import type { Timeframe } from '@livermore/schemas';

// Supported symbols and timeframes
const SUPPORTED_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
const SUPPORTED_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

/**
 * Livermore API Server
 *
 * Fastify-based backend server with tRPC endpoints
 * Handles Coinbase data ingestion, indicator calculation, and alerts
 */
async function start() {
  logger.info('Starting Livermore API server...');

  // Validate environment variables
  const config = validateEnv();
  logger.info('Environment variables validated');

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
  getDbClient(); // Initialize connection
  logger.info('Database connection established');

  // Initialize Redis connection
  const redis = getRedisClient();
  logger.info('Redis connection established');

  // Initialize Discord notification service
  const discordService = getDiscordService();
  if (discordService.isEnabled()) {
    logger.info('Discord notifications enabled');
  } else {
    logger.warn('Discord notifications disabled (DISCORD_LIVERMORE_BOT not set)');
  }

  // Register tRPC router
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }: { path: string | undefined; error: Error }) {
        logger.error({ path, error: error.message }, 'tRPC error');
      },
    },
  });
  logger.info('tRPC router registered at /trpc');

  // Health check endpoint
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
        discord: discordService.isEnabled() ? 'enabled' : 'disabled',
      },
    };
  });

  // Start Coinbase WebSocket data ingestion
  const coinbaseWsService = new CoinbaseWebSocketService(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem
  );

  await coinbaseWsService.start(SUPPORTED_SYMBOLS);
  logger.info('Coinbase WebSocket service started');

  // Start Indicator Calculation Service
  const indicatorService = new IndicatorCalculationService(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem
  );

  // Build indicator configs for all symbol/timeframe combinations
  const indicatorConfigs = SUPPORTED_SYMBOLS.flatMap((symbol) =>
    SUPPORTED_TIMEFRAMES.map((timeframe) => ({ symbol, timeframe }))
  );

  await indicatorService.start(indicatorConfigs);
  logger.info('Indicator Calculation Service started');

  // Start Alert Evaluation Service
  const alertService = new AlertEvaluationService();
  await alertService.start(SUPPORTED_SYMBOLS, SUPPORTED_TIMEFRAMES);
  logger.info('Alert Evaluation Service started');

  // Send startup notification to Discord
  if (discordService.isEnabled()) {
    await discordService.sendSystemNotification(
      'Livermore Server Started',
      `Server is now online and monitoring ${SUPPORTED_SYMBOLS.join(', ')}`
    );
  }

  // Start server
  const port = config.API_PORT;
  const host = config.API_HOST;

  try {
    await fastify.listen({ port, host });
    logger.info(`Server listening on ${host}:${port}`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down server...');

    // Stop services in reverse order
    await alertService.stop();
    indicatorService.stop();
    coinbaseWsService.stop();

    // Send shutdown notification
    if (discordService.isEnabled()) {
      await discordService.sendSystemNotification(
        'Livermore Server Stopped',
        'Server is shutting down'
      ).catch(() => {}); // Ignore errors during shutdown
    }

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
