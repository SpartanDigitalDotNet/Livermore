import type { Redis } from 'ioredis';
import { CandleSchema, type Candle, type Timeframe, HARDCODED_CONFIG } from '@livermore/schemas';
import { candleKey, candleChannel } from '../keys';

/**
 * Candle caching strategy using Redis sorted sets
 *
 * Candles are stored in sorted sets with timestamp as the score,
 * allowing efficient time-range queries and automatic ordering.
 * All candles are scoped by userId and exchangeId for multi-user support.
 */
export class CandleCacheStrategy {
  constructor(private redis: Redis) {}

  /**
   * Add a single candle to the cache
   */
  async addCandle(userId: number, exchangeId: number, candle: Candle): Promise<void> {
    // Validate with Zod
    const validated = CandleSchema.parse(candle);

    const key = candleKey(userId, exchangeId, validated.symbol, validated.timeframe);

    // Store in sorted set by timestamp
    await this.redis.zadd(key, validated.timestamp, JSON.stringify(validated));

    // Set expiration (24 hours for candle data)
    const ttlSeconds = HARDCODED_CONFIG.cache.candleTtlHours * 3600;
    await this.redis.expire(key, ttlSeconds);

    // Keep only the most recent candles (limit to 1000)
    await this.redis.zremrangebyrank(key, 0, -1001);
  }

  /**
   * Add multiple candles to the cache (bulk operation)
   */
  async addCandles(userId: number, exchangeId: number, candles: Candle[]): Promise<void> {
    if (candles.length === 0) return;

    // Group candles by symbol and timeframe
    const grouped = new Map<string, Candle[]>();

    for (const candle of candles) {
      const validated = CandleSchema.parse(candle);
      const key = candleKey(userId, exchangeId, validated.symbol, validated.timeframe);

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(validated);
    }

    // Use pipeline for bulk operations
    const pipeline = this.redis.pipeline();

    for (const [key, candleGroup] of grouped) {
      // Add all candles to sorted set
      for (const candle of candleGroup) {
        pipeline.zadd(key, candle.timestamp, JSON.stringify(candle));
      }

      // Set expiration
      const ttlSeconds = HARDCODED_CONFIG.cache.candleTtlHours * 3600;
      pipeline.expire(key, ttlSeconds);

      // Keep only recent candles
      pipeline.zremrangebyrank(key, 0, -1001);
    }

    await pipeline.exec();
  }

  /**
   * Get recent candles from cache
   */
  async getRecentCandles(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    count: number = 100
  ): Promise<Candle[]> {
    const key = candleKey(userId, exchangeId, symbol, timeframe);

    // Get the most recent N candles
    const results = await this.redis.zrange(key, -count, -1);

    return results.map((json) => CandleSchema.parse(JSON.parse(json)));
  }

  /**
   * Get candles in a time range
   */
  async getCandlesInRange(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    start: number,
    end: number
  ): Promise<Candle[]> {
    const key = candleKey(userId, exchangeId, symbol, timeframe);

    // Get candles between start and end timestamps
    const results = await this.redis.zrangebyscore(key, start, end);

    return results.map((json) => CandleSchema.parse(JSON.parse(json)));
  }

  /**
   * Get the latest candle
   */
  async getLatestCandle(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe
  ): Promise<Candle | null> {
    const key = candleKey(userId, exchangeId, symbol, timeframe);

    // Get the most recent candle
    const results = await this.redis.zrange(key, -1, -1);

    if (results.length === 0) return null;

    return CandleSchema.parse(JSON.parse(results[0]));
  }

  /**
   * Publish candle update to Redis pub/sub
   */
  async publishUpdate(userId: number, exchangeId: number, candle: Candle): Promise<void> {
    const channel = candleChannel(userId, exchangeId, candle.symbol, candle.timeframe);
    await this.redis.publish(channel, JSON.stringify(candle));
  }

  /**
   * Clear all candles for a symbol and timeframe
   */
  async clearCandles(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe
  ): Promise<void> {
    const key = candleKey(userId, exchangeId, symbol, timeframe);
    await this.redis.del(key);
  }

  /**
   * Get count of cached candles
   */
  async getCandleCount(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe
  ): Promise<number> {
    const key = candleKey(userId, exchangeId, symbol, timeframe);
    return await this.redis.zcard(key);
  }
}
