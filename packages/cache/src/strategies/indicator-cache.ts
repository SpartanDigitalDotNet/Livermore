import type { Redis } from 'ioredis';
import type { Timeframe } from '@livermore/schemas';
import { indicatorKey, indicatorChannel } from '../keys';

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
  private defaultTtlSeconds = 3600; // 1 hour default TTL

  constructor(private redis: Redis) {}

  /**
   * Store an indicator value in cache
   */
  async setIndicator(
    userId: number,
    exchangeId: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    const key = indicatorKey(
      userId,
      exchangeId,
      indicator.symbol,
      indicator.timeframe,
      indicator.type,
      indicator.params
    );

    await this.redis.set(key, JSON.stringify(indicator), 'EX', this.defaultTtlSeconds);
  }

  /**
   * Store multiple indicator values (for historical data)
   */
  async setIndicators(
    userId: number,
    exchangeId: number,
    indicators: CachedIndicatorValue[]
  ): Promise<void> {
    if (indicators.length === 0) return;

    const pipeline = this.redis.pipeline();

    for (const indicator of indicators) {
      const key = indicatorKey(
        userId,
        exchangeId,
        indicator.symbol,
        indicator.timeframe,
        indicator.type,
        indicator.params
      );

      pipeline.set(key, JSON.stringify(indicator), 'EX', this.defaultTtlSeconds);
    }

    await pipeline.exec();
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
}
