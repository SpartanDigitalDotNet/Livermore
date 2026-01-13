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
 * Low-liquidity handling:
 * For symbols with sparse trading, synthetic (gap-filled) candles are treated
 * as MISSING data for ATR calculation, not zero-volatility observations.
 * This prevents ATR from collapsing toward zero and MACD-V from exploding.
 *
 * When ATR cannot be seeded (insufficient observed TR samples), MACD-V
 * returns null with reason: 'Low trading activity'.
 */

import { ema } from '../core/ema.js';
import {
  informativeATR,
  type OHLCWithSynthetic,
} from '../core/informative-atr.js';

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
  /** True when ATR has been seeded with sufficient observed TR samples */
  seeded: boolean;
  /** Number of observed (non-synthetic) TR samples used for ATR */
  nEff: number;
  /** Span in bars from first to last observed TR */
  spanBars: number;
  /** Reason if MACD-V could not be calculated */
  reason?: 'Low trading activity';
}

/** Range rule stages per StockCharts definitions */
export type MACDVStage =
  | 'oversold' // MACD_V < -150
  | 'rebounding' // -150 < MACD_V < +50 and MACD_V > Signal
  | 'rallying' // +50 < MACD_V < +150 and MACD_V > Signal
  | 'overbought' // MACD_V > +150 and MACD_V > Signal
  | 'retracing' // MACD_V > -50 and MACD_V < Signal
  | 'reversing' // -150 < MACD_V < -50 and MACD_V < Signal
  | 'ranging' // -50 < MACD_V < +50 (neutral zone)
  | 'unknown';

/**
 * Calculate MACD-V for an array of OHLC bars
 *
 * Uses informativeATR which skips synthetic candles, treating them as
 * missing data rather than zero-volatility observations.
 *
 * @param bars - Array of OHLC bars with optional isSynthetic flag (oldest first)
 * @param config - MACD-V configuration (uses Spiroglou defaults if not provided)
 * @returns MACD-V series data with validity metadata
 */
export function macdV(
  bars: OHLCWithSynthetic[],
  config: MACDVConfig = {}
): MACDVSeries {
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
      seeded: false,
      nEff: 0,
      spanBars: 0,
      reason: 'Low trading activity',
    };
  }

  // Extract close prices
  const closes = bars.map((bar) => bar.close);

  // Calculate EMAs of close (works fine with forward-filled closes)
  const fastEMAValues = ema(closes, fastPeriod);
  const slowEMAValues = ema(closes, slowPeriod);

  // Calculate ATR using only observed (non-synthetic) TR samples
  const atrResult = informativeATR(bars, { period: atrPeriod });

  // If ATR is not seeded, we cannot calculate meaningful MACD-V
  if (!atrResult.seeded) {
    return {
      macdV: new Array(bars.length).fill(NaN),
      signal: new Array(bars.length).fill(NaN),
      histogram: new Array(bars.length).fill(NaN),
      fastEMA: fastEMAValues,
      slowEMA: slowEMAValues,
      atr: atrResult.atr,
      seeded: false,
      nEff: atrResult.nEff,
      spanBars: atrResult.spanBars,
      reason: 'Low trading activity',
    };
  }

  // Calculate MACD spread and normalize by ATR
  const macdVValues: number[] = new Array(bars.length).fill(NaN);

  for (let i = 0; i < bars.length; i++) {
    const fast = fastEMAValues[i];
    const slow = slowEMAValues[i];
    const atrVal = atrResult.atr[i];

    if (Number.isNaN(fast) || Number.isNaN(slow) || Number.isNaN(atrVal)) {
      continue;
    }

    // ATR should never be zero after informativeATR (it carries forward)
    // But guard against it just in case
    if (atrVal === 0) {
      continue;
    }

    const spread = fast - slow;
    macdVValues[i] = (spread / atrVal) * scale;
  }

  // Calculate Signal line (EMA of MACD-V)
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
    atr: atrResult.atr,
    seeded: true,
    nEff: atrResult.nEff,
    spanBars: atrResult.spanBars,
  };
}

/**
 * Get the latest MACD-V values from an array of OHLC bars
 * @param bars - Array of OHLC bars with optional isSynthetic flag (oldest first)
 * @param config - MACD-V configuration
 * @returns Latest MACD-V values or null if insufficient data
 */
export function macdVLatest(
  bars: OHLCWithSynthetic[],
  config: MACDVConfig = {}
): (MACDVValue & { seeded: boolean; nEff: number; spanBars: number; reason?: 'Low trading activity' }) | null {
  const series = macdV(bars, config);

  if (series.macdV.length === 0) {
    return null;
  }

  // If not seeded, return null with reason
  if (!series.seeded) {
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
    seeded: series.seeded,
    nEff: series.nEff,
    spanBars: series.spanBars,
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
  if (macdVValue > -50 && macdVValue < 50) {
    return 'ranging';
  }

  return 'unknown';
}

/**
 * Extended MACD-V value with stage and validity metadata
 */
export interface MACDVWithStageResult extends MACDVValue {
  stage: MACDVStage;
  seeded: boolean;
  nEff: number;
  spanBars: number;
  reason?: 'Low trading activity';
}

/**
 * Get MACD-V with stage classification
 * @param bars - Array of OHLC bars with optional isSynthetic flag
 * @param config - MACD-V configuration
 * @returns MACD-V value with stage and validity metadata, or null if insufficient data
 */
export function macdVWithStage(
  bars: OHLCWithSynthetic[],
  config: MACDVConfig = {}
): MACDVWithStageResult | null {
  const series = macdV(bars, config);

  // If not seeded, return with reason
  if (!series.seeded) {
    return {
      macdV: NaN,
      signal: NaN,
      histogram: NaN,
      fastEMA: NaN,
      slowEMA: NaN,
      atr: NaN,
      stage: 'unknown',
      seeded: false,
      nEff: series.nEff,
      spanBars: series.spanBars,
      reason: 'Low trading activity',
    };
  }

  const lastIndex = series.macdV.length - 1;
  const macdVVal = series.macdV[lastIndex];
  const signalVal = series.signal[lastIndex];

  if (Number.isNaN(macdVVal)) {
    return null;
  }

  const stage = classifyMACDVStage(macdVVal, signalVal);

  return {
    macdV: macdVVal,
    signal: Number.isNaN(signalVal) ? 0 : signalVal,
    histogram: Number.isNaN(series.histogram[lastIndex]) ? 0 : series.histogram[lastIndex],
    fastEMA: series.fastEMA[lastIndex],
    slowEMA: series.slowEMA[lastIndex],
    atr: series.atr[lastIndex],
    stage,
    seeded: true,
    nEff: series.nEff,
    spanBars: series.spanBars,
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

// Re-export types for convenience
export type { OHLCWithSynthetic } from '../core/informative-atr.js';
