import { TickerSchema, type Ticker, HARDCODED_CONFIG } from '@livermore/schemas';
import { tickerKey, tickerChannel } from '../keys';
import type { RedisClient } from '../client';

/**
 * Ticker caching strategy using Redis strings
 *
 * Tickers are stored as JSON strings with short TTL (60 seconds)
 * for near-real-time price updates.
 * All tickers are scoped by userId and exchangeId for multi-user support.
 */
export class TickerCacheStrategy {
  constructor(private redis: RedisClient) {}

  /**
   * Set ticker data in cache
   */
  async setTicker(userId: number, exchangeId: number, ticker: Ticker): Promise<void> {
    // Validate with Zod
    const validated = TickerSchema.parse(ticker);

    const key = tickerKey(userId, exchangeId, validated.symbol);

    // Store as JSON string
    await this.redis.setex(
      key,
      HARDCODED_CONFIG.cache.tickerTtlSeconds,
      JSON.stringify(validated)
    );
  }

  /**
   * Get ticker data from cache
   */
  async getTicker(userId: number, exchangeId: number, symbol: string): Promise<Ticker | null> {
    const key = tickerKey(userId, exchangeId, symbol);

    const data = await this.redis.get(key);

    if (!data) return null;

    return TickerSchema.parse(JSON.parse(data));
  }

  /**
   * Get multiple tickers at once
   */
  async getTickers(userId: number, exchangeId: number, symbols: string[]): Promise<Map<string, Ticker>> {
    if (symbols.length === 0) return new Map();

    const keys = symbols.map((symbol) => tickerKey(userId, exchangeId, symbol));

    // Use individual GET calls for Azure Redis Cluster compatibility (avoids CROSSSLOT errors)
    const values = await Promise.all(keys.map((key) => this.redis.get(key)));

    const tickers = new Map<string, Ticker>();

    for (let i = 0; i < symbols.length; i++) {
      const value = values[i];
      if (value) {
        try {
          const ticker = TickerSchema.parse(JSON.parse(value));
          tickers.set(symbols[i], ticker);
        } catch (error) {
          // Skip invalid data
          continue;
        }
      }
    }

    return tickers;
  }

  /**
   * Publish ticker update to Redis pub/sub
   */
  async publishUpdate(userId: number, exchangeId: number, ticker: Ticker): Promise<void> {
    const channel = tickerChannel(userId, exchangeId, ticker.symbol);
    await this.redis.publish(channel, JSON.stringify(ticker));
  }

  /**
   * Delete ticker from cache
   */
  async deleteTicker(userId: number, exchangeId: number, symbol: string): Promise<void> {
    const key = tickerKey(userId, exchangeId, symbol);
    await this.redis.del(key);
  }

  /**
   * Check if ticker exists in cache
   */
  async hasTicker(userId: number, exchangeId: number, symbol: string): Promise<boolean> {
    const key = tickerKey(userId, exchangeId, symbol);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
}
