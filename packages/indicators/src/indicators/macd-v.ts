/**
 * MACD-V (Alex Spiroglou)
 *
 * MACD normalized by ATR, scaled by 100.
 *
 * Per Spiroglou spec:
 * - fastEMA = EMA(close, 12)
 * - slowEMA = EMA(close, 26)
 * - macdSpread = fastEMA - slowEMA
 * - MACD_V = (macdSpread / ATR(26)) * 100
 * - Signal = EMA(MACD_V, 9)
 * - Histogram = MACD_V - Signal
 *
 * Edge case: If ATR == 0, MACD-V is undefined (returns null/NaN)
 */

import { ema } from '../core/ema.js';
import { atr as calculateATR } from '../core/atr.js';
import type { OHLC } from '../core/true-range.js';

/** Default MACD-V parameters per Spiroglou */
export const MACD_V_DEFAULTS = {
  fastPeriod: 12,
  slowPeriod: 26,
  atrPeriod: 26,
  signalPeriod: 9,
  scale: 100,
} as const;

export interface MACDVConfig {
  fastPeriod?: number;
  slowPeriod?: number;
  atrPeriod?: number;
  signalPeriod?: number;
  scale?: number;
}

export interface MACDVValue {
  macdV: number;
  signal: number;
  histogram: number;
  fastEMA: number;
  slowEMA: number;
  atr: number;
}

export interface MACDVSeries {
  macdV: number[];
  signal: number[];
  histogram: number[];
  fastEMA: number[];
  slowEMA: number[];
  atr: number[];
}

/** Range rule stages per StockCharts definitions */
export type MACDVStage =
  | 'oversold'      // MACD_V < -150
  | 'rebounding'    // -150 < MACD_V < +50 and MACD_V > Signal
  | 'rallying'      // +50 < MACD_V < +150 and MACD_V > Signal
  | 'overbought'    // MACD_V > +150 and MACD_V > Signal
  | 'retracing'     // MACD_V > -50 and MACD_V < Signal
  | 'reversing'     // -150 < MACD_V < -50 and MACD_V < Signal
  | 'ranging'       // -50 < MACD_V < +50 (neutral zone)
  | 'unknown';

/**
 * Calculate MACD-V for an array of OHLC bars
 * @param bars - Array of OHLC bars (oldest first)
 * @param config - MACD-V configuration (uses Spiroglou defaults if not provided)
 * @returns MACD-V series data
 */
export function macdV(bars: OHLC[], config: MACDVConfig = {}): MACDVSeries {
  const {
    fastPeriod = MACD_V_DEFAULTS.fastPeriod,
    slowPeriod = MACD_V_DEFAULTS.slowPeriod,
    atrPeriod = MACD_V_DEFAULTS.atrPeriod,
    signalPeriod = MACD_V_DEFAULTS.signalPeriod,
    scale = MACD_V_DEFAULTS.scale,
  } = config;

  if (bars.length === 0) {
    return {
      macdV: [],
      signal: [],
      histogram: [],
      fastEMA: [],
      slowEMA: [],
      atr: [],
    };
  }

  // Extract close prices
  const closes = bars.map((bar) => bar.close);

  // Calculate EMAs of close
  const fastEMAValues = ema(closes, fastPeriod);
  const slowEMAValues = ema(closes, slowPeriod);

  // Calculate ATR
  const { atr: atrValues } = calculateATR(bars, atrPeriod);

  // Calculate MACD spread and normalize by ATR
  const macdVValues: number[] = new Array(bars.length).fill(NaN);

  for (let i = 0; i < bars.length; i++) {
    const fast = fastEMAValues[i];
    const slow = slowEMAValues[i];
    const atrVal = atrValues[i];

    if (Number.isNaN(fast) || Number.isNaN(slow) || Number.isNaN(atrVal)) {
      continue;
    }

    // Edge case: ATR == 0 means MACD-V is undefined
    if (atrVal === 0) {
      macdVValues[i] = NaN;
      continue;
    }

    const spread = fast - slow;
    macdVValues[i] = (spread / atrVal) * scale;
  }

  // Calculate Signal line (EMA of MACD-V)
  // Only calculate on valid (non-NaN) MACD-V values
  const signalValues: number[] = new Array(bars.length).fill(NaN);

  // Find first valid MACD-V index
  let firstValidIndex = -1;
  for (let i = 0; i < macdVValues.length; i++) {
    if (!Number.isNaN(macdVValues[i])) {
      firstValidIndex = i;
      break;
    }
  }

  if (firstValidIndex >= 0) {
    // Extract valid MACD-V values for signal calculation
    const validMacdV = macdVValues.slice(firstValidIndex);
    const signalEMA = ema(
      validMacdV.map((v) => (Number.isNaN(v) ? 0 : v)),
      signalPeriod
    );

    // Map back to original indices
    for (let i = 0; i < signalEMA.length; i++) {
      signalValues[firstValidIndex + i] = signalEMA[i];
    }
  }

  // Calculate Histogram (MACD-V - Signal)
  const histogramValues: number[] = new Array(bars.length).fill(NaN);

  for (let i = 0; i < bars.length; i++) {
    const mv = macdVValues[i];
    const sig = signalValues[i];

    if (!Number.isNaN(mv) && !Number.isNaN(sig)) {
      histogramValues[i] = mv - sig;
    }
  }

  return {
    macdV: macdVValues,
    signal: signalValues,
    histogram: histogramValues,
    fastEMA: fastEMAValues,
    slowEMA: slowEMAValues,
    atr: atrValues,
  };
}

