import { OrderbookSchema, type Orderbook, HARDCODED_CONFIG } from '@livermore/schemas';
import { orderbookKey, orderbookChannel } from '../keys';
import type { RedisClient } from '../client';

/**
 * Orderbook caching strategy using Redis strings
 *
 * Orderbooks are stored as JSON with short TTL (30 seconds)
 * since they change frequently.
 * All orderbooks are scoped by userId and exchangeId for multi-user support.
 */
export class OrderbookCacheStrategy {
  constructor(private redis: RedisClient) {}

  /**
   * Set orderbook snapshot in cache
   */
  async setOrderbook(userId: number, exchangeId: number, orderbook: Orderbook): Promise<void> {
    // Validate with Zod
    const validated = OrderbookSchema.parse(orderbook);

    const key = orderbookKey(userId, exchangeId, validated.symbol);

    // Store as JSON string with TTL
    await this.redis.setex(
      key,
      HARDCODED_CONFIG.cache.orderbookTtlSeconds,
      JSON.stringify(validated)
    );
  }

  /**
   * Get orderbook snapshot from cache
   */
  async getOrderbook(userId: number, exchangeId: number, symbol: string): Promise<Orderbook | null> {
    const key = orderbookKey(userId, exchangeId, symbol);

    const data = await this.redis.get(key);

    if (!data) return null;

    return OrderbookSchema.parse(JSON.parse(data));
  }

  /**
   * Get multiple orderbooks at once
   */
  async getOrderbooks(userId: number, exchangeId: number, symbols: string[]): Promise<Map<string, Orderbook>> {
    if (symbols.length === 0) return new Map();

    const keys = symbols.map((symbol) => orderbookKey(userId, exchangeId, symbol));

    // Use individual GET calls for Azure Redis Cluster compatibility (avoids CROSSSLOT errors)
    const values = await Promise.all(keys.map((key) => this.redis.get(key)));

    const orderbooks = new Map<string, Orderbook>();

    for (let i = 0; i < symbols.length; i++) {
      const value = values[i];
      if (value) {
        try {
          const orderbook = OrderbookSchema.parse(JSON.parse(value));
          orderbooks.set(symbols[i], orderbook);
        } catch (error) {
          // Skip invalid data
          continue;
        }
      }
    }

    return orderbooks;
  }

  /**
   * Publish orderbook update to Redis pub/sub
   */
  async publishUpdate(userId: number, exchangeId: number, orderbook: Orderbook): Promise<void> {
    const channel = orderbookChannel(userId, exchangeId, orderbook.symbol);
    await this.redis.publish(channel, JSON.stringify(orderbook));
  }

  /**
   * Delete orderbook from cache
   */
  async deleteOrderbook(userId: number, exchangeId: number, symbol: string): Promise<void> {
    const key = orderbookKey(userId, exchangeId, symbol);
    await this.redis.del(key);
  }

  /**
   * Check if orderbook exists in cache
   */
  async hasOrderbook(userId: number, exchangeId: number, symbol: string): Promise<boolean> {
    const key = orderbookKey(userId, exchangeId, symbol);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
}
