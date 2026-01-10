import type { Timeframe } from '@livermore/schemas';

/**
 * Convert timeframe string to milliseconds
 *
 * @param timeframe - Timeframe string (e.g., '1m', '5m', '1h', '1d')
 * @returns Duration in milliseconds
 */
export function timeframeToMs(timeframe: Timeframe): number {
  const unit = timeframe.slice(-1);
  const value = parseInt(timeframe.slice(0, -1), 10);

  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid timeframe: ${timeframe}`);
  }
}

/**
 * Convert milliseconds to timeframe string
 *
 * @param ms - Duration in milliseconds
 * @returns Timeframe string or null if no exact match
 */
export function msToTimeframe(ms: number): Timeframe | null {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (ms === day) return '1d';
  if (ms === 4 * hour) return '4h';
  if (ms === hour) return '1h';
  if (ms === 15 * minute) return '15m';
  if (ms === 5 * minute) return '5m';
  if (ms === minute) return '1m';

  return null;
}

/**
 * Get the candle timestamp (floor to timeframe boundary)
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param timeframe - Timeframe string
 * @returns Floored timestamp to the start of the candle period
 */
export function getCandleTimestamp(timestamp: number, timeframe: Timeframe): number {
  const intervalMs = timeframeToMs(timeframe);
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

/**
 * Get the next candle timestamp
 *
 * @param timestamp - Current timestamp in milliseconds
 * @param timeframe - Timeframe string
 * @returns Timestamp of the next candle
 */
export function getNextCandleTimestamp(timestamp: number, timeframe: Timeframe): number {
  const current = getCandleTimestamp(timestamp, timeframe);
  return current + timeframeToMs(timeframe);
}

/**
 * Check if a timestamp is at the start of a new candle
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param timeframe - Timeframe string
 * @returns True if timestamp is at the start of a candle boundary
 */
export function isNewCandle(timestamp: number, timeframe: Timeframe): boolean {
  const intervalMs = timeframeToMs(timeframe);
  return timestamp % intervalMs === 0;
}

/**
 * Get a range of candle timestamps between start and end
 *
 * @param start - Start timestamp in milliseconds
 * @param end - End timestamp in milliseconds
 * @param timeframe - Timeframe string
 * @returns Array of candle timestamps
 */
export function getCandleTimestamps(
  start: number,
  end: number,
  timeframe: Timeframe
): number[] {
  const intervalMs = timeframeToMs(timeframe);
  const startCandle = getCandleTimestamp(start, timeframe);
  const timestamps: number[] = [];

  for (let ts = startCandle; ts <= end; ts += intervalMs) {
    timestamps.push(ts);
  }

  return timestamps;
}

/**
 * Format timestamp to human-readable string
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Parse ISO date string to unix timestamp
 *
 * @param dateString - ISO date string
 * @returns Unix timestamp in milliseconds
 */
export function parseTimestamp(dateString: string): number {
  return new Date(dateString).getTime();
}
