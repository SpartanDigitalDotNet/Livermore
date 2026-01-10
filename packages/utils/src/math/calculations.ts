/**
 * Calculate the sum of an array of numbers
 */
export function sum(values: number[]): number {
  return values.reduce((acc, val) => acc + val, 0);
}

/**
 * Calculate the mean (average) of an array of numbers
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/**
 * Calculate the standard deviation of an array of numbers
 */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map((value) => Math.pow(value - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

/**
 * Calculate percentage change between two values
 *
 * @param oldValue - Previous value
 * @param newValue - Current value
 * @returns Percentage change
 */
export function percentageChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Round a number to a specific number of decimal places
 *
 * @param value - Number to round
 * @param decimals - Number of decimal places
 * @returns Rounded number
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Clamp a value between min and max
 *
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculate the exponential moving average (EMA) smoothing factor
 *
 * @param period - EMA period
 * @returns Smoothing factor (alpha)
 */
export function emaAlpha(period: number): number {
  return 2 / (period + 1);
}

/**
 * Linear interpolation between two values
 *
 * @param a - Start value
 * @param b - End value
 * @param t - Interpolation factor (0-1)
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Find the maximum value in an array
 */
export function max(values: number[]): number {
  if (values.length === 0) throw new Error('Cannot find max of empty array');
  return Math.max(...values);
}

/**
 * Find the minimum value in an array
 */
export function min(values: number[]): number {
  if (values.length === 0) throw new Error('Cannot find min of empty array');
  return Math.min(...values);
}

/**
 * Calculate the range (max - min) of an array
 */
export function range(values: number[]): number {
  return max(values) - min(values);
}

/**
 * Check if two numbers are approximately equal within a tolerance
 *
 * @param a - First number
 * @param b - Second number
 * @param epsilon - Tolerance (default: 1e-10)
 * @returns True if numbers are approximately equal
 */
export function approxEqual(a: number, b: number, epsilon: number = 1e-10): boolean {
  return Math.abs(a - b) < epsilon;
}
