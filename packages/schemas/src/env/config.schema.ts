import { z } from 'zod';

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

  // Redis
  REDIS_URL: z.string().url('Invalid Redis URL'),

  // Coinbase API credentials
  Coinbase_ApiKeyId: z.string().min(1, 'Coinbase API key ID is required'),
  Coinbase_EcPrivateKeyPem: z.string().min(1, 'Coinbase EC private key (PEM format) is required'),

  // Discord webhook
  DISCORD_LIVERMORE_BOT: z.string().url('Invalid Discord webhook URL'),
});

/**
 * Validated environment configuration type
 */
export type EnvConfig = z.infer<typeof EnvConfigSchema>;

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
