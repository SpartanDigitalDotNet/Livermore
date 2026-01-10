import { CoinbaseWebSocketClient, type CoinbaseWSMessage } from '@livermore/coinbase-client';
import { getRedisClient, TickerCacheStrategy } from '@livermore/cache';
import { logger } from '@livermore/utils';
import type { Ticker } from '@livermore/schemas';

/**
 * Coinbase WebSocket data ingestion service
 *
 * Connects to Coinbase WebSocket feed, processes incoming messages,
 * caches updates in Redis, and persists to PostgreSQL
 */
export class CoinbaseWebSocketService {
  private wsClient: CoinbaseWebSocketClient;
  private tickerCache: TickerCacheStrategy;
  private redis = getRedisClient();

  // Temporary: hardcode test user and exchange IDs
  // TODO: Replace with actual user/exchange from database seed
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  constructor(apiKeyId: string, privateKeyPem: string) {
    this.wsClient = new CoinbaseWebSocketClient(apiKeyId, privateKeyPem);
    this.tickerCache = new TickerCacheStrategy(this.redis);

    // Register message handler
    this.wsClient.onMessage(this.handleMessage.bind(this));
  }

  /**
   * Start WebSocket connection and subscribe to products
   */
  async start(products: string[]): Promise<void> {
    logger.info({ products }, 'Starting Coinbase WebSocket service');

    await this.wsClient.connect();

    // Subscribe to ticker and level2 channels
    this.wsClient.subscribe(['ticker', 'level2'], products);

    logger.info('Coinbase WebSocket service started successfully');
  }

  /**
   * Stop WebSocket connection
   */
  stop(): void {
    logger.info('Stopping Coinbase WebSocket service');
    this.wsClient.close();
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(message: CoinbaseWSMessage): Promise<void> {
    try {
      if (message.channel === 'ticker') {
        await this.handleTicker(message);
      } else if (message.channel === 'l2_data') {
        await this.handleOrderbookUpdate(message);
      }
      // Ignore other message types (subscriptions handled by client)
    } catch (error) {
      logger.error({ error, message }, 'Error handling WebSocket message');
    }
  }

  /**
   * Handle ticker updates
   */
  private async handleTicker(message: CoinbaseWSMessage & { channel: 'ticker' }): Promise<void> {
    for (const event of message.events) {
      if (event.type !== 'update') continue;

      for (const tickerData of event.tickers) {
        const price = parseFloat(tickerData.price);
        const changePercent24h = parseFloat(tickerData.price_percent_chg_24_h);
        // Calculate absolute change from percentage: change = price - (price / (1 + pct/100))
        const change24h = price - (price / (1 + changePercent24h / 100));

        const ticker: Ticker = {
          symbol: tickerData.product_id,
          price,
          change24h,
          changePercent24h,
          volume24h: parseFloat(tickerData.volume_24_h),
          low24h: parseFloat(tickerData.low_24_h),
          high24h: parseFloat(tickerData.high_24_h),
          timestamp: new Date(message.timestamp).getTime(),
        };

        // Cache ticker in Redis
        await this.tickerCache.setTicker(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, ticker);

        // Publish update via Redis pub/sub
        await this.tickerCache.publishUpdate(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, ticker);

        logger.debug({ ticker }, 'Processed ticker update');
      }
    }
  }

  /**
   * Handle orderbook updates
   */
  private async handleOrderbookUpdate(
    message: CoinbaseWSMessage & { channel: 'l2_data' }
  ): Promise<void> {
    for (const event of message.events) {
      logger.debug(
        { product: event.product_id, updateCount: event.updates.length, type: event.type },
        'Orderbook update received'
      );
    }

    // TODO: Implement orderbook cache strategy and persistence
    // For now, just log the update
  }
}
