import type { Timeframe } from '@livermore/schemas';

/**
 * Cache key builders for consistent key naming across the application
 *
 * Key Architecture (v5.0):
 * - Tier 1: Exchange-scoped (shared data) - `candles:{exchange_id}:...`
 * - Tier 2: User-scoped (overflow data) - `usercandles:{user_id}:{exchange_id}:...`
 * - Legacy: User-scoped (deprecated) - `candles:{user_id}:{exchange_id}:...`
 */

// ============================================
// TIER 1: Exchange-Scoped Keys (Shared Data)
// ============================================

/**
 * Build a cache key for exchange-scoped candles (shared across users).
 * Tier 1: All users on same exchange share this data.
 *
 * @example exchangeCandleKey(1, 'BTC-USD', '5m') // 'candles:1:BTC-USD:5m'
 */
export function exchangeCandleKey(
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `candles:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Build a cache key for exchange-scoped indicators (shared across users).
 * Tier 1: Computed from shared candle data.
 *
 * @example exchangeIndicatorKey(1, 'BTC-USD', '5m', 'macd-v') // 'indicator:1:BTC-USD:5m:macd-v'
 */
export function exchangeIndicatorKey(
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  type: string,
  params?: Record<string, unknown>
): string {
  const base = `indicator:${exchangeId}:${symbol}:${timeframe}:${type}`;
  if (!params) return base;

  // Sort params for consistent keys
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join(',');

  return `${base}:${sortedParams}`;
}

/**
 * Build a Redis pub/sub channel for exchange-scoped candle close events.
 * Used by all users subscribing to same exchange/symbol.
 *
 * @example exchangeCandleCloseChannel(1, 'BTC-USD', '5m') // 'channel:exchange:1:candle:close:BTC-USD:5m'
 */
export function exchangeCandleCloseChannel(
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:exchange:${exchangeId}:candle:close:${symbol}:${timeframe}`;
}

/**
 * Build a Redis psubscribe pattern for exchange-scoped candle close events.
 * Supports wildcards for symbol or timeframe.
 *
 * @example exchangeCandleClosePattern(1, '*', '5m') // 'channel:exchange:1:candle:close:*:5m'
 */
export function exchangeCandleClosePattern(
  exchangeId: number,
  symbol: string, // Can be '*' for wildcard
  timeframe: Timeframe | '*'
): string {
  return `channel:exchange:${exchangeId}:candle:close:${symbol}:${timeframe}`;
}

/**
 * Build a Redis pub/sub channel for exchange-scoped alert triggers.
 * Any subscriber can receive signals from this exchange.
 *
 * @example exchangeAlertChannel(1) // 'channel:alerts:exchange:1'
 */
export function exchangeAlertChannel(exchangeId: number): string {
  return `channel:alerts:exchange:${exchangeId}`;
}

// ============================================
// TIER 2: User-Scoped Keys (Overflow Data)
// ============================================

/**
 * Build a cache key for user-specific candle overflow.
 * Tier 2: User-specific data with TTL for positions and manual adds
 * that are not in the shared Tier 1 pool.
 *
 * @example userCandleKey(42, 1, 'BTC-USD', '5m') // 'usercandles:42:1:BTC-USD:5m'
 */
export function userCandleKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `usercandles:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Build a cache key for user-specific indicator overflow.
 * Tier 2: User-specific with TTL.
 *
 * @example userIndicatorKey(42, 1, 'BTC-USD', '5m', 'macd-v') // 'userindicator:42:1:BTC-USD:5m:macd-v'
 */
export function userIndicatorKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  type: string,
  params?: Record<string, unknown>
): string {
  const base = `userindicator:${userId}:${exchangeId}:${symbol}:${timeframe}:${type}`;
  if (!params) return base;

  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join(',');

  return `${base}:${sortedParams}`;
}

// ============================================
// LEGACY: User-Scoped Keys (Deprecated)
// ============================================

/**
 * Build a cache key for candles
 * @deprecated Use exchangeCandleKey for shared data or userCandleKey for overflow
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
 * @deprecated Use exchangeIndicatorKey for shared data or userIndicatorKey for overflow
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
 * @deprecated Use exchangeCandleCloseChannel for shared events
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
 * Build a Redis pub/sub channel name for candle close events
 * Used by exchange adapters to publish and indicator service to subscribe
 * when candles finalize
 * @deprecated Use exchangeCandleCloseChannel for shared events
 */
export function candleCloseChannel(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:candle:close:${userId}:${exchangeId}:${symbol}:${timeframe}`;
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

/**
 * Build a Redis psubscribe pattern for candle close events
 * Supports wildcards for symbol to subscribe to all symbols at once
 * @deprecated Use exchangeCandleClosePattern for shared events
 *
 * @example
 * // Subscribe to all 5m closes for user 1, exchange 1
 * candleClosePattern(1, 1, '*', '5m')
 * // Returns: "channel:candle:close:1:1:*:5m"
 */
export function candleClosePattern(
  userId: number,
  exchangeId: number,
  symbol: string, // Can be '*' for wildcard
  timeframe: Timeframe
): string {
  return `channel:candle:close:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Build Redis pub/sub channel for control commands
 * Admin UI publishes commands, API subscribes
 * @param identitySub - Clerk user identity subject (user.id)
 */
export function commandChannel(identitySub: string): string {
  return `livermore:commands:${identitySub}`;
}

/**
 * Build Redis pub/sub channel for command responses
 * API publishes responses, Admin UI subscribes
 * @param identitySub - Clerk user identity subject (user.id)
 */
export function responseChannel(identitySub: string): string {
  return `livermore:responses:${identitySub}`;
}
