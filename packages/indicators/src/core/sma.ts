/**
 * Simple Moving Average (SMA)
 *
 * The arithmetic mean of the last N values.
 * Used for EMA/RMA initialization per Spiroglou spec.
 */

export interface SMAResult {
  value: number;
  period: number;
}

/**
 * Calculate SMA for an array of values
 * @param values - Array of numeric values
 * @param period - Number of periods for the average
 * @returns Array of SMA values (length = values.length - period + 1)
 */
export function sma(values: number[], period: number): number[] {
  if (period <= 0) {
    throw new Error('SMA period must be positive');
  }
  if (values.length < period) {
    return [];
  }

  const result: number[] = [];

  // Calculate first SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result.push(sum / period);

  // Slide the window for subsequent values
  for (let i = period; i < values.length; i++) {
    sum = sum - values[i - period] + values[i];
    result.push(sum / period);
  }

  return result;
}

/**
 * Calculate single SMA value for the most recent period
 * @param values - Array of numeric values (must have at least `period` values)
 * @param period - Number of periods for the average
 * @returns Single SMA value or null if insufficient data
 */
export function smaLatest(values: number[], period: number): number | null {
  if (period <= 0) {
    throw new Error('SMA period must be positive');
  }
  if (values.length < period) {
    return null;
  }

  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}
