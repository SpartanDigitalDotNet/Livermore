import { getDbClient, exchanges } from '@livermore/database';
import { eq } from 'drizzle-orm';
import type { RedisClient } from '@livermore/cache';
import { CoinbaseAdapter, type CoinbaseAdapterOptions } from '@livermore/coinbase-client';
import { logger } from '@livermore/utils';
import type { IExchangeAdapter } from '@livermore/schemas';

/**
 * Connection status stored in Redis for each exchange
 * Phase 28 EXC-04: Connection status tracking
 */
export interface ExchangeConnectionStatus {
  exchangeId: number;
  exchangeName: string;
  connectionState: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  connectedAt: string | null;
  lastHeartbeat: string | null;
  error: string | null;
}

/**
 * Redis key for exchange connection status
 * @example connectionStatusKey(1) // 'exchange:status:1'
 */
export function connectionStatusKey(exchangeId: number): string {
  return `exchange:status:${exchangeId}`;
}

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

    // Initialize connection status as idle
    await this.setConnectionStatus(exchangeId, {
      exchangeId,
      exchangeName: exchange.name,
      connectionState: 'idle',
      connectedAt: null,
      lastHeartbeat: null,
      error: null,
    });

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

    // Wire up connection status tracking
    this.setupConnectionTracking(adapter, exchange.id, exchange.name);

    logger.info(
      { exchangeId: exchange.id, exchangeName: exchange.name },
      'Created Coinbase adapter via factory'
    );

    return adapter;
  }

  /**
   * Set up event listeners to track connection status
   * Phase 28 EXC-04: Connection status tracking
   */
  private setupConnectionTracking(
    adapter: IExchangeAdapter,
    exchangeId: number,
    exchangeName: string
  ): void {
    adapter.on('connected', async () => {
      await this.setConnectionStatus(exchangeId, {
        exchangeId,
        exchangeName,
        connectionState: 'connected',
        connectedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        error: null,
      });
    });

    adapter.on('disconnected', async (reason: string) => {
      await this.setConnectionStatus(exchangeId, {
        exchangeId,
        exchangeName,
        connectionState: 'disconnected',
        connectedAt: null,
        lastHeartbeat: null,
        error: reason || null,
      });
    });

    adapter.on('error', async (error: Error) => {
      const status = await this.getConnectionStatus(exchangeId);
      await this.setConnectionStatus(exchangeId, {
        exchangeId,
        exchangeName,
        connectionState: 'error',
        connectedAt: status?.connectedAt ?? null,
        lastHeartbeat: status?.lastHeartbeat ?? null,
        error: error.message,
      });
    });

    adapter.on('reconnecting', async () => {
      await this.setConnectionStatus(exchangeId, {
        exchangeId,
        exchangeName,
        connectionState: 'connecting',
        connectedAt: null,
        lastHeartbeat: null,
        error: null,
      });
    });
  }

  /**
   * Update heartbeat timestamp (call from adapter on ping/pong)
   */
  async updateHeartbeat(exchangeId: number): Promise<void> {
    const status = await this.getConnectionStatus(exchangeId);
    if (status) {
      status.lastHeartbeat = new Date().toISOString();
      await this.setConnectionStatus(exchangeId, status);
    }
  }

  /**
   * Get current connection status for an exchange
   */
  async getConnectionStatus(exchangeId: number): Promise<ExchangeConnectionStatus | null> {
    const key = connectionStatusKey(exchangeId);
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as ExchangeConnectionStatus;
  }

  /**
   * Set connection status in Redis
   */
  private async setConnectionStatus(
    exchangeId: number,
    status: ExchangeConnectionStatus
  ): Promise<void> {
    const key = connectionStatusKey(exchangeId);
    await this.redis.set(key, JSON.stringify(status));
    logger.debug({ exchangeId, state: status.connectionState }, 'Updated exchange connection status');
  }
}
