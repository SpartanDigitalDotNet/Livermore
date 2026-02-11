import type { Timeframe } from '@livermore/schemas';
import { timeframeToMs, getCandleTimestamp } from '@livermore/utils';
import { candleKey, type RedisClient } from '@livermore/cache';
import type { GapInfo } from './types';

/**
 * Get only timestamps (scores) from a Redis sorted set
 * More efficient than deserializing full candle data for gap detection
 *
 * @param redis - Redis client
 * @param key - Sorted set key
 * @param start - Start timestamp (inclusive)
 * @param end - End timestamp (inclusive)
 * @returns Array of timestamps
 */
export async function getTimestampsOnly(
  redis: RedisClient,
  key: string,
  start: number,
  end: number
): Promise<number[]> {
  // ZRANGEBYSCORE key min max WITHSCORES returns [member, score, member, score, ...]
  const results = await redis.zrangebyscore(key, start, end, 'WITHSCORES');

  // Extract every other element (scores are at odd indices)
  const timestamps: number[] = [];
  for (let i = 1; i < results.length; i += 2) {
    timestamps.push(parseInt(results[i], 10));
  }
  return timestamps;
}

/**
 * Detect gaps in a cached candle sequence
 *
 * Compares actual cached timestamps against expected timestamps based on
 * timeframe interval. Returns array of gap ranges.
 *
 * @param cachedTimestamps - Array of timestamps found in cache
 * @param expectedStart - Expected start of range (floored to candle boundary)
 * @param expectedEnd - Expected end of range (floored to candle boundary)
 * @param timeframe - Timeframe for interval calculation
 * @param symbol - Symbol for GapInfo result
 * @returns Array of detected gaps
 */
export function detectGaps(
  cachedTimestamps: number[],
  expectedStart: number,
  expectedEnd: number,
  timeframe: Timeframe,
  symbol: string
): GapInfo[] {
  const intervalMs = timeframeToMs(timeframe);
  const cachedSet = new Set(cachedTimestamps);
  const gaps: GapInfo[] = [];

  let gapStart: number | null = null;
  let gapCount = 0;

  // Generate expected timestamps and check each one
  for (let ts = expectedStart; ts <= expectedEnd; ts += intervalMs) {
    if (!cachedSet.has(ts)) {
      // Missing timestamp - start or continue gap
      if (gapStart === null) {
        gapStart = ts;
      }
      gapCount++;
    } else if (gapStart !== null) {
      // Found cached timestamp after a gap - record the gap
      gaps.push({
        symbol,
        timeframe,
        start: gapStart,
        end: ts - intervalMs,
        count: gapCount,
      });
      gapStart = null;
      gapCount = 0;
    }
  }

  // Handle trailing gap (gap extends to end of range)
  if (gapStart !== null) {
    gaps.push({
      symbol,
      timeframe,
      start: gapStart,
      end: expectedEnd,
      count: gapCount,
    });
  }

  return gaps;
}

/**
 * Detect gaps for a symbol/timeframe by querying cache
 *
 * Convenience function that handles Redis query and gap detection
 *
 * @param redis - Redis client
 * @param userId - User ID for cache key
 * @param exchangeId - Exchange ID for cache key
 * @param symbol - Trading symbol
 * @param timeframe - Candle timeframe
 * @param lookbackMs - How far back to scan (e.g., 30 * 60 * 1000 for 30 minutes)
 * @returns Array of detected gaps
 */
export async function detectGapsForSymbol(
  redis: RedisClient,
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  lookbackMs: number
): Promise<GapInfo[]> {
  const now = Date.now();

  // Floor to candle boundaries
  const end = getCandleTimestamp(now, timeframe);
  const start = getCandleTimestamp(now - lookbackMs, timeframe);

  // Get cached timestamps
  const key = candleKey(userId, exchangeId, symbol, timeframe);
  const cachedTimestamps = await getTimestampsOnly(redis, key, start, end);

  // Detect gaps
  return detectGaps(cachedTimestamps, start, end, timeframe, symbol);
}
