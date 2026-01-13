/**
 * Candle utilities for handling sparse data from exchanges
 *
 * Exchanges like Coinbase omit candles when no trades occur.
 * These utilities help fill gaps to create continuous data for
 * indicators that expect uninterrupted time series.
 */

import type { Candle, Timeframe } from '@livermore/schemas';
import { timeframeToMs } from '../time/timeframe';

/**
 * Result of filling candle gaps, includes statistics about the fill
 */
export interface FillGapsResult {
  /** Candles with gaps filled */
  candles: Candle[];
  /** Statistics about the gap filling */
  stats: {
    /** Number of original candles from exchange */
    originalCount: number;
    /** Total candles after filling gaps */
    filledCount: number;
    /** Number of synthetic candles added */
    syntheticCount: number;
    /** Ratio of synthetic to total (0-1, higher = more gaps) */
    gapRatio: number;
  };
}

/**
 * Fill gaps in candle data with synthetic candles
 *
 * When exchanges omit candles for periods with no trades, this function
 * fills those gaps with synthetic candles using the previous close price.
 * This matches how TradingView and other platforms handle sparse data.
 *
 * Synthetic candles have:
 * - open = high = low = close = previous candle's close
 * - volume = 0
 *
 * @param candles - Array of candles sorted by timestamp ascending
 * @param timeframe - Timeframe for gap detection
 * @returns Candles with gaps filled and statistics
 *
 * @example
 * ```ts
 * const sparse = [
 *   { timestamp: 1000, close: 100, ... },
 *   { timestamp: 3000, close: 101, ... }, // Gap at 2000!
 * ];
 * const { candles, stats } = fillCandleGaps(sparse, '1m');
 * // candles now includes synthetic candle at timestamp 2000
 * // stats.syntheticCount === 1
 * ```
 */
export function fillCandleGaps(candles: Candle[], timeframe: Timeframe): FillGapsResult {
  if (candles.length === 0) {
    return {
      candles: [],
      stats: {
        originalCount: 0,
        filledCount: 0,
        syntheticCount: 0,
        gapRatio: 0,
      },
    };
  }

  const filled: Candle[] = [];
  const intervalMs = timeframeToMs(timeframe);
  let syntheticCount = 0;

  for (let i = 0; i < candles.length; i++) {
    // Always include the original candle
    filled.push(candles[i]);

    // Check for gap to next candle
    if (i < candles.length - 1) {
      const currentTs = candles[i].timestamp;
      const nextTs = candles[i + 1].timestamp;
      const expectedGaps = Math.floor((nextTs - currentTs) / intervalMs) - 1;

      // Fill gaps with synthetic candles
      if (expectedGaps > 0) {
        const prevClose = candles[i].close;

        for (let g = 1; g <= expectedGaps; g++) {
          filled.push({
            timestamp: currentTs + g * intervalMs,
            open: prevClose,
            high: prevClose,
            low: prevClose,
            close: prevClose,
            volume: 0,
            symbol: candles[i].symbol,
            timeframe: candles[i].timeframe,
          });
          syntheticCount++;
        }
      }
    }
  }

  const filledCount = filled.length;

  return {
    candles: filled,
    stats: {
      originalCount: candles.length,
      filledCount,
      syntheticCount,
      gapRatio: filledCount > 0 ? syntheticCount / filledCount : 0,
    },
  };
}

/**
 * Calculate the zero-range ratio for candles
 *
 * Zero-range candles (O=H=L=C) indicate no price movement,
 * common in low-liquidity symbols.
 *
 * @param candles - Array of candles
 * @returns Ratio of zero-range candles (0-1)
 */
export function calculateZeroRangeRatio(candles: Candle[]): number {
  if (candles.length === 0) return 0;

  let zeroRangeCount = 0;
  for (const candle of candles) {
    if (candle.high === candle.low) {
      zeroRangeCount++;
    }
  }

  return zeroRangeCount / candles.length;
}
