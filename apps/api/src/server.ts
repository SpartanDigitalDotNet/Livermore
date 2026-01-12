import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { logger, validateEnv } from '@livermore/utils';
import { getDbClient } from '@livermore/database';
import { getRedisClient } from '@livermore/cache';
import { createContext } from '@livermore/trpc-config';
import { CoinbaseRestClient } from '@livermore/coinbase-client';
import { CoinbaseWebSocketService } from './services/coinbase-websocket.service';
import { IndicatorCalculationService } from './services/indicator-calculation.service';
import { AlertEvaluationService } from './services/alert-evaluation.service';
import { getDiscordService } from './services/discord-notification.service';
import { appRouter } from './routers';
import type { Timeframe } from '@livermore/schemas';

// Blacklisted symbols (delisted, stablecoins, or no valid USD trading pair)
const BLACKLISTED_SYMBOLS = [
  // Delisted from Coinbase
  'MOBILE', 'SYN',
  // Stablecoins (no X-USD trading pair exists)
  'USD', 'USDC', 'USDT', 'DAI', 'GUSD', 'BUSD', 'PYUSD', 'USDP', 'TUSD', 'FRAX', 'LUSD', 'SUSD', 'EURC',
];

// Minimum position value to include in monitoring (USD)
const MIN_POSITION_VALUE_USD = 2;

// Supported timeframes for indicator calculation
const SUPPORTED_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface AccountSymbolsResult {
  /** Symbols meeting minimum value threshold */
  monitored: string[];
  /** Symbols excluded due to low value (for cleanup) */
  excluded: string[];
}

/**
 * Fetch trading symbols from Coinbase account holdings
 * Returns symbols with position value >= MIN_POSITION_VALUE_USD, excluding blacklisted and fiat
 */
async function getAccountSymbols(apiKeyId: string, privateKeyPem: string): Promise<AccountSymbolsResult> {
  const client = new CoinbaseRestClient(apiKeyId, privateKeyPem);
  const accounts = await client.getAccounts();

  // First pass: collect all non-zero crypto balances
  const holdings: { currency: string; balance: number }[] = [];

  for (const account of accounts) {
    // Skip fiat accounts
    if (account.type === 'ACCOUNT_TYPE_FIAT') continue;

    // Skip zero balances
    const balance = parseFloat(account.available_balance.value);
    if (balance <= 0) continue;

    // Skip blacklisted symbols
    const currency = account.currency;
    if (BLACKLISTED_SYMBOLS.includes(currency)) continue;

    holdings.push({ currency, balance });
  }

  // Get spot prices for all currencies
  const currencies = holdings.map((h) => h.currency);
  const prices = await client.getSpotPrices(currencies);

  // Filter by position value
  const monitored: string[] = [];
  const excluded: string[] = [];

  for (const { currency, balance } of holdings) {
    const price = prices.get(currency);
    const symbol = `${currency}-USD`;

    if (price === null || price === undefined) {
      // No price available - exclude from monitoring
      logger.debug({ currency }, 'No price available, excluding from monitoring');
      excluded.push(symbol);
      continue;
    }

    const positionValue = balance * price;

    if (positionValue >= MIN_POSITION_VALUE_USD) {
      monitored.push(symbol);
      logger.debug({ symbol, balance, price, positionValue: positionValue.toFixed(2) }, 'Including in monitoring');
    } else {
      excluded.push(symbol);
      logger.debug({ symbol, balance, price, positionValue: positionValue.toFixed(2) }, 'Excluding (below minimum)');
    }
  }

  // Deduplicate (Coinbase may return multiple accounts for same currency, e.g., vault + regular)
  const uniqueMonitored = [...new Set(monitored)];
  const uniqueExcluded = [...new Set(excluded)];

  return { monitored: uniqueMonitored, excluded: uniqueExcluded };
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

  const userId = 1; // Hardcoded for now
  const exchangeId = 1;

  const keysToDelete: string[] = [];

  for (const symbol of excludedSymbols) {
    // Ticker key
    keysToDelete.push(`ticker:${userId}:${exchangeId}:${symbol}`);

    // Candle and indicator keys for all timeframes
    for (const timeframe of timeframes) {
      keysToDelete.push(`candles:${userId}:${exchangeId}:${symbol}:${timeframe}`);
      keysToDelete.push(`indicator:${userId}:${exchangeId}:${symbol}:${timeframe}:macd-v`);
    }
  }

  if (keysToDelete.length > 0) {
    const deleted = await redis.del(...keysToDelete);
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

  // Fetch symbols from Coinbase account holdings (filtered by position value)
  logger.info('Fetching symbols from Coinbase account...');
  const { monitored: monitoredSymbols, excluded: excludedSymbols } = await getAccountSymbols(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem
  );
  logger.info(
    { monitored: monitoredSymbols, excluded: excludedSymbols, monitoredCount: monitoredSymbols.length, excludedCount: excludedSymbols.length },
    'Loaded symbols from account'
  );

  // Clean up Redis cache for excluded symbols (positions < $2)
  await cleanupExcludedSymbols(redis, excludedSymbols, SUPPORTED_TIMEFRAMES);

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

  await coinbaseWsService.start(monitoredSymbols);
  logger.info('Coinbase WebSocket service started');

  // Start Indicator Calculation Service
  const indicatorService = new IndicatorCalculationService(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem
  );

  // Build indicator configs for all symbol/timeframe combinations
  const indicatorConfigs = monitoredSymbols.flatMap((symbol) =>
    SUPPORTED_TIMEFRAMES.map((timeframe) => ({ symbol, timeframe }))
  );

  await indicatorService.start(indicatorConfigs);
  logger.info('Indicator Calculation Service started');

  // Start Alert Evaluation Service
  const alertService = new AlertEvaluationService();
  await alertService.start(monitoredSymbols, SUPPORTED_TIMEFRAMES);
  logger.info('Alert Evaluation Service started');

  // Send startup notification to Discord
  if (discordService.isEnabled()) {
    await discordService.sendSystemNotification(
      'Livermore Server Started',
      `Server is now online and monitoring ${monitoredSymbols.length} symbols: ${monitoredSymbols.join(', ')}`
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
