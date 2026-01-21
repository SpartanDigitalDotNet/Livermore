import { CoinbaseWebSocketClient, type CoinbaseWSMessage } from '@livermore/coinbase-client';
import { getRedisClient, TickerCacheStrategy, CandleCacheStrategy } from '@livermore/cache';
import { logger, getCandleTimestamp } from '@livermore/utils';
import type { Ticker, Timeframe, Candle } from '@livermore/schemas';

/**
 * Candle state for local aggregation from ticker events
 */
interface CandleState {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

/**
 * Candle data emitted on candle close
 */
export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Coinbase WebSocket data ingestion service
 *
 * Connects to Coinbase WebSocket feed, processes incoming messages,
 * caches updates in Redis, and persists to PostgreSQL
 */
export class CoinbaseWebSocketService {
  private wsClient: CoinbaseWebSocketClient;
  private tickerCache: TickerCacheStrategy;
  private candleCache: CandleCacheStrategy;
  private redis = getRedisClient();

  // Temporary: hardcode test user and exchange IDs
  // TODO: Replace with actual user/exchange from database seed
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  // Candle aggregation from ticker events (true event-driven)
  private candles: Map<string, CandleState> = new Map(); // key: "symbol"
  private candleCloseCallbacks: ((symbol: string, timeframe: Timeframe, candle: CandleData) => void)[] = [];

  constructor(apiKeyId: string, privateKeyPem: string) {
    this.wsClient = new CoinbaseWebSocketClient(apiKeyId, privateKeyPem);
    this.tickerCache = new TickerCacheStrategy(this.redis);
    this.candleCache = new CandleCacheStrategy(this.redis);

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
   * Register callback for candle close events
   * Called when a 1m candle closes (minute boundary crossed)
   */
  onCandleClose(callback: (symbol: string, timeframe: Timeframe, candle: CandleData) => void): void {
    this.candleCloseCallbacks.push(callback);
  }

  /**
   * Aggregate ticker event into local 1m candle
   * Emits candle close event when minute boundary is crossed
   */
  private async aggregateTickerToCandle(symbol: string, price: number, timestamp: number): Promise<void> {
    const timeframe: Timeframe = '1m';
    const candleTime = getCandleTimestamp(timestamp, timeframe);

    const existing = this.candles.get(symbol);

    if (!existing || candleTime > existing.timestamp) {
      // Close previous candle if exists and not already closed
      if (existing && !existing.isClosed) {
        existing.isClosed = true;
        await this.emitCandleClose(symbol, timeframe, existing);
      }

      // Start new candle
      this.candles.set(symbol, {
        timestamp: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0, // Volume tracked separately via 24h volume deltas
        isClosed: false,
      });
    } else {
      // Update existing candle
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
    }
  }

  /**
   * Emit candle close event to all registered callbacks
   * Also saves the candle to cache so 429 fallbacks have fresh data
   */
  private async emitCandleClose(symbol: string, timeframe: Timeframe, candle: CandleState): Promise<void> {
    logger.info(
      { symbol, timeframe, timestamp: new Date(candle.timestamp).toISOString(), ohlc: `${candle.open}/${candle.high}/${candle.low}/${candle.close}` },
      'Candle closed'
    );

    // Save candle to cache BEFORE emitting event
    // This ensures indicator service fallback has fresh data on 429 errors
    const cacheCandle: Candle = {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      symbol,
      timeframe,
    };

    try {
      await this.candleCache.addCandles(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, [cacheCandle]);
      logger.debug({ symbol, timeframe, timestamp: new Date(candle.timestamp).toISOString() }, 'WebSocket candle saved to cache');
    } catch (error) {
      logger.error({ error, symbol, timeframe }, 'Failed to save WebSocket candle to cache');
    }

    const candleData: CandleData = {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    };

    for (const callback of this.candleCloseCallbacks) {
      try {
        callback(symbol, timeframe, candleData);
      } catch (error) {
        logger.error({ error, symbol, timeframe }, 'Error in candle close callback');
      }
    }
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
        const timestamp = new Date(message.timestamp).getTime();
        const changePercent24h = parseFloat(tickerData.price_percent_chg_24_h);
        // Calculate absolute change from percentage: change = price - (price / (1 + pct/100))
        const change24h = price - (price / (1 + changePercent24h / 100));

        // Aggregate ticker into 1m candle (event-driven candle building)
        await this.aggregateTickerToCandle(tickerData.product_id, price, timestamp);

        const ticker: Ticker = {
          symbol: tickerData.product_id,
          price,
          change24h,
          changePercent24h,
          volume24h: parseFloat(tickerData.volume_24_h),
          low24h: parseFloat(tickerData.low_24_h),
          high24h: parseFloat(tickerData.high_24_h),
          timestamp,
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
