// CRITICAL: dotenv must be imported FIRST - Clerk reads CLERK_SECRET_KEY during ES module initialization
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { logger, validateEnv } from '@livermore/utils';
import { getDbClient, testDatabaseConnection } from '@livermore/database';
import { getRedisClient, testRedisConnection, deleteKeysClusterSafe, exchangeCandleKey, exchangeIndicatorKey } from '@livermore/cache';
import { createContext } from '@livermore/trpc-config';
import { StartupBackfillService, BoundaryRestService, DEFAULT_BOUNDARY_CONFIG } from '@livermore/coinbase-client';
import { ExchangeAdapterFactory } from './services/exchange/adapter-factory';
import { SymbolSourceService } from './services/symbol-source.service';
import { getAccountSymbols } from './services/account-symbols.service';
import { IndicatorCalculationService } from './services/indicator-calculation.service';
import { AlertEvaluationService } from './services/alert-evaluation.service';
import { getDiscordService } from './services/discord-notification.service';
import { ControlChannelService } from './services/control-channel.service';
import { initRuntimeState, getRuntimeState } from './services/runtime-state';
import { appRouter } from './routers';
import { clerkWebhookHandler } from './routes/webhooks/clerk';
import type { Timeframe } from '@livermore/schemas';
import type { ServiceRegistry, RuntimeConfig } from './services/types/service-registry';
import type { WebSocket } from 'ws';

// WebSocket clients for alert broadcasts
const alertClients = new Set<WebSocket>();

/**
 * Broadcast an alert to all connected WebSocket clients
 */
export function broadcastAlert(alert: {
  id: number;
  symbol: string;
  alertType: string;
  timeframe: string | null;
  price: number;
  triggerValue: number | null;
  /**
   * signalDelta = macdV - signal (where signal = EMA(macdV, 9))
   * - Positive: macdV is above its signal line (bullish momentum / recovering)
   * - Negative: macdV is below its signal line (bearish momentum / falling)
   */
  signalDelta: number | null;
  triggeredAt: string;
  /** Phase 27 VIS-03: Source exchange ID for cross-exchange visibility */
  sourceExchangeId?: number;
  /** Phase 27 VIS-03: Source exchange name for display */
  sourceExchangeName?: string;
}): void {
  const message = JSON.stringify({ type: 'alert_trigger', data: alert });
  for (const client of alertClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  }
  if (alertClients.size > 0) {
    logger.debug({ clientCount: alertClients.size, symbol: alert.symbol }, 'Broadcasted alert to WebSocket clients');
  }
}

// Blacklisted symbols (delisted, stablecoins, or no valid USD trading pair)

// Control channel service is initialized lazily on first authenticated request
// The user ID comes from the Clerk authentication context, not an environment variable
let controlChannelService: ControlChannelService | null = null;
let controlChannelInitPromise: Promise<void> | null = null;
let globalServiceRegistry: ServiceRegistry | null = null;

/**
 * Initialize the Control Channel Service lazily with the authenticated user's ID
 * Called on first authenticated request - subsequent calls are no-ops
 *
 * @param clerkUserId - The Clerk user ID from authenticated request (e.g., user_xxxxx)
 */
export async function initControlChannelService(clerkUserId: string): Promise<void> {
  // Already initialized
  if (controlChannelService) {
    return;
  }

  // Already initializing - wait for it
  if (controlChannelInitPromise) {
    return controlChannelInitPromise;
  }

  // No service registry yet (server still starting)
  if (!globalServiceRegistry) {
    logger.warn('Control Channel init called before server ready, skipping');
    return;
  }

  // Start initialization
  controlChannelInitPromise = (async () => {
    logger.info({ clerkUserId }, 'Initializing Control Channel Service for user');
    controlChannelService = new ControlChannelService(clerkUserId, globalServiceRegistry!);
    await controlChannelService.start();
    logger.info({ clerkUserId, hasServices: true }, 'Control Channel Service started');
  })();

  return controlChannelInitPromise;
}

// Supported timeframes for indicator calculation
const SUPPORTED_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

/**
 * Parse CLI arguments for startup control (Phase 26 CTL-03)
 * Supports: --autostart <exchange>
 */
function parseCliArgs(): { autostart: string | null } {
  const args = process.argv.slice(2);
  let autostart: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--autostart' && args[i + 1]) {
      autostart = args[i + 1].toLowerCase();
      break;
    }
  }

  return { autostart };
}


/**
 * Clean up Redis cache for excluded symbols
 * Removes candles, indicators, and tickers for symbols no longer being monitored
 */
