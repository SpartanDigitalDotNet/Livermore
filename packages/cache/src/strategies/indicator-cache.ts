import type { Timeframe } from '@livermore/schemas';
import { indicatorKey, indicatorChannel } from '../keys';
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
 */
export class IndicatorCacheStrategy {
  private defaultTtlSeconds = 90000; // 25 hours - must exceed longest timeframe (1d)

  constructor(private redis: RedisClient) {}

  /**
   * Store an indicator value in cache
   * Note: params are stored in the value but NOT included in the key
   * This ensures consistent key lookup regardless of indicator parameters
   */
  async setIndicator(
    userId: number,
    exchangeId: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    // Key excludes params for consistent lookup
    const key = indicatorKey(
      userId,
      exchangeId,
      indicator.symbol,
      indicator.timeframe,
      indicator.type
    );

    await this.redis.set(key, JSON.stringify(indicator), 'EX', this.defaultTtlSeconds);
  }

  /**
   * Store multiple indicator values (for historical data)
   * Note: params are stored in the value but NOT included in the key
   *
   * Uses individual SET commands instead of pipeline for Azure Redis Cluster compatibility.
   */
  async setIndicators(
    userId: number,
    exchangeId: number,
    indicators: CachedIndicatorValue[]
  ): Promise<void> {
    if (indicators.length === 0) return;

    // Process each indicator separately (Azure Redis Cluster compatible)
    for (const indicator of indicators) {
      // Key excludes params for consistent lookup
      const key = indicatorKey(
        userId,
        exchangeId,
        indicator.symbol,
        indicator.timeframe,
        indicator.type
      );

      await this.redis.set(key, JSON.stringify(indicator), 'EX', this.defaultTtlSeconds);
    }
  }

  /**
   * Get an indicator value from cache
   */
  async getIndicator(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    type: string,
    params?: Record<string, unknown>
  ): Promise<CachedIndicatorValue | null> {
    const key = indicatorKey(userId, exchangeId, symbol, timeframe, type, params);
    const result = await this.redis.get(key);

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
   * Delete an indicator from cache
   */
  async deleteIndicator(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    type: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    const key = indicatorKey(userId, exchangeId, symbol, timeframe, type, params);
    await this.redis.del(key);
  }

  /**
   * Check if indicator exists in cache
   */
  async hasIndicator(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    type: string,
    params?: Record<string, unknown>
  ): Promise<boolean> {
    const key = indicatorKey(userId, exchangeId, symbol, timeframe, type, params);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Get multiple indicators at once (bulk fetch)
   * Returns a map of "symbol:timeframe" -> indicator value
   */
  async getIndicatorsBulk(
    userId: number,
    exchangeId: number,
    requests: { symbol: string; timeframe: Timeframe; type?: string }[]
  ): Promise<Map<string, CachedIndicatorValue>> {
    if (requests.length === 0) return new Map();

    // Build keys
    const keys = requests.map((r) =>
      indicatorKey(userId, exchangeId, r.symbol, r.timeframe, r.type || 'macd-v')
    );

    // Use individual GET calls for Azure Redis Cluster compatibility (avoids CROSSSLOT errors)
    const results = await Promise.all(keys.map((key) => this.redis.get(key)));

    const map = new Map<string, CachedIndicatorValue>();
    for (let i = 0; i < requests.length; i++) {
      const result = results[i];
      if (result) {
        const key = `${requests[i].symbol}:${requests[i].timeframe}`;
        map.set(key, JSON.parse(result) as CachedIndicatorValue);
      }
    }

    return map;
  }
}
