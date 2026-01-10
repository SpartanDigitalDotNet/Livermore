/**
 * Average True Range (ATR)
 *
 * Per Spiroglou spec - uses Wilder's smoothing (RMA/SMMA):
 * - Initialization: ATR[atrLen-1] = SMA(TR[0..atrLen-1])
 * - Recursive: ATR[t] = (ATR[t-1] * (atrLen - 1) + TR[t]) / atrLen
 */

import { type OHLC, trueRangeSeries } from './true-range.js';
import { rma } from './rma.js';

export interface ATRResult {
  atr: number[];
  tr: number[];
}

/**
 * Calculate ATR for an array of OHLC bars
 * @param bars - Array of OHLC bars (oldest first)
 * @param period - ATR period (default: 26 per Spiroglou)
 * @returns Object containing ATR and TR arrays
 */
export function atr(bars: OHLC[], period: number = 26): ATRResult {
  if (period <= 0) {
    throw new Error('ATR period must be positive');
  }

  // Calculate True Range series
  const tr = trueRangeSeries(bars);

  // Apply Wilder's smoothing (RMA) to TR
  const atrValues = rma(tr, period);

  return {
    atr: atrValues,
    tr,
  };
}

/**
 * Get the latest ATR value from an array of OHLC bars
 * @param bars - Array of OHLC bars (oldest first)
 * @param period - ATR period (default: 26 per Spiroglou)
 * @returns Latest ATR value or null if insufficient data
 */
export function atrLatest(bars: OHLC[], period: number = 26): number | null {
  const { atr: atrValues } = atr(bars, period);

  if (atrValues.length === 0) {
    return null;
  }

  const lastValue = atrValues[atrValues.length - 1];
  return Number.isNaN(lastValue) ? null : lastValue;
}

/**
 * Calculate ATR incrementally (for real-time updates)
 * @param tr - Current True Range value
 * @param previousATR - Previous ATR value
 * @param period - ATR period
 * @returns New ATR value
 */
export function atrIncremental(
  tr: number,
  previousATR: number,
  period: number
): number {
  return (previousATR * (period - 1) + tr) / period;
}