async function cleanupExcludedSymbols(
  redis: ReturnType<typeof getRedisClient>,
  excludedSymbols: string[],
  timeframes: Timeframe[]
): Promise<void> {
  if (excludedSymbols.length === 0) return;

  // Phase 29: Use exchange-scoped keys (v5.0) instead of user-scoped
  const exchangeId = 1; // Coinbase

  const keysToDelete: string[] = [];

  for (const symbol of excludedSymbols) {
    // Ticker key (still exchange-scoped, format: ticker:{exchangeId}:{symbol})
    keysToDelete.push(`ticker:${exchangeId}:${symbol}`);

    // Candle and indicator keys for all timeframes (exchange-scoped)
    for (const timeframe of timeframes) {
      keysToDelete.push(exchangeCandleKey(exchangeId, symbol, timeframe));
      keysToDelete.push(exchangeIndicatorKey(exchangeId, symbol, timeframe, 'macd-v'));
    }
  }

  if (keysToDelete.length > 0) {
    const deleted = await deleteKeysClusterSafe(redis, keysToDelete);
    logger.info(
      { excludedCount: excludedSymbols.length, keysDeleted: deleted, symbols: excludedSymbols },
      'Cleaned up Redis cache for excluded symbols'
    );
  }
}

/**
 * Livermore API Server
 *
 * Fastify-based backend server with tRPC endpoints
 * Handles Coinbase data ingestion, indicator calculation, and alerts
 */
