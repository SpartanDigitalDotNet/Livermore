import type { Timeframe } from '@livermore/schemas';

// ============================================
// CACHE TRUST ASSESSMENT
// ============================================

/** Result of the cache trust check — determines warmup mode */
export interface CacheTrustResult {
  mode: 'full_refresh' | 'targeted';
  reason: string;
}

/** Dump trigger: why the cache was deemed untrustworthy */
export type DumpReason =
  | 'status_key_missing'
  | 'heartbeat_stale'
  | 'sentinel_stale';

// ============================================
// STALENESS THRESHOLDS
// ============================================

/**
 * Per-timeframe staleness thresholds (ms).
 * If the newest candle for a symbol/timeframe is older than this,
 * the data is considered stale and needs re-fetching.
 *
 * These are tight because in the targeted path, downtime was < 20 min.
 */
export const STALENESS_THRESHOLDS: Record<string, number> = {
  '1d':  25 * 60 * 60 * 1000,   // 25 hours
  '4h':  5  * 60 * 60 * 1000,   // 5 hours
  '1h':  2  * 60 * 60 * 1000,   // 2 hours
  '15m': 45 * 60 * 1000,        // 45 minutes
  '5m':  60 * 60 * 1000,        // 1 hour
  '1m':  60 * 60 * 1000,        // 1 hour (same as 5m — not gap-verified)
};

/** Sentinel 5m freshness threshold for dump decision */
export const SENTINEL_5M_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

/** Heartbeat staleness threshold for dump decision */
export const HEARTBEAT_STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

// ============================================
// CANDLE REQUIREMENTS
// ============================================

/**
 * Minimum candle count for indicator calculations.
 * MACD-V ATR requires 2 × 26 = 52 candles.
 * Future indicators may need more — bump this constant when they do.
 */
export const MIN_INDICATOR_CANDLES = 52;

/** Default candle target count for REST fetches */
export const DEFAULT_CANDLE_TARGET = 100;

// ============================================
// SCAN CONFIGURATION
// ============================================

/** Timeframes to warm up (all timeframes, largest to smallest) */
export const WARMUP_TIMEFRAMES: Timeframe[] = ['1d', '4h', '1h', '15m', '5m', '1m'];


// ============================================
// SCAN RESULTS & SCHEDULE
// ============================================

/** Result of scanning one symbol/timeframe pair */
export interface CandleStatusResult {
  symbol: string;
  timeframe: Timeframe;
  cachedCount: number;
  newestCandleAge: number | null; // ms since newest candle, null if empty
  sufficient: boolean;            // true if count >= MIN_INDICATOR_CANDLES AND data is recent
  reason?: 'ok' | 'low_count' | 'stale' | 'empty';
}

/** A single entry in the warmup schedule */
export interface WarmupScheduleEntry {
  symbol: string;
  timeframe: Timeframe;
  cachedCount: number;
  targetCount: number;
  reason: 'low_count' | 'stale' | 'empty' | 'full_refresh';
}

/** The complete warmup schedule for an exchange */
export interface WarmupSchedule {
  exchangeId: number;
  createdAt: number;
  mode: 'full_refresh' | 'targeted';
  totalPairs: number;
  sufficientPairs: number;
  needsFetching: number;
  entries: WarmupScheduleEntry[];
}

/** Real-time warmup progress stats, persisted to Redis */
export interface WarmupStats {
  exchangeId: number;
  status: 'assessing' | 'dumping' | 'scanning' | 'fetching' | 'complete' | 'error';
  mode: 'full_refresh' | 'targeted' | null;
  startedAt: number;
  updatedAt: number;
  totalSymbols: number;
  totalPairs: number;
  completedPairs: number;
  skippedPairs: number;
  failedPairs: number;
  percentComplete: number;
  etaMs: number | null;
  currentSymbol: string | null;
  currentTimeframe: string | null;
  failures: Array<{ symbol: string; timeframe: string; error: string }>;
}
