import { getDbClient, exchanges } from '@livermore/database';
import { eq } from 'drizzle-orm';
import type { RedisClient } from '@livermore/cache';
import { CoinbaseAdapter, type CoinbaseAdapterOptions } from '@livermore/exchange-core';
import { logger } from '@livermore/utils';
import type { IExchangeAdapter } from '@livermore/schemas';

/**
 * Exchange adapter configuration from database lookup
 */
interface ExchangeConfig {
  id: number;
  name: string;
  displayName: string;
  wsUrl: string | null;
  restUrl: string | null;
  supportedTimeframes: string[];
}

/**
 * Configuration for creating an adapter via factory
 */
export interface AdapterFactoryConfig {
  /** Coinbase API key ID (from env or secrets) */
  apiKeyId: string;
  /** Coinbase private key PEM (from env or secrets) */
  privateKeyPem: string;
  /** Redis client for caching and pub/sub */
  redis: RedisClient;
  /** User ID for cache operations */
  userId: number;
}

/**
 * Exchange Adapter Factory
 *
 * Creates exchange adapters based on exchange configuration from database.
 * Phase 28 EXC-03: Factory instantiates correct adapter by exchange type.
 *
 * Currently supports:
 * - coinbase: CoinbaseAdapter (Coinbase Advanced Trade WebSocket)
 *
 * Future:
 * - binance: BinanceAdapter
 * - binanceus: BinanceUSAdapter
 */
export class ExchangeAdapterFactory {
  private db = getDbClient();
  private redis: RedisClient;

  constructor(private config: AdapterFactoryConfig) {
    this.redis = config.redis;
  }

  /**
   * Create an adapter for the specified exchange
   *
   * @param exchangeId - Exchange ID from database
   * @returns Exchange adapter instance
   * @throws Error if exchange not found or unsupported
   */
  async create(exchangeId: number): Promise<IExchangeAdapter> {
    // Look up exchange from database
    const [exchange] = await this.db
      .select({
        id: exchanges.id,
        name: exchanges.name,
        displayName: exchanges.displayName,
        wsUrl: exchanges.wsUrl,
        restUrl: exchanges.restUrl,
        supportedTimeframes: exchanges.supportedTimeframes,
        isActive: exchanges.isActive,
      })
      .from(exchanges)
      .where(eq(exchanges.id, exchangeId))
      .limit(1);

    if (!exchange) {
      throw new Error(`Exchange with ID ${exchangeId} not found`);
    }

    if (!exchange.isActive) {
      throw new Error(`Exchange ${exchange.name} (ID: ${exchangeId}) is not active`);
    }

    const exchangeConfig: ExchangeConfig = {
      id: exchange.id,
      name: exchange.name,
      displayName: exchange.displayName,
      wsUrl: exchange.wsUrl,
      restUrl: exchange.restUrl,
      supportedTimeframes: exchange.supportedTimeframes as string[],
    };

    return this.createAdapterByType(exchangeConfig);
  }

  /**
   * Create the correct adapter type based on exchange name
   */
  private createAdapterByType(exchange: ExchangeConfig): IExchangeAdapter {
    switch (exchange.name) {
      case 'coinbase':
        return this.createCoinbaseAdapter(exchange);

      // Future: Add other exchanges
      // case 'binance':
      //   return this.createBinanceAdapter(exchange);
      // case 'binanceus':
      //   return this.createBinanceUSAdapter(exchange);

      default:
        throw new Error(`Unsupported exchange type: ${exchange.name}. Supported: coinbase`);
    }
  }

  /**
   * Create a Coinbase adapter instance
   */
  private createCoinbaseAdapter(exchange: ExchangeConfig): CoinbaseAdapter {
    const config: CoinbaseAdapterOptions = {
      apiKeyId: this.config.apiKeyId,
      privateKeyPem: this.config.privateKeyPem,
      redis: this.config.redis,
      userId: this.config.userId,
      exchangeId: exchange.id,
    };

    const adapter = new CoinbaseAdapter(config);

    logger.info(
      { exchangeId: exchange.id, exchangeName: exchange.name },
      'Created Coinbase adapter via factory'
    );

    return adapter;
  }

}