async function start() {
  // Parse CLI arguments (Phase 26 CTL-03)
  const cliArgs = parseCliArgs();
  const isAutostart = cliArgs.autostart !== null;

  logger.info(
    { autostart: isAutostart, exchange: cliArgs.autostart },
    'Starting Livermore API server...'
  );

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

  // WEBHOOK ROUTE - must be registered BEFORE clerkPlugin
  // This route does NOT require JWT authentication (server-to-server)
  fastify.post('/webhooks/clerk', clerkWebhookHandler);
  logger.info('Clerk webhook route registered at /webhooks/clerk');

  // Register Clerk authentication plugin (must be before tRPC so getAuth works in context)
  await fastify.register(clerkPlugin);
  logger.info('Clerk authentication plugin registered');

  // ============================================
  // PRE-FLIGHT CONNECTION CHECKS
  // Fail fast if database or Redis are unavailable
  // ============================================
  logger.info('Running pre-flight connection checks...');

  // Initialize and test database connection
  const db = getDbClient();
  await testDatabaseConnection(db);

  // Initialize and test Redis connection
  const redis = getRedisClient();
  await testRedisConnection(redis);

  // Create separate Redis subscriber connection (required for psubscribe - cannot share with main client)
  const subscriberRedis = redis.duplicate();
  await testRedisConnection(subscriberRedis);

  logger.info('Pre-flight checks passed - all connections verified');

  // Initialize Discord notification service
  const discordService = getDiscordService();
  if (discordService.isEnabled()) {
    logger.info('Discord notifications enabled');
  } else {
    logger.warn('Discord notifications disabled (DISCORD_LIVERMORE_BOT not set)');
  }

  const EXCHANGE_ID = 1; // Coinbase

  // Symbol loading: only fetch from exchange on autostart, otherwise defer to start command
  let monitoredSymbols: string[] = [];

  if (isAutostart) {
    // Autostart: fetch symbols now (we have API keys, need data before connecting)
    const symbolSourceService = new SymbolSourceService(EXCHANGE_ID);
    logger.info('Fetching symbols from Coinbase account...');
    const { monitored: userPositionSymbols, excluded: excludedSymbols } = await getAccountSymbols(
      config.Coinbase_ApiKeyId,
      config.Coinbase_EcPrivateKeyPem
    );

    const classifiedSymbols = await symbolSourceService.classifyUserPositions(userPositionSymbols);
    monitoredSymbols = classifiedSymbols.map(s => s.symbol);

    logger.info(
      { total: monitoredSymbols.length, excluded: excludedSymbols.length, symbols: monitoredSymbols },
      'Loaded and classified symbols from account'
    );

    await cleanupExcludedSymbols(redis, excludedSymbols, SUPPORTED_TIMEFRAMES);

    // Backfill cache with historical candles
    logger.info('Starting cache backfill...');
    const backfillTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
    const backfillService = new StartupBackfillService(
      config.Coinbase_ApiKeyId,
      config.Coinbase_EcPrivateKeyPem,
      redis
    );
    await backfillService.backfill(monitoredSymbols, backfillTimeframes);
    logger.info('Cache backfill complete');
  } else {
    // Idle mode: no exchange calls. Symbols loaded when user sends "start" command.
    logger.info('Idle mode - deferring symbol loading until "start" command');
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
    const runtimeState = getRuntimeState();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
        discord: discordService.isEnabled() ? 'enabled' : 'disabled',
        controlChannel: 'active',
      },
      // Phase 26: Connection state info
      exchange: {
        connectionState: runtimeState.connectionState,
        connected: runtimeState.exchangeConnected,
      },
    };
  });

  // WebSocket route for real-time alert notifications
  fastify.get('/ws/alerts', { websocket: true }, (socket) => {
    alertClients.add(socket);
    logger.info({ clientCount: alertClients.size }, 'Alert WebSocket client connected');

    socket.on('close', () => {
      alertClients.delete(socket);
      logger.info({ clientCount: alertClients.size }, 'Alert WebSocket client disconnected');
    });

    socket.on('error', (error) => {
      logger.error({ error }, 'Alert WebSocket error');
      alertClients.delete(socket);
    });
  });

  // Create service instances (but don't start them yet in idle mode)
  const indicatorService = new IndicatorCalculationService(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem
  );

  // Build indicator configs for all symbol/timeframe combinations
  const indicatorConfigs = monitoredSymbols.flatMap((symbol) =>
    SUPPORTED_TIMEFRAMES.map((timeframe) => ({ symbol, timeframe }))
  );

  const boundaryRestService = new BoundaryRestService(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem,
    redis,
    subscriberRedis,
    {
      userId: DEFAULT_BOUNDARY_CONFIG.userId,
      exchangeId: DEFAULT_BOUNDARY_CONFIG.exchangeId,
      higherTimeframes: ['15m', '1h', '4h', '1d'],
    }
  );

  // Phase 29: Use ExchangeAdapterFactory instead of direct instantiation
  const adapterFactory = new ExchangeAdapterFactory({
    apiKeyId: config.Coinbase_ApiKeyId,
    privateKeyPem: config.Coinbase_EcPrivateKeyPem,
    redis,
    userId: 1,  // TODO: Get from authenticated user context
  });
  const coinbaseAdapter = await adapterFactory.create(EXCHANGE_ID);

  const alertService = new AlertEvaluationService();

  // Phase 26: Only start data services if autostart is enabled
  if (isAutostart) {
    // Step 2: Start Indicator Calculation Service (must start before WebSocket)
    await indicatorService.start(indicatorConfigs);
    logger.info('Indicator Calculation Service started (subscribed to Redis candle:close events)');

    // Step 2.5: Warmup - force initial indicator calculations from cached candles
    logger.info('Warming up indicators from cached candles...');
    let warmupCount = 0;
    for (const cfg of indicatorConfigs) {
      await indicatorService.forceRecalculate(cfg.symbol, cfg.timeframe);
      warmupCount++;
    }
    logger.info({ warmupCount }, 'Indicator warmup complete');

    // Step 3: Start BoundaryRestService
    await boundaryRestService.start(monitoredSymbols);
    logger.info('BoundaryRestService started (subscribed to 5m candle:close events)');

    // Step 4: Start Coinbase Adapter
    await coinbaseAdapter.connect();
    coinbaseAdapter.subscribe(monitoredSymbols, '5m');
    logger.info('Coinbase Adapter started (5m candles)');

    // Start Alert Evaluation Service
    await alertService.start(monitoredSymbols, SUPPORTED_TIMEFRAMES);

    // Initialize runtime state as connected
    initRuntimeState({
      isPaused: false,
      mode: 'position-monitor',
      exchangeConnected: true,
      connectionState: 'connected',
      connectionStateChangedAt: Date.now(),
      queueDepth: 0,
    });
  } else {
    // Phase 26 CTL-01: Idle startup mode
    logger.info('Server starting in IDLE mode - awaiting "start" command');
    initRuntimeState({
      isPaused: false,
      mode: 'position-monitor',
      exchangeConnected: false,
      connectionState: 'idle',
      connectionStateChangedAt: Date.now(),
      queueDepth: 0,
    });
  }

  // ============================================
  // BUILD SERVICE REGISTRY AND START CONTROL CHANNEL
  // Now that all services are created, build registry and start control channel
  // ============================================

  // Build RuntimeConfig with API credentials
  const runtimeConfig: RuntimeConfig = {
    apiKeyId: config.Coinbase_ApiKeyId,
    privateKeyPem: config.Coinbase_EcPrivateKeyPem,
  };

  // Build ServiceRegistry for ControlChannelService command handlers
  const serviceRegistry: ServiceRegistry = {
    coinbaseAdapter,
    indicatorService,
    alertService,
    boundaryRestService,
    redis,
    db,
    config: runtimeConfig,
    // Store symbols and configs for resume
    monitoredSymbols,
    indicatorConfigs,
    timeframes: SUPPORTED_TIMEFRAMES,
    // Phase 29: New services (populated during autostart, otherwise set by start command)
    adapterFactory,
  };

  // Store service registry globally for lazy control channel initialization
  globalServiceRegistry = serviceRegistry;

  // Control Channel Service will be started lazily on first authenticated request
  // This avoids requiring CLERK_USER_ID environment variable at startup
  logger.info('Control Channel Service will start on first authenticated request');

  // Send startup notification to Discord
  if (discordService.isEnabled()) {
    const startupMessage = isAutostart
      ? `Server is now online and monitoring ${monitoredSymbols.length} symbols: ${monitoredSymbols.join(', ')}`
      : `Server started in IDLE mode (use 'start' command to connect)`;
    await discordService.sendSystemNotification(
      'Livermore Server Started',
      startupMessage
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

    // Stop Control Channel first (no new commands accepted)
    if (controlChannelService) {
      await controlChannelService.stop();
    }

    // Stop services in reverse order
    await alertService.stop();
    coinbaseAdapter.disconnect();
    await boundaryRestService.stop();
    await indicatorService.stop();

    // Close subscriber Redis connection
    await subscriberRedis.quit();

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
