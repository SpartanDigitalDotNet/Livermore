import { CandleSchema, UnifiedCandleSchema, type Candle, type UnifiedCandle, type Timeframe, HARDCODED_CONFIG } from '@livermore/schemas';
import { candleKey, candleChannel, exchangeCandleKey, userCandleKey } from '../keys';
import type { RedisClient } from '../client';

/**
 * Candle caching strategy using Redis sorted sets
 *
 * Candles are stored in sorted sets with timestamp as the score,
 * allowing efficient time-range queries and automatic ordering.
 *
 * Key Architecture (v5.0):
 * - Tier 1: Exchange-scoped shared data (`candles:{exchange_id}:...`)
 * - Tier 2: User-scoped overflow data (`usercandles:{user_id}:{exchange_id}:...`)
 * - Legacy: User-scoped data (`candles:{user_id}:{exchange_id}:...`) - deprecated
 *
 * Read Order: Tier 1 -> Legacy -> Tier 2 (dual-read for migration)
 */
export class CandleCacheStrategy {
  constructor(private redis: RedisClient) {}

  /**
   * Add a single candle to the cache
   * Removes any existing candle with the same timestamp to prevent duplicates
   *
   * @param tier - 1 for shared exchange data (default), 2 for user overflow
   */
  async addCandle(
    userId: number,
    exchangeId: number,
    candle: Candle,
    tier: 1 | 2 = 1
  ): Promise<void> {
    // Validate with Zod
    const validated = CandleSchema.parse(candle);

    // Select key based on tier
    const key = tier === 1
      ? exchangeCandleKey(exchangeId, validated.symbol, validated.timeframe)
      : userCandleKey(userId, exchangeId, validated.symbol, validated.timeframe);

    // Remove any existing candle with same timestamp (prevents duplicates from updating candles)
    await this.redis.zremrangebyscore(key, validated.timestamp, validated.timestamp);

    // Store in sorted set by timestamp
    await this.redis.zadd(key, validated.timestamp, JSON.stringify(validated));

    // TTL only for Tier 2 (user overflow) - Tier 1 shared data has no TTL
    if (tier === 2) {
      const ttlSeconds = HARDCODED_CONFIG.cache.candleTtlHours * 3600;
      await this.redis.expire(key, ttlSeconds);
    }

    // Keep only the most recent candles (limit to 1000)
    await this.redis.zremrangebyrank(key, 0, -1001);
  }

  /**
   * Add multiple candles to the cache (bulk operation)
   * Removes existing candles with same timestamps to prevent duplicates
   *
   * Note: Uses individual commands instead of pipeline for Azure Redis Cluster compatibility.
   * Pipeline batches commands across different keys which causes MOVED errors in cluster mode.
   *
   * @param tier - 1 for shared exchange data (default), 2 for user overflow
   */
  async addCandles(
    userId: number,
    exchangeId: number,
    candles: Candle[],
    tier: 1 | 2 = 1
  ): Promise<void> {
    if (candles.length === 0) return;

    // Group candles by symbol and timeframe
    const grouped = new Map<string, Candle[]>();

    for (const candle of candles) {
      const validated = CandleSchema.parse(candle);
      const key = tier === 1
        ? exchangeCandleKey(exchangeId, validated.symbol, validated.timeframe)
        : userCandleKey(userId, exchangeId, validated.symbol, validated.timeframe);

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(validated);
    }

    // Process each key group separately (Azure Redis Cluster compatible)
    for (const [key, candleGroup] of grouped) {
      // Remove existing candles with same timestamps first (prevents duplicates)
      for (const candle of candleGroup) {
        await this.redis.zremrangebyscore(key, candle.timestamp, candle.timestamp);
      }

      // Add all candles to sorted set
      for (const candle of candleGroup) {
        await this.redis.zadd(key, candle.timestamp, JSON.stringify(candle));
      }

      // TTL only for Tier 2 (user overflow)
      if (tier === 2) {
        const ttlSeconds = HARDCODED_CONFIG.cache.candleTtlHours * 3600;
        await this.redis.expire(key, ttlSeconds);
      }

      // Keep only recent candles
      await this.redis.zremrangebyrank(key, 0, -1001);
    }
  }

  /**
   * Add candle only if newer than existing (versioned write)
   * Uses sequence number for ordering when timestamps match.
   * This prevents out-of-order WebSocket messages from overwriting newer data.
   *
   * @param tier - 1 for shared exchange data (default), 2 for user overflow
   * @returns true if written, false if skipped (older or same sequence number)
   */
  /**
   * Add an exchange-scoped candle (tier 1) if it's newer than what's cached.
   * No userId required — exchange-scoped keys only.
   */
  async addExchangeCandle(
    exchangeId: number,
    candle: UnifiedCandle
  ): Promise<boolean> {
    return this.addCandleIfNewer(0, exchangeId, candle, 1);
  }

