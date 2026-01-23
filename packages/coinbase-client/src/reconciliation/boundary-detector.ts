import type { Timeframe } from '@livermore/schemas';
import { timeframeToMs } from '@livermore/utils';
import type { TimeframeBoundary } from './types';

/**
 * Check if a timestamp aligns with a timeframe boundary
 *
 * A boundary occurs when the timestamp is evenly divisible by the timeframe duration.
 * All timestamps are assumed to be in UTC.
 *
 * Examples (boundary alignment):
 * - 15m boundary at 00, 15, 30, 45 minutes past the hour
 * - 1h boundary at 00 minutes past the hour
 * - 4h boundary at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
 * - 1d boundary at 00:00 UTC
 *
 * @param timestamp - Unix timestamp in milliseconds (UTC)
 * @param timeframe - Timeframe to check boundary for
 * @returns true if timestamp aligns with timeframe boundary
 */
export function isTimeframeBoundary(timestamp: number, timeframe: Timeframe): boolean {
  const intervalMs = timeframeToMs(timeframe);
  return timestamp % intervalMs === 0;
}

/**
 * Detect which timeframe boundaries a timestamp aligns with
 *
 * When a 5m candle closes, this function determines which higher timeframe
 * boundaries (if any) that timestamp also represents. This triggers REST
 * fetches for those higher timeframes.
 *
 * Example: timestamp 1737619200000 (2025-01-23 12:00:00 UTC)
 * - 15m: true (12:00 is 0 mod 15 minutes)
 * - 1h: true (12:00 is 0 mod 60 minutes)
 * - 4h: true (12 hours is divisible by 4)
 * - 1d: false (12:00 is not 00:00)
 *
 * @param timestamp - Unix timestamp in milliseconds (UTC)
 * @param timeframes - Array of timeframes to check
 * @returns Array of TimeframeBoundary with triggered flags
 */
export function detectBoundaries(
  timestamp: number,
  timeframes: Timeframe[]
): TimeframeBoundary[] {
  return timeframes.map((timeframe) => ({
    timeframe,
    triggered: isTimeframeBoundary(timestamp, timeframe),
  }));
}
