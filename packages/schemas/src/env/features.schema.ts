import { z } from 'zod';

/**
 * Feature flags schema for environment.json
 *
 * IMPORTANT: This file contains NO secrets or sensitive data
 * Only feature toggles and non-sensitive configuration
 */
export const FeaturesConfigSchema = z.object({
  features: z.object({
    /** Enable/disable Discord alert notifications */
    discordAlerts: z.boolean().default(true),

    /** Enable/disable indicator value caching in Redis */
    indicatorCache: z.boolean().default(true),

    /** Enable/disable orderbook wall detection and visualization */
    orderbookWalls: z.boolean().default(true),

    /** Enable/disable real-time WebSocket updates to frontend */
    realTimeUpdates: z.boolean().default(true),

    /** Enable/disable historical data backfill on startup */
    historicalDataBackfill: z.boolean().default(true),

    /** Enable/disable experimental features (for testing) */
    experimental: z.boolean().default(false),
  }),

  /** List of symbols to monitor */
  symbols: z.array(z.string().min(1)).default(['BTC-USD', 'ETH-USD', 'SOL-USD']),

  /** Default timeframe for charts */
  defaultTimeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),

  /** Default UI theme */
  defaultTheme: z.enum(['dark', 'light']).default('dark'),

  /** Orderbook wall detection threshold (minimum size as % of total volume) */
  orderbookWallThresholdPercent: z.number().positive().max(100).default(5),

  /** Maximum number of concurrent indicator calculations */
  maxConcurrentCalculations: z.number().int().positive().default(5),

  /** Enable debug logging */
  debugLogging: z.boolean().default(false),
});

/**
 * Validated features configuration type
 */
export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>;

/**
 * Default features configuration
 * Used as fallback if environment.json doesn't exist
 */
export const DEFAULT_FEATURES_CONFIG: FeaturesConfig = {
  features: {
    discordAlerts: true,
    indicatorCache: true,
    orderbookWalls: true,
    realTimeUpdates: true,
    historicalDataBackfill: true,
    experimental: false,
  },
  symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
  defaultTimeframe: '1h',
  defaultTheme: 'dark',
  orderbookWallThresholdPercent: 5,
  maxConcurrentCalculations: 5,
  debugLogging: false,
};
