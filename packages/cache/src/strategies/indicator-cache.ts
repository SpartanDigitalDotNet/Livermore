import type { Timeframe } from '@livermore/schemas';
import { indicatorKey, indicatorChannel, exchangeIndicatorKey, userIndicatorKey } from '../keys';
import type { RedisClient } from '../client';

/**
 * Indicator value stored in cache
 */
export interface CachedIndicatorValue {
  timestamp: number;
  type: string;
  symbol: string;
  timeframe: Timeframe;
  value: Record<string, number>;
  params?: Record<string, unknown>;
}

/**
 * Indicator caching strategy for Redis
 *
 * Stores calculated indicator values with configurable TTL
 * and supports pub/sub for real-time updates.
 *
 * Key Architecture (v5.0):
 * - Tier 1: Exchange-scoped shared data (`indicator:{exchange_id}:...`)
 * - Tier 2: User-scoped overflow data (`userindicator:{user_id}:{exchange_id}:...`)
 * - Legacy: User-scoped data (`indicator:{user_id}:{exchange_id}:...`) - deprecated
 *
 * Read Order: Tier 1 -> Legacy -> Tier 2 (dual-read for migration)
 */
export class IndicatorCacheStrategy {
  private defaultTtlSeconds = 90000; // 25 hours - must exceed longest timeframe (1d)

  constructor(private redis: RedisClient) {}

  /**
   * Store an indicator value in cache
   * Note: params are stored in the value but NOT included in the key
   * This ensures consistent key lookup regardless of indicator parameters
   *
   * @param tier - 1 for shared exchange data (default), 2 for user overflow
   */
  async setIndicator(
    userId: number,
    exchangeId: number,
    indicator: CachedIndicatorValue,
    tier: 1 | 2 = 1
  ): Promise<void> {
    // Select key based on tier (excludes params for consistent lookup)
    const key = tier === 1
      ? exchangeIndicatorKey(exchangeId, indicator.symbol, indicator.timeframe, indicator.type)
      : userIndicatorKey(userId, exchangeId, indicator.symbol, indicator.timeframe, indicator.type);

    await this.redis.set(key, JSON.stringify(indicator), 'EX', this.defaultTtlSeconds);
  }

  /**
   * Store multiple indicator values (for historical data)
   * Note: params are stored in the value but NOT included in the key
   *
   * Uses individual SET commands instead of pipeline for Azure Redis Cluster compatibility.
   *
   * @param tier - 1 for shared exchange data (default), 2 for user overflow
   */
  async setIndicators(
    userId: number,
    exchangeId: number,
    indicators: CachedIndicatorValue[],
    tier: 1 | 2 = 1
  ): Promise<void> {
    if (indicators.length === 0) return;

    // Process each indicator separately (Azure Redis Cluster compatible)
    for (const indicator of indicators) {
      // Select key based on tier (excludes params for consistent lookup)
      const key = tier === 1
        ? exchangeIndicatorKey(exchangeId, indicator.symbol, indicator.timeframe, indicator.type)
        : userIndicatorKey(userId, exchangeId, indicator.symbol, indicator.timeframe, indicator.type);

      await this.redis.set(key, JSON.stringify(indicator), 'EX', this.defaultTtlSeconds);
    }
  }

  /**
   * Get an indicator value from cache
   * Uses dual-read pattern: Tier 1 (exchange-scoped) -> Legacy -> Tier 2 (user overflow)
   */
  async getIndicator(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    type: string,
    params?: Record<string, unknown>
  ): Promise<CachedIndicatorValue | null> {
    // Tier 1: Try exchange-scoped key first (shared data)
    const exchangeKey = exchangeIndicatorKey(exchangeId, symbol, timeframe, type, params);
    let result = await this.redis.get(exchangeKey);

    // Fall back to legacy user-scoped key during migration
    if (!result) {
      const legacyKey = indicatorKey(userId, exchangeId, symbol, timeframe, type, params);
      result = await this.redis.get(legacyKey);
    }

    // Tier 2: Check user overflow if still empty
    if (!result) {
      const overflowKey = userIndicatorKey(userId, exchangeId, symbol, timeframe, type, params);
      result = await this.redis.get(overflowKey);
    }

    if (!result) return null;

    return JSON.parse(result) as CachedIndicatorValue;
  }

