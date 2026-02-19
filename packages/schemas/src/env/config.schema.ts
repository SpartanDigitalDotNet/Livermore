import { z } from 'zod';

/**
 * Runtime mode determines which services and validation schemas are active.
 * - 'exchange': Full trading instance (Coinbase, Clerk, Discord, etc.)
 * - 'pw-host': Headless price-watcher host (DB + Redis + API only)
 */
export type RuntimeMode = 'exchange' | 'pw-host';

/**
 * Read LIVERMORE_MODE from process.env and return a validated RuntimeMode.
 * Defaults to 'exchange' when unset. Throws on invalid values.
 * Must be called BEFORE validateEnv() so the correct schema is selected.
 */
export function resolveMode(): RuntimeMode {
  const raw = process.env.LIVERMORE_MODE?.toLowerCase() ?? 'exchange';
  if (raw !== 'exchange' && raw !== 'pw-host') {
    throw new Error(`Invalid LIVERMORE_MODE: '${raw}'. Must be 'exchange' or 'pw-host'.`);
  }
  return raw;
}

/**
 * Environment configuration schema
 * Validates all required environment variables on application startup
 *
 * CRITICAL: This uses the actual environment variable names from the user's system
 */
export const EnvConfigSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // API Server
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()).default('3000'),

  // PostgreSQL Database
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()).default('5432'),
  DATABASE_LIVERMORE_USERNAME: z.string().min(1, 'Database username is required'),
  DATABASE_LIVERMORE_PASSWORD: z.string().min(1, 'Database password is required'),
  LIVERMORE_DATABASE_NAME: z.string().min(1, 'Database name is required'),

  // Redis connection (3 separate vars — URL is constructed at runtime, never stored)
  // LIVERMORE_REDIS_URL is the hostname (e.g., 'redis-livermore-sandbox')
  LIVERMORE_REDIS_URL: z.string().min(1, 'Redis host is required'),
  LIVERMORE_REDIS_PORT: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()).default('6379'),
  LIVERMORE_REDIS_SECRET: z.string().min(1, 'Redis password is required'),

  // Coinbase API credentials
  Coinbase_ApiKeyId: z.string().min(1, 'Coinbase API key ID is required'),
  Coinbase_EcPrivateKeyPem: z.string().min(1, 'Coinbase EC private key (PEM format) is required'),

  // Discord webhook
  DISCORD_LIVERMORE_BOT: z.string().url('Invalid Discord webhook URL'),

  // Clerk Authentication
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'Clerk publishable key is required'),
  CLERK_SECRET_KEY: z.string().min(1, 'Clerk secret key is required'),

  // Clerk Webhook (optional in development - required for production webhook handling)
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),
});

/**
 * Validated environment configuration type
 */
export type EnvConfig = z.infer<typeof EnvConfigSchema>;

/**
 * pw-host mode environment schema.
 * Keeps shared fields (API, DB, Redis) but omits exchange-specific credentials
 * (Coinbase, Clerk, Discord) that pw-host instances don't need.
 */
export const PwHostEnvConfigSchema = EnvConfigSchema.omit({
  Coinbase_ApiKeyId: true,
  Coinbase_EcPrivateKeyPem: true,
  CLERK_PUBLISHABLE_KEY: true,
  CLERK_SECRET_KEY: true,
  CLERK_WEBHOOK_SIGNING_SECRET: true,
  DISCORD_LIVERMORE_BOT: true,
});

/**
 * Validated pw-host environment configuration type
 */
export type PwHostEnvConfig = z.infer<typeof PwHostEnvConfigSchema>;

/**
 * Hardcoded configuration values (not from environment variables)
 */
export const HARDCODED_CONFIG = {
  // Coinbase API URLs
  coinbase: {
    apiUrl: 'https://api.coinbase.com',
    wsUrl: 'wss://ws-feed.exchange.coinbase.com',
  },

  // Database connection pool
  database: {
    poolSize: 10,
    connectionTimeoutMs: 5000,
  },

  // Redis configuration
  redis: {
    maxRetries: 3,
    retryDelayMs: 1000,
    commandTimeoutMs: 5000,
  },

  // WebSocket reconnection
  websocket: {
    reconnectDelayMs: 5000,
    maxReconnectAttempts: 10,
  },

  // Cache TTL (Time To Live)
  cache: {
    candleTtlHours: 24,
    tickerTtlSeconds: 60,
    orderbookTtlSeconds: 30,
  },

  // Alert system
  alerts: {
    throttleWindowMs: 300000, // 5 minutes
    evaluationIntervalMs: 1000, // Check every 1 second
  },

  // Indicator calculation
  indicators: {
    batchSize: 100, // Process 100 candles at a time
    maxHistoricalCandles: 1000,
  },
} as const;

/**
 * Helper type for hardcoded config
 */
export type HardcodedConfig = typeof HARDCODED_CONFIG;