  async addCandleIfNewer(
    userId: number,
    exchangeId: number,
    candle: UnifiedCandle,
    tier: 1 | 2 = 1
  ): Promise<boolean> {
    // Validate with Zod
    const validated = UnifiedCandleSchema.parse(candle);

    const key = tier === 1
      ? exchangeCandleKey(exchangeId, validated.symbol, validated.timeframe)
      : userCandleKey(userId, exchangeId, validated.symbol, validated.timeframe);

    // Get existing candle at this timestamp
    const existing = await this.redis.zrangebyscore(
      key,
      validated.timestamp,
      validated.timestamp
    );

    if (existing.length > 0) {
      // Candle exists at this timestamp - check if we should update
      const existingCandle = JSON.parse(existing[0]) as UnifiedCandle;

      // If both have sequence numbers, use them for ordering
      if (validated.sequenceNum !== undefined && existingCandle.sequenceNum !== undefined) {
        if (validated.sequenceNum <= existingCandle.sequenceNum) {
          return false; // Skip - older or same data
        }
      } else if (validated.sequenceNum === undefined && existingCandle.sequenceNum !== undefined) {
        // New candle has no sequence, existing does - skip (existing is more authoritative)
        return false;
      }
      // If existing has no sequence but new does, or neither has sequence, allow overwrite
    }

    // Remove existing candle at this timestamp and write new one
    await this.redis.zremrangebyscore(key, validated.timestamp, validated.timestamp);
    await this.redis.zadd(key, validated.timestamp, JSON.stringify(validated));

    // TTL only for Tier 2 (user overflow)
    if (tier === 2) {
      const ttlSeconds = HARDCODED_CONFIG.cache.candleTtlHours * 3600;
      await this.redis.expire(key, ttlSeconds);
    }

    // Keep only the most recent candles (limit to 1000)
    await this.redis.zremrangebyrank(key, 0, -1001);

    return true;
  }

  /**
   * Get recent candles from cache
   * Uses dual-read pattern: Tier 1 (exchange-scoped) -> Legacy -> Tier 2 (user overflow)
   */
  async getRecentCandles(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    count: number = 100
  ): Promise<Candle[]> {
    // Tier 1: Try exchange-scoped key first (shared data)
    const exchangeKey = exchangeCandleKey(exchangeId, symbol, timeframe);
    let results = await this.redis.zrange(exchangeKey, -count, -1);

    // Fall back to legacy user-scoped key during migration
    if (results.length === 0) {
      const legacyKey = candleKey(userId, exchangeId, symbol, timeframe);
      results = await this.redis.zrange(legacyKey, -count, -1);
    }

    // Tier 2: Check user overflow if still empty (for user-specific symbols)
    if (results.length === 0) {
      const overflowKey = userCandleKey(userId, exchangeId, symbol, timeframe);
      results = await this.redis.zrange(overflowKey, -count, -1);
    }

    return results.map((json) => CandleSchema.parse(JSON.parse(json)));
  }

  /**
   * Get candles in a time range
   * Uses dual-read pattern: Tier 1 (exchange-scoped) -> Legacy -> Tier 2 (user overflow)
   */
  async getCandlesInRange(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe,
    start: number,
    end: number
  ): Promise<Candle[]> {
    // Tier 1: Try exchange-scoped key first (shared data)
    const exchangeKey = exchangeCandleKey(exchangeId, symbol, timeframe);
    let results = await this.redis.zrangebyscore(exchangeKey, start, end);

    // Fall back to legacy user-scoped key during migration
    if (results.length === 0) {
      const legacyKey = candleKey(userId, exchangeId, symbol, timeframe);
      results = await this.redis.zrangebyscore(legacyKey, start, end);
    }

    // Tier 2: Check user overflow if still empty
    if (results.length === 0) {
      const overflowKey = userCandleKey(userId, exchangeId, symbol, timeframe);
      results = await this.redis.zrangebyscore(overflowKey, start, end);
    }

    return results.map((json) => CandleSchema.parse(JSON.parse(json)));
  }

  /**
   * Get the latest candle
   * Uses dual-read pattern: Tier 1 (exchange-scoped) -> Legacy -> Tier 2 (user overflow)
   */
  async getLatestCandle(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe
  ): Promise<Candle | null> {
    // Tier 1: Try exchange-scoped key first (shared data)
    const exchangeKey = exchangeCandleKey(exchangeId, symbol, timeframe);
    let results = await this.redis.zrange(exchangeKey, -1, -1);

    // Fall back to legacy user-scoped key during migration
    if (results.length === 0) {
      const legacyKey = candleKey(userId, exchangeId, symbol, timeframe);
      results = await this.redis.zrange(legacyKey, -1, -1);
    }

    // Tier 2: Check user overflow if still empty
    if (results.length === 0) {
      const overflowKey = userCandleKey(userId, exchangeId, symbol, timeframe);
      results = await this.redis.zrange(overflowKey, -1, -1);
    }

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
   * Clears from Tier 1 (exchange-scoped), legacy, and Tier 2 (user overflow) keys
   */
  async clearCandles(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe
  ): Promise<void> {
    // Clear from all tiers
    const exchangeKey = exchangeCandleKey(exchangeId, symbol, timeframe);
    const legacyKey = candleKey(userId, exchangeId, symbol, timeframe);
    const overflowKey = userCandleKey(userId, exchangeId, symbol, timeframe);

    await this.redis.del(exchangeKey);
    await this.redis.del(legacyKey);
    await this.redis.del(overflowKey);
  }

  /**
   * Get count of cached candles
   * Returns count from first tier that has data (Tier 1 -> Legacy -> Tier 2)
   */
  async getCandleCount(
    userId: number,
    exchangeId: number,
    symbol: string,
    timeframe: Timeframe
  ): Promise<number> {
    // Tier 1 first
    const exchangeKey = exchangeCandleKey(exchangeId, symbol, timeframe);
    let count = await this.redis.zcard(exchangeKey);

    if (count === 0) {
      // Legacy
      const legacyKey = candleKey(userId, exchangeId, symbol, timeframe);
      count = await this.redis.zcard(legacyKey);
    }

    if (count === 0) {
      // Tier 2
      const overflowKey = userCandleKey(userId, exchangeId, symbol, timeframe);
      count = await this.redis.zcard(overflowKey);
    }

    return count;
  }
}
