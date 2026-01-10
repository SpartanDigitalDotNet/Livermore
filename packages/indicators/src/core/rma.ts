/**
 * Wilder's Smoothed Moving Average (RMA / SMMA)
 *
 * Per Spiroglou spec for ATR calculation:
 * - Initialization: RMA[period-1] = SMA(values[0..period-1])
 * - Recursive: RMA[t] = (RMA[t-1] * (period - 1) + value[t]) / period
 *
 * This is equivalent to an EMA with alpha = 1/period (instead of 2/(period+1))
 * Also known as Wilder's smoothing, SMMA, or MMA.
 */

import { smaLatest } from './sma.js';

export interface RMAState {
  value: number;
  period: number;
}

/**
 * Calculate RMA (Wilder's smoothing) for an array of values
 * @param values - Array of numeric values
 * @param period - RMA period
 * @returns Array of RMA values (same length as input, with NaN for insufficient data)
 */
export function rma(values: number[], period: number): number[] {
  if (period <= 0) {
    throw new Error('RMA period must be positive');
  }
  if (values.length === 0) {
    return [];
  }

  const result: number[] = new Array(values.length).fill(NaN);

  // Need at least `period` values to calculate first RMA
  if (values.length < period) {
    return result;
  }

  // Initialize with SMA of first `period` values
  const firstSMA = smaLatest(values.slice(0, period), period);
  if (firstSMA === null) {
    return result;
  }

  result[period - 1] = firstSMA;

  // Apply Wilder's smoothing formula for subsequent values
  // RMA[t] = (RMA[t-1] * (period - 1) + value[t]) / period
  for (let i = period; i < values.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + values[i]) / period;
  }

  return result;
}

/**
 * Calculate RMA incrementally (for real-time updates)
 * @param currentValue - Current value
 * @param previousRMA - Previous RMA value
 * @param period - RMA period
 * @returns New RMA value
 */
export function rmaIncremental(
  currentValue: number,
  previousRMA: number,
  period: number
): number {
  return (previousRMA * (period - 1) + currentValue) / period;
}

/**
 * Get the latest RMA value from an array
 * @param values - Array of numeric values
 * @param period - RMA period
 * @returns Latest RMA value or null if insufficient data
 */
export function rmaLatest(values: number[], period: number): number | null {
  const rmaValues = rma(values, period);
  if (rmaValues.length === 0) {
    return null;
  }
  const lastValue = rmaValues[rmaValues.length - 1];
  return Number.isNaN(lastValue) ? null : lastValue;
}
