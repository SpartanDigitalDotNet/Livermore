import type { Timeframe } from '@livermore/schemas';

/**
 * Configuration for startup backfill operations
 */
export interface BackfillConfig {
  /** Number of candles to fetch per symbol/timeframe (default: 100) */
  candleCount: number;
  /** Requests per batch (default: 5) */
  batchSize: number;
  /** Delay between batches in ms (default: 1000) */
  batchDelayMs: number;
  /** User ID for cache keys */
  userId: number;
  /** Exchange ID for cache keys */
  exchangeId: number;
}

/**
 * Default backfill configuration (rate-limiting only)
 *
 * userId and exchangeId are intentionally omitted — callers MUST provide them.
 */
export const DEFAULT_BACKFILL_DEFAULTS = {
  candleCount: 100,
  batchSize: 5,
  batchDelayMs: 1000,
} as const;

/**
 * Timeframe priority order for backfill operations
 *
 * 5m first since WebSocket provides it, fills fastest for indicator startup.
 * NOTE: 1m is NOT included - research specifies 5m as the base WebSocket timeframe.
 */
export const TIMEFRAME_PRIORITY: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
