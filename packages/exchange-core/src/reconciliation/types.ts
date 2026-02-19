import type { Timeframe } from '@livermore/schemas';

/**
 * Configuration for boundary-triggered REST fetching
 *
 * When a 5m candle closes that aligns with a higher timeframe boundary
 * (15m, 1h, 4h, 1d), the service fetches fresh candles via REST API
 * for all symbols at that timeframe.
 */
export interface BoundaryRestConfig {
  /** Exchange ID for cache keys and pub/sub channels */
  exchangeId: number;
  /** Requests per batch (default: 5) */
  batchSize: number;
  /** Delay between batches in ms (default: 1000) */
  batchDelayMs: number;
  /** Higher timeframes to fetch at boundaries (default: ['15m', '1h', '4h', '1d']) */
  higherTimeframes: Timeframe[];
}

/**
 * Default boundary REST configuration
 *
 * Matches StartupBackfillService rate limiting:
 * - batchSize: 5 (conservative - 5 req/sec well under Coinbase's 30 limit)
 * - batchDelayMs: 1000 (1 second between batches)
 *
 * Higher timeframes fetched at boundaries (5m excluded - provided by WebSocket):
 * - 15m: every 15 minutes (00, 15, 30, 45)
 * - 1h: every hour (00 minutes)
 * - 4h: every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
 * - 1d: daily (00:00 UTC)
 */
export const DEFAULT_BOUNDARY_CONFIG: BoundaryRestConfig = {
  exchangeId: 1,
  batchSize: 5,
  batchDelayMs: 1000,
  higherTimeframes: ['15m', '1h', '4h', '1d'],
};

/**
 * Result of boundary detection for a specific timeframe
 */
export interface TimeframeBoundary {
  /** The timeframe being checked */
  timeframe: Timeframe;
  /** Whether this timeframe boundary was triggered */
  triggered: boolean;
}

/**
 * Information about a detected gap in candle sequence
 */
export interface GapInfo {
  /** Symbol with the gap */
  symbol: string;
  /** Timeframe with the gap */
  timeframe: Timeframe;
  /** First missing candle timestamp */
  start: number;
  /** Last missing candle timestamp */
  end: number;
  /** Number of missing candles */
  count: number;
}