/**
 * Get the latest MACD-V values from an array of OHLC bars
 * @param bars - Array of OHLC bars (oldest first)
 * @param config - MACD-V configuration
 * @returns Latest MACD-V values or null if insufficient data
 */
export function macdVLatest(
  bars: OHLC[],
  config: MACDVConfig = {}
): MACDVValue | null {
  const series = macdV(bars, config);

  if (series.macdV.length === 0) {
    return null;
  }

  const lastIndex = series.macdV.length - 1;
  const macdVVal = series.macdV[lastIndex];
  const signalVal = series.signal[lastIndex];
  const histogramVal = series.histogram[lastIndex];

  if (Number.isNaN(macdVVal)) {
    return null;
  }

  return {
    macdV: macdVVal,
    signal: Number.isNaN(signalVal) ? 0 : signalVal,
    histogram: Number.isNaN(histogramVal) ? 0 : histogramVal,
    fastEMA: series.fastEMA[lastIndex],
    slowEMA: series.slowEMA[lastIndex],
    atr: series.atr[lastIndex],
  };
}

/**
 * Classify MACD-V into range rule stages per StockCharts definitions
 * @param macdVValue - Current MACD-V value
 * @param signalValue - Current Signal value
 * @returns Stage classification
 */
export function classifyMACDVStage(
  macdVValue: number,
  signalValue: number
): MACDVStage {
  if (Number.isNaN(macdVValue) || Number.isNaN(signalValue)) {
    return 'unknown';
  }

  const aboveSignal = macdVValue > signalValue;
  const belowSignal = macdVValue < signalValue;

  // Oversold: MACD_V < -150
  if (macdVValue < -150) {
    return 'oversold';
  }

  // Overbought: MACD_V > +150 and above signal
  if (macdVValue > 150 && aboveSignal) {
    return 'overbought';
  }

  // Rallying: +50 < MACD_V < +150 and above signal
  if (macdVValue > 50 && macdVValue < 150 && aboveSignal) {
    return 'rallying';
  }

  // Rebounding: -150 < MACD_V < +50 and above signal
  if (macdVValue > -150 && macdVValue < 50 && aboveSignal) {
    return 'rebounding';
  }

  // Reversing: -150 < MACD_V < -50 and below signal
  if (macdVValue > -150 && macdVValue < -50 && belowSignal) {
    return 'reversing';
  }

  // Retracing: MACD_V > -50 and below signal
  if (macdVValue > -50 && belowSignal) {
    return 'retracing';
  }

  // Ranging (neutral zone): -50 < MACD_V < +50
  // Note: Full "ranging" requires 20-30+ bars in this zone, but we return it as potential
  if (macdVValue > -50 && macdVValue < 50) {
    return 'ranging';
  }

  return 'unknown';
}

/**
 * Get MACD-V with stage classification
 * @param bars - Array of OHLC bars
 * @param config - MACD-V configuration
 * @returns MACD-V value with stage, or null if insufficient data
 */
export function macdVWithStage(
  bars: OHLC[],
  config: MACDVConfig = {}
): (MACDVValue & { stage: MACDVStage }) | null {
  const latest = macdVLatest(bars, config);

  if (!latest) {
    return null;
  }

  const stage = classifyMACDVStage(latest.macdV, latest.signal);

  return {
    ...latest,
    stage,
  };
}

/**
 * Calculate minimum bars needed for valid MACD-V output
 * @param config - MACD-V configuration
 * @returns Minimum number of bars required
 */
export function macdVMinBars(config: MACDVConfig = {}): number {
  const {
    slowPeriod = MACD_V_DEFAULTS.slowPeriod,
    atrPeriod = MACD_V_DEFAULTS.atrPeriod,
    signalPeriod = MACD_V_DEFAULTS.signalPeriod,
  } = config;

  // Need slow EMA + ATR to be valid, plus signal period
  // slowPeriod for slow EMA, atrPeriod for ATR, signalPeriod for signal line
  return Math.max(slowPeriod, atrPeriod) + signalPeriod;
}
