import type { Timeframe } from '@livermore/schemas';

/** Result of scanning one symbol/timeframe pair's cached candle count */
export interface CandleStatusResult {
  symbol: string;
  timeframe: Timeframe;
  cachedCount: number;
  sufficient: boolean;  // true if cachedCount >= MIN_CANDLE_THRESHOLD
}

/** A single entry in the warmup schedule -- one symbol/timeframe pair that needs fetching */
export interface WarmupScheduleEntry {
  symbol: string;
  timeframe: Timeframe;
  cachedCount: number;       // how many candles currently cached
  targetCount: number;       // how many we want (e.g. 100)
}

/** The complete warmup schedule for an exchange */
export interface WarmupSchedule {
  exchangeId: number;
  createdAt: number;         // Unix timestamp ms
  totalPairs: number;        // total symbol/timeframe pairs scanned
  sufficientPairs: number;   // pairs that already have enough data (skipped)
  needsFetching: number;     // pairs that need REST calls
  entries: WarmupScheduleEntry[];
}

/** Scan order: largest to smallest timeframe per WARM-01 requirement */
export const SCAN_TIMEFRAME_ORDER: Timeframe[] = ['1d', '4h', '1h', '15m', '5m', '1m'];

/** Minimum candle count to consider a symbol/timeframe pair "sufficient" */
export const MIN_CANDLE_THRESHOLD = 60;

/** Default candle target count for backfill */
export const DEFAULT_CANDLE_TARGET = 100;
