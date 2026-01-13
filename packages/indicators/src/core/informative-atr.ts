/**
 * Informative ATR - ATR that skips synthetic (missing) candles
 *
 * Standard ATR treats all candles equally, but when exchanges omit candles
 * for periods with no trades, forward-filling creates synthetic candles with
 * TR=0. This causes ATR to collapse toward zero, breaking indicators like MACD-V.
 *
 * This implementation treats synthetic candles as MISSING data, not zero-volatility
 * observations. ATR is only updated on observed (real) TR samples.
 *
 * Key behaviors:
 * - Synthetic candles (isSynthetic=true) contribute TR=missing, not TR=0
 * - ATR carries forward unchanged during synthetic periods
 * - ATR seeds from first `period` observed TRs (not first `period` bars)
 * - Returns metadata about seeding status and effective sample count
 */

import { trueRange, type OHLC } from './true-range.js';

/**
 * Extended OHLC type that includes synthetic flag
 */
export interface OHLCWithSynthetic extends OHLC {
  /** True if this candle was forward-filled due to missing trades */
  isSynthetic?: boolean;
}

/**
 * Configuration for informative ATR
 */
export interface InformativeATRConfig {
  /** ATR period (default: 26 per Spiroglou) */
  period?: number;
}

/**
 * Result of informative ATR calculation with validity metadata
 */
export interface InformativeATRResult {
  /** ATR values (NaN until seeded with `period` observed TRs) */
  atr: number[];
  /** True Range values (NaN for synthetic candles) */
  tr: number[];
  /** True when ATR has been seeded with `period` observed TR samples */
  seeded: boolean;
  /** Number of observed (non-synthetic) TR samples used */
  nEff: number;
  /** Index where ATR was first seeded (-1 if not seeded) */
  seedIndex: number;
  /** Span in bars from first to last observed TR (for staleness detection) */
  spanBars: number;
}

/**
 * Calculate ATR using only observed (non-synthetic) TR samples
 *
 * @param bars - Array of OHLC bars with optional isSynthetic flag
 * @param config - ATR configuration
 * @returns ATR values with validity metadata
 *
 * @example
 * ```ts
 * const bars = [
 *   { open: 100, high: 102, low: 99, close: 101, isSynthetic: false },
 *   { open: 101, high: 101, low: 101, close: 101, isSynthetic: true }, // Gap-filled
 *   { open: 101, high: 103, low: 100, close: 102, isSynthetic: false },
 * ];
 * const result = informativeATR(bars, { period: 26 });
 * // result.atr[1] carries forward from result.atr[0] (synthetic skipped)
 * // result.seeded is false until 26 real TRs observed
 * ```
 */
export function informativeATR(
  bars: OHLCWithSynthetic[],
  config: InformativeATRConfig = {}
): InformativeATRResult {
  const period = config.period ?? 26;

  if (period <= 0) {
    throw new Error('ATR period must be positive');
  }

  if (bars.length === 0) {
    return {
      atr: [],
      tr: [],
      seeded: false,
      nEff: 0,
      seedIndex: -1,
      spanBars: 0,
    };
  }

  const atrValues: number[] = new Array(bars.length).fill(NaN);
  const trValues: number[] = new Array(bars.length).fill(NaN);
  const seedBuffer: number[] = [];

  let atr: number | null = null;
  let nEff = 0;
  let seedIndex = -1;
  let firstObservedIndex = -1;
  let lastObservedIndex = -1;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // Synthetic candles: TR is MISSING (not zero), carry forward ATR
    if (bar.isSynthetic === true) {
      // TR remains NaN for synthetic bars
      // Carry forward ATR if already seeded
      if (atr !== null) {
        atrValues[i] = atr;
      }
      continue;
    }

    // Observed (real) candle: compute True Range
    const prevClose = i > 0 ? bars[i - 1].close : bar.close;
    const tr = trueRange(bar.high, bar.low, prevClose);
    trValues[i] = tr;

    // Track observation indices for span calculation
    if (firstObservedIndex === -1) {
      firstObservedIndex = i;
    }
    lastObservedIndex = i;
    nEff++;

    // Seed phase: collect first `period` observed TRs
    if (atr === null) {
      seedBuffer.push(tr);

      if (seedBuffer.length === period) {
        // Seed ATR with SMA of collected TRs (Wilder's initialization)
        atr = seedBuffer.reduce((a, b) => a + b, 0) / period;
        seedIndex = i;
        atrValues[i] = atr;
      }
      continue;
    }

    // Update phase: Wilder's smoothing (RMA)
    // ATR = (previousATR * (period - 1) + TR) / period
    atr = (atr * (period - 1) + tr) / period;
    atrValues[i] = atr;
  }

  // Calculate span from first to last observed TR
  const spanBars =
    firstObservedIndex >= 0 && lastObservedIndex >= 0
      ? lastObservedIndex - firstObservedIndex + 1
      : 0;

  return {
    atr: atrValues,
    tr: trValues,
    seeded: atr !== null,
    nEff,
    seedIndex,
    spanBars,
  };
}

/**
 * Get the latest informative ATR value
 *
 * @param bars - Array of OHLC bars with optional isSynthetic flag
 * @param config - ATR configuration
 * @returns Latest ATR value and metadata, or null if not seeded
 */
export function informativeATRLatest(
  bars: OHLCWithSynthetic[],
  config: InformativeATRConfig = {}
): { atr: number; nEff: number; spanBars: number } | null {
  const result = informativeATR(bars, config);

  if (!result.seeded || result.atr.length === 0) {
    return null;
  }

  // Find last valid ATR value
  for (let i = result.atr.length - 1; i >= 0; i--) {
    if (!Number.isNaN(result.atr[i])) {
      return {
        atr: result.atr[i],
        nEff: result.nEff,
        spanBars: result.spanBars,
      };
    }
  }

  return null;
}