  /**
   * Publish indicator update to Redis pub/sub
   */
  async publishUpdate(
    userId: number,
    exchangeId: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    const channel = indicatorChannel(
      userId,
      exchangeId,
      indicator.symbol,
      indicator.timeframe,
      indicator.type
    );

    await this.redis.publish(channel, JSON.stringify(indicator));
  }

  /**
   * Check if indicator exists in cache
   * Checks all tiers: Tier 1 (exchange-scoped) -> Legacy -> Tier 2 (user overflow)
   */
  async hasIndicator(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    type: string,
    params?: Record<string, unknown>
  ): Promise<boolean> {
    // Tier 1: Check exchange-scoped key first
    const exchangeKey = exchangeIndicatorKey(exchangeId, symbol, timeframe, type, params);
    if ((await this.redis.exists(exchangeKey)) === 1) return true;

    // Fall back to legacy user-scoped key
    const legacyKey = indicatorKey(userId, exchangeId, symbol, timeframe, type, params);
    if ((await this.redis.exists(legacyKey)) === 1) return true;

    // Tier 2: Check user overflow
    const overflowKey = userIndicatorKey(userId, exchangeId, symbol, timeframe, type, params);
    return (await this.redis.exists(overflowKey)) === 1;
  }

  /**
   * Get multiple indicators at once (bulk fetch)
   * Returns a map of "symbol:timeframe" -> indicator value
   * Uses dual-read pattern: Tier 1 (exchange-scoped) -> Legacy -> Tier 2 (user overflow)
   */
  async getIndicatorsBulk(
    userId: number,
    exchangeId: number,
    requests: { symbol: string; timeframe: Timeframe; type?: string }[]
  ): Promise<Map<string, CachedIndicatorValue>> {
    if (requests.length === 0) return new Map();

    const map = new Map<string, CachedIndicatorValue>();

    // Process each request with dual-read pattern (Azure Redis Cluster compatible)
    for (const r of requests) {
      const type = r.type || 'macd-v';
      const mapKey = `${r.symbol}:${r.timeframe}`;

      // Tier 1: Try exchange-scoped key first
      const exchangeKey = exchangeIndicatorKey(exchangeId, r.symbol, r.timeframe, type);
      let result = await this.redis.get(exchangeKey);

      // Fall back to legacy user-scoped key
      if (!result) {
        const legacyKey = indicatorKey(userId, exchangeId, r.symbol, r.timeframe, type);
        result = await this.redis.get(legacyKey);
      }

      // Tier 2: Check user overflow
      if (!result) {
        const overflowKey = userIndicatorKey(userId, exchangeId, r.symbol, r.timeframe, type);
        result = await this.redis.get(overflowKey);
      }

      if (result) {
        map.set(mapKey, JSON.parse(result) as CachedIndicatorValue);
      }
    }

    return map;
  }

  /**
   * Delete an indicator from cache
   * Clears from Tier 1 (exchange-scoped), legacy, and Tier 2 (user overflow) keys
   */
  async deleteIndicator(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    type: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    // Clear from all tiers
    const exchangeKey = exchangeIndicatorKey(exchangeId, symbol, timeframe, type, params);
    const legacyKey = indicatorKey(userId, exchangeId, symbol, timeframe, type, params);
    const overflowKey = userIndicatorKey(userId, exchangeId, symbol, timeframe, type, params);

    await this.redis.del(exchangeKey);
    await this.redis.del(legacyKey);
    await this.redis.del(overflowKey);
  }
}
