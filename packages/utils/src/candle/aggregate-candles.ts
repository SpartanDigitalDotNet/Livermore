/**
 * Candle aggregation utility for building higher timeframes
 *
 * Enables indicator service to calculate 15m/1h/4h/1d indicators
 * from cached 5m WebSocket data without REST API calls for each timeframe.
 */

import type { Candle, Timeframe } from '@livermore/schemas';
import { timeframeToMs, getCandleTimestamp } from '../time/timeframe';

/**
 * Aggregate candles from a smaller timeframe to a larger timeframe
 *
 * Groups source candles by target timeframe boundary and combines them
 * using standard OHLC aggregation rules:
 * - open: first candle's open
 * - high: maximum of all highs
 * - low: minimum of all lows
 * - close: last candle's close
 * - volume: sum of all volumes
 *
 * Only COMPLETE periods are included in output. Incomplete periods
 * (those without the full number of source candles) are excluded.
 *
 * @param candles - Array of source candles (should be sorted by timestamp)
 * @param sourceTimeframe - Timeframe of the source candles (e.g., '5m')
 * @param targetTimeframe - Desired output timeframe (e.g., '1h')
 * @returns Array of aggregated candles sorted by timestamp ascending
 * @throws Error if target timeframe is not larger than source timeframe
 *
 * @example
 * ```ts
 * // Aggregate 5m candles to 1h candles
 * const fiveMinCandles = await cache.get('BTC-USD', '5m');
 * const hourlyCandles = aggregateCandles(fiveMinCandles, '5m', '1h');
 * // Each 1h candle requires 12 complete 5m candles (60/5 = 12)
 * ```
 *
 * @example
 * ```ts
 * // Aggregation factors for 5m source:
 * // - 15m: 3 candles  (15 / 5)
 * // - 1h:  12 candles (60 / 5)
 * // - 4h:  48 candles (240 / 5)
 * // - 1d:  288 candles (1440 / 5)
 * ```
 */
export function aggregateCandles(
  candles: Candle[],
  sourceTimeframe: Timeframe,
  targetTimeframe: Timeframe
): Candle[] {
  // Handle empty input
  if (candles.length === 0) {
    return [];
  }

  const sourceMs = timeframeToMs(sourceTimeframe);
  const targetMs = timeframeToMs(targetTimeframe);

  // Validate that target is larger than source
  if (targetMs <= sourceMs) {
    throw new Error(
      `Target timeframe (${targetTimeframe}) must be larger than source timeframe (${sourceTimeframe})`
    );
  }

  // Calculate how many source candles make one target candle
  const factor = targetMs / sourceMs;

  // Validate that factor is a whole number (timeframes are evenly divisible)
  if (!Number.isInteger(factor)) {
    throw new Error(
      `Target timeframe (${targetTimeframe}) is not evenly divisible by source timeframe (${sourceTimeframe})`
    );
  }

  // Group candles by target timeframe boundary
  const groups = new Map<number, Candle[]>();

  for (const candle of candles) {
    const boundary = getCandleTimestamp(candle.timestamp, targetTimeframe);
    const group = groups.get(boundary);
    if (group) {
      group.push(candle);
    } else {
      groups.set(boundary, [candle]);
    }
  }

  // Aggregate only complete groups
  const aggregated: Candle[] = [];
  const symbol = candles[0].symbol;

  for (const [boundary, group] of groups) {
    // Only include complete periods (groups with exactly `factor` candles)
    if (group.length !== factor) {
      continue;
    }

    // Sort group by timestamp to ensure correct first/last order
    group.sort((a, b) => a.timestamp - b.timestamp);

    // Aggregate OHLCV
    const open = group[0].open;
    const close = group[group.length - 1].close;
    let high = group[0].high;
    let low = group[0].low;
    let volume = 0;
    let isSynthetic = false;

    for (const candle of group) {
      if (candle.high > high) high = candle.high;
      if (candle.low < low) low = candle.low;
      volume += candle.volume;
      // Propagate isSynthetic: if ANY source candle is synthetic, output is too
      if (candle.isSynthetic) isSynthetic = true;
    }

    aggregated.push({
      timestamp: boundary,
      open,
      high,
      low,
      close,
      volume,
      symbol,
      timeframe: targetTimeframe,
      isSynthetic,
    });
  }

  // Sort by timestamp ascending
  aggregated.sort((a, b) => a.timestamp - b.timestamp);

  return aggregated;
}
