/**
 * @livermore/indicators
 *
 * Technical indicators library for Livermore trading platform.
 * Implements MACD-V per Alex Spiroglou specification.
 */

// Core functions
export { sma, smaLatest, type SMAResult } from './core/sma.js';
export { ema, emaLatest, emaIncremental, emaAlpha, type EMAState } from './core/ema.js';
export { rma, rmaLatest, rmaIncremental, type RMAState } from './core/rma.js';
export { trueRange, trueRangeSeries, type OHLC } from './core/true-range.js';
export { atr, atrLatest, atrIncremental, type ATRResult } from './core/atr.js';

// Indicators
export {
  macd,
  macdLatest,
  MACD_DEFAULTS,
  type MACDConfig,
  type MACDValue,
  type MACDSeries,
} from './indicators/macd.js';

export {
  macdV,
  macdVLatest,
  macdVWithStage,
  macdVMinBars,
  classifyMACDVStage,
  MACD_V_DEFAULTS,
  type MACDVConfig,
  type MACDVValue,
  type MACDVSeries,
  type MACDVStage,
} from './indicators/macd-v.js';
