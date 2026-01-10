/**
 * Standard MACD (Moving Average Convergence Divergence)
 *
 * Classic MACD without ATR normalization.
 * - MACD Line = Fast EMA - Slow EMA
 * - Signal Line = EMA of MACD Line
 * - Histogram = MACD Line - Signal Line
 *
 * Default parameters: 12, 26, 9
 */

import { ema } from '../core/ema.js';

export const MACD_DEFAULTS = {
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
} as const;

export interface MACDConfig {
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
}

export interface MACDValue {
  macd: number;
  signal: number;
  histogram: number;
  fastEMA: number;
  slowEMA: number;
}

export interface MACDSeries {
  macd: number[];
  signal: number[];
  histogram: number[];
  fastEMA: number[];
  slowEMA: number[];
}

/**
 * Calculate MACD for an array of close prices
 * @param closes - Array of close prices (oldest first)
 * @param config - MACD configuration
 * @returns MACD series data
 */
export function macd(closes: number[], config: MACDConfig = {}): MACDSeries {
  const {
    fastPeriod = MACD_DEFAULTS.fastPeriod,
    slowPeriod = MACD_DEFAULTS.slowPeriod,
    signalPeriod = MACD_DEFAULTS.signalPeriod,
  } = config;

  if (closes.length === 0) {
    return {
      macd: [],
      signal: [],
      histogram: [],
      fastEMA: [],
      slowEMA: [],
    };
  }

  // Calculate EMAs
  const fastEMAValues = ema(closes, fastPeriod);
  const slowEMAValues = ema(closes, slowPeriod);

  // Calculate MACD line (fast - slow)
  const macdValues: number[] = new Array(closes.length).fill(NaN);

  for (let i = 0; i < closes.length; i++) {
    const fast = fastEMAValues[i];
    const slow = slowEMAValues[i];

    if (!Number.isNaN(fast) && !Number.isNaN(slow)) {
      macdValues[i] = fast - slow;
    }
  }

  // Calculate Signal line (EMA of MACD)
  const signalValues: number[] = new Array(closes.length).fill(NaN);

  // Find first valid MACD index
  let firstValidIndex = -1;
  for (let i = 0; i < macdValues.length; i++) {
    if (!Number.isNaN(macdValues[i])) {
      firstValidIndex = i;
      break;
    }
  }

  if (firstValidIndex >= 0) {
    const validMacd = macdValues.slice(firstValidIndex);
    const signalEMA = ema(
      validMacd.map((v) => (Number.isNaN(v) ? 0 : v)),
      signalPeriod
    );

    for (let i = 0; i < signalEMA.length; i++) {
      signalValues[firstValidIndex + i] = signalEMA[i];
    }
  }

  // Calculate Histogram
  const histogramValues: number[] = new Array(closes.length).fill(NaN);

  for (let i = 0; i < closes.length; i++) {
    const m = macdValues[i];
    const s = signalValues[i];

    if (!Number.isNaN(m) && !Number.isNaN(s)) {
      histogramValues[i] = m - s;
    }
  }

  return {
    macd: macdValues,
    signal: signalValues,
    histogram: histogramValues,
    fastEMA: fastEMAValues,
    slowEMA: slowEMAValues,
  };
}

/**
 * Get the latest MACD values
 * @param closes - Array of close prices
 * @param config - MACD configuration
 * @returns Latest MACD values or null if insufficient data
 */
export function macdLatest(
  closes: number[],
  config: MACDConfig = {}
): MACDValue | null {
  const series = macd(closes, config);

  if (series.macd.length === 0) {
    return null;
  }

  const lastIndex = series.macd.length - 1;
  const macdVal = series.macd[lastIndex];

  if (Number.isNaN(macdVal)) {
    return null;
  }

  return {
    macd: macdVal,
    signal: Number.isNaN(series.signal[lastIndex]) ? 0 : series.signal[lastIndex],
    histogram: Number.isNaN(series.histogram[lastIndex]) ? 0 : series.histogram[lastIndex],
    fastEMA: series.fastEMA[lastIndex],
    slowEMA: series.slowEMA[lastIndex],
  };
}
