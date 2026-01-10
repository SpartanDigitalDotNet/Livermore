/**
 * Exponential Moving Average (EMA)
 *
 * Per Spiroglou spec:
 * - alpha = 2 / (period + 1)
 * - EMA[t] = alpha * value[t] + (1 - alpha) * EMA[t-1]
 * - Initialization: EMA[period-1] = SMA(values[0..period-1])
 */

import { smaLatest } from './sma.js';

export interface EMAState {
  value: number;
  period: number;
  alpha: number;
}

/**
 * Calculate the EMA multiplier (alpha)
 * @param period - EMA period
 * @returns Alpha value: 2 / (period + 1)
 */
export function emaAlpha(period: number): number {
  if (period <= 0) {
    throw new Error('EMA period must be positive');
  }
  return 2 / (period + 1);
}

/**
 * Calculate EMA for an array of values
 * @param values - Array of numeric values
 * @param period - EMA period
 * @returns Array of EMA values (same length as input, with NaN for insufficient data)
 */
export function ema(values: number[], period: number): number[] {
  if (period <= 0) {
    throw new Error('EMA period must be positive');
  }
  if (values.length === 0) {
    return [];
  }

  const result: number[] = new Array(values.length).fill(NaN);
  const alpha = emaAlpha(period);

  // Need at least `period` values to calculate first EMA
  if (values.length < period) {
    return result;
  }

  // Initialize with SMA of first `period` values
  const firstSMA = smaLatest(values.slice(0, period), period);
  if (firstSMA === null) {
    return result;
  }

  result[period - 1] = firstSMA;

  // Apply EMA formula for subsequent values
  for (let i = period; i < values.length; i++) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }

  return result;
}

/**
 * Calculate EMA incrementally (for real-time updates)
 * @param currentValue - Current price/value
 * @param previousEMA - Previous EMA value
 * @param period - EMA period
 * @returns New EMA value
 */
export function emaIncremental(
  currentValue: number,
  previousEMA: number,
  period: number
): number {
  const alpha = emaAlpha(period);
  return alpha * currentValue + (1 - alpha) * previousEMA;
}

/**
 * Get the latest EMA value from an array
 * @param values - Array of numeric values
 * @param period - EMA period
 * @returns Latest EMA value or null if insufficient data
 */
export function emaLatest(values: number[], period: number): number | null {
  const emaValues = ema(values, period);
  if (emaValues.length === 0) {
    return null;
  }
  const lastValue = emaValues[emaValues.length - 1];
  return Number.isNaN(lastValue) ? null : lastValue;
}
