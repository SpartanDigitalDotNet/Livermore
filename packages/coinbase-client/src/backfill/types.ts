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
 * Default backfill configuration
 *
 * - candleCount: 100 (request 100 to ensure 60+ available after filtering)
 * - batchSize: 5 (conservative - 5 req/sec well under Coinbase's 30 limit)
 * - batchDelayMs: 1000 (1 second between batches)
 * - userId: 1 (hardcoded test user)
 * - exchangeId: 1 (hardcoded exchange)
 */
export const DEFAULT_BACKFILL_CONFIG: BackfillConfig = {
  candleCount: 100,
  batchSize: 5,
  batchDelayMs: 1000,
  userId: 1,
  exchangeId: 1,
};

/**
 * Timeframe priority order for backfill operations
 *
 * 5m first since WebSocket provides it, fills fastest for indicator startup.
 * NOTE: 1m is NOT included - research specifies 5m as the base WebSocket timeframe.
 */
export const TIMEFRAME_PRIORITY: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
