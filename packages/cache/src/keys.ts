import type { Timeframe } from '@livermore/schemas';

/**
 * Cache key builders for consistent key naming across the application
 * All keys are scoped by userId and exchangeId for multi-user, multi-exchange support
 */

/**
 * Build a cache key for candles
 */
export function candleKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `candles:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Build a cache key for ticker data
 */
export function tickerKey(userId: number, exchangeId: number, symbol: string): string {
  return `ticker:${userId}:${exchangeId}:${symbol}`;
}

/**
 * Build a cache key for orderbook
 */
export function orderbookKey(userId: number, exchangeId: number, symbol: string): string {
  return `orderbook:${userId}:${exchangeId}:${symbol}`;
}

/**
 * Build a cache key for indicator values
 */
export function indicatorKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  type: string,
  params?: Record<string, unknown>
): string {
  const base = `indicator:${userId}:${exchangeId}:${symbol}:${timeframe}:${type}`;
  if (!params) return base;

  // Sort params for consistent keys
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join(',');

  return `${base}:${sortedParams}`;
}

/**
 * Build a Redis pub/sub channel name for candle updates
 */
export function candleChannel(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:candle:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Build a Redis pub/sub channel name for ticker updates
 */
export function tickerChannel(userId: number, exchangeId: number, symbol: string): string {
  return `channel:ticker:${userId}:${exchangeId}:${symbol}`;
}

/**
 * Build a Redis pub/sub channel name for orderbook updates
 */
export function orderbookChannel(userId: number, exchangeId: number, symbol: string): string {
  return `channel:orderbook:${userId}:${exchangeId}:${symbol}`;
}

/**
 * Build a Redis pub/sub channel name for indicator updates
 */
export function indicatorChannel(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  type: string
): string {
  return `channel:indicator:${userId}:${exchangeId}:${symbol}:${timeframe}:${type}`;
}

/**
 * Build a Redis pub/sub channel name for alert triggers
 * Scoped to user so they only receive their own alerts
 */
export function alertChannel(userId: number): string {
  return `channel:alerts:${userId}`;
}
