/**
 * Binance WebSocket Adapter
 *
 * Connects to Binance WebSocket for real-time kline (candle) and miniTicker data.
 * Supports both binance.com and binance.us via configurable wsUrl.
 *
 * Key differences from CoinbaseAdapter:
 * - No auth required for market data WebSocket (public endpoint)
 * - Candle close detection via `x` field (boolean), not timestamp comparison
 * - No sequence tracking (Binance combined streams don't have sequence numbers)
 * - Native 1m kline streams available (no trade aggregation needed)
 * - Dynamic subscribe/unsubscribe via JSON method frames
 *
 * Extends BaseExchangeAdapter for standardized event emission and reconnection logic.
 */
import WebSocket from 'ws';
import { BaseExchangeAdapter } from './base-adapter';
import {
  CandleCacheStrategy,
  candleCloseChannel,
  exchangeCandleCloseChannel,
  TickerCacheStrategy,
  type RedisClient,
} from '@livermore/cache';
import type { Timeframe, UnifiedCandle, Ticker, IRestClient } from '@livermore/schemas';
import { logger } from '@livermore/utils';

// ============================================
// Binance WebSocket Message Interfaces
// ============================================

interface BinanceKlineEvent {
  e: 'kline';
  E: number; // Event time (ms)
  s: string; // Symbol
  k: BinanceKline;
}

interface BinanceKline {
  t: number; // Kline start time (ms)
  T: number; // Kline close time (ms)
  s: string; // Symbol
  i: string; // Interval
  o: string; // Open price
  c: string; // Close price
  h: string; // High price
  l: string; // Low price
  v: string; // Base asset volume
  x: boolean; // Is this kline closed?
}

interface BinanceMiniTickerEvent {
  e: '24hrMiniTicker';
  E: number; // Event time (ms)
  s: string; // Symbol
  c: string; // Close price
  o: string; // Open price
  h: string; // 24h high
  l: string; // 24h low
  v: string; // Total traded base asset volume
  q: string; // Total traded quote asset volume
}

/**
 * Combined stream wrapper message format
 * All messages from the /ws endpoint arrive in this wrapper
 */
interface BinanceCombinedMessage {
  stream: string;
  data: BinanceKlineEvent | BinanceMiniTickerEvent;
}

/**
 * Subscription response from Binance
 */
interface BinanceSubscriptionResponse {
  result: null;
  id: number;
}

/**
 * Error response from Binance
 */
interface BinanceErrorResponse {
  error: {
    code: number;
    msg: string;
  };
  id: number;
}

// ============================================
// Configuration
// ============================================

/**
 * Configuration options for BinanceAdapter
 */
export interface BinanceAdapterOptions {
  /** Binance WebSocket base URL (from exchanges table wsUrl column) */
  wsUrl: string; // e.g., 'wss://stream.binance.com:9443' or 'wss://stream.binance.us:9443'
  /** Redis client for caching and pub/sub */
  redis: RedisClient;
  /** User ID for cache key scoping */
  userId: number;
  /** Exchange ID (numeric) for cache key scoping */
  exchangeId: number;
  /** Exchange name for logging and UnifiedCandle.exchange field */
  exchangeName: string; // 'binance' or 'binance_us'
  /** Optional REST client for reconnection backfill */
  restClient?: IRestClient;
}

// ============================================
// BinanceAdapter
// ============================================

/**
 * BinanceAdapter - Exchange adapter for Binance WebSocket API
 *
 * Subscribes to kline and miniTicker streams for real-time candle and ticker data.
 * Handles connection lifecycle, automatic reconnection, watchdog timer, and
 * dynamic subscription management via SUBSCRIBE/UNSUBSCRIBE method frames.
 *
 * Events emitted:
 * - 'connected' - WebSocket connection established
 * - 'disconnected' - WebSocket connection closed (includes reason)
 * - 'error' - Error occurred
 * - 'reconnecting' - Attempting to reconnect (includes attempt number, delay)
 * - 'candle:close' - Candle closed (includes UnifiedCandle)
 */
export class BinanceAdapter extends BaseExchangeAdapter {
  /** Exchange identifier for logging (used by BaseExchangeAdapter) */
  protected readonly exchangeId: string;

  /** Binance WebSocket base URL (injected, not hardcoded) */
  private readonly wsUrl: string;

  /** Exchange name for UnifiedCandle.exchange field */
  private readonly exchangeName: string;

  /** WebSocket connection instance */
  private ws: WebSocket | null = null;

  /** Cache strategy for candle storage */
  private candleCache: CandleCacheStrategy;

  /** Cache strategy for ticker storage and pub/sub */
  private tickerCache: TickerCacheStrategy;

  /** Redis client for pub/sub */
  private redis: RedisClient;

  /** User ID for cache key scoping */
  private userId: number;

  /** Exchange ID (numeric) for cache key scoping */
  private exchangeIdNum: number;

  /** Optional REST client for backfill after reconnection */
  private restClient?: IRestClient;

  /** Currently subscribed symbols */
  private subscribedSymbols: string[] = [];

  /** Currently subscribed timeframe */
  private subscribedTimeframe: Timeframe = '5m';

  /** Flag to prevent reconnection on intentional disconnect */
  private isIntentionalClose = false;

  /** Watchdog timer to detect silent disconnections */
  private watchdogTimeout: NodeJS.Timeout | null = null;

  /** Watchdog interval - force reconnect if no message received within this time */
  private readonly WATCHDOG_INTERVAL_MS = 30_000; // 30 seconds

  /** Monotonically incrementing request ID for SUBSCRIBE/UNSUBSCRIBE messages */
  private requestId = 0;

  /** Backfill threshold - only backfill if gap is greater than this (5 minutes) */
  private readonly BACKFILL_THRESHOLD_MS = 5 * 60 * 1000;

  constructor(options: BinanceAdapterOptions) {
    super();
    this.wsUrl = options.wsUrl;
    this.exchangeName = options.exchangeName;
    this.exchangeId = options.exchangeName; // BaseExchangeAdapter uses this for logging
    this.candleCache = new CandleCacheStrategy(options.redis);
    this.tickerCache = new TickerCacheStrategy(options.redis);
    this.redis = options.redis;
    this.userId = options.userId;
    this.exchangeIdNum = options.exchangeId;
    this.restClient = options.restClient;
  }

  /**
   * Establish connection to Binance WebSocket
   * Connects to the bare /ws endpoint for dynamic subscription management.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isIntentionalClose = false;
      this.ws = new WebSocket(`${this.wsUrl}/ws`);

      this.ws.on('open', () => {
        logger.info(
          { exchangeId: this.exchangeName },
          'Connected to Binance WebSocket'
        );
        this.resetReconnectAttempts();
        this.resetWatchdog();

        // Handle post-connection setup (resubscribe, backfill)
        this.onConnected().catch((err) => {
          logger.error({ err }, 'Error in post-connection setup');
        });

        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        logger.error(
          { error, exchangeId: this.exchangeName },
          'WebSocket error'
        );

        // Only emit error if there are listeners (prevents unhandled error crash)
        if (this.listenerCount('error') > 0) {
          this.emit('error', error as Error);
        }

        // Reject only if connection was never established
        if (!this.isConnected()) {
          reject(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(
          {
            code,
            reason: reason.toString(),
            exchangeId: this.exchangeName,
          },
          'WebSocket closed'
        );
        this.stopWatchdog();
        this.emit('disconnected', reason.toString() || `Code: ${code}`);
        if (!this.isIntentionalClose) {
          this.handleReconnect();
        }
      });
    });
  }

  /**
   * Gracefully close the WebSocket connection
   * Sets intentional close flag to prevent auto-reconnection.
   */
  disconnect(): void {
    this.stopWatchdog();
    this.isIntentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.info(
      { exchangeId: this.exchangeName },
      'Disconnected from Binance WebSocket'
    );
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to kline and miniTicker streams for specified symbols
   * Sends SUBSCRIBE method frame over existing WebSocket connection.
   */
  subscribe(symbols: string[], timeframe: Timeframe): void {
    if (!this.isConnected()) {
      throw new Error('Cannot subscribe: WebSocket not connected');
    }

    this.subscribedSymbols = symbols;
    this.subscribedTimeframe = timeframe;

    // Build stream names: ["btcusdt@kline_5m", "ethusdt@kline_5m"]
    const klineStreams = symbols.map(
      (s) => `${s.toLowerCase()}@kline_${timeframe}`
    );
    const tickerStreams = symbols.map(
      (s) => `${s.toLowerCase()}@miniTicker`
    );
    const allStreams = [...klineStreams, ...tickerStreams];

    this.requestId++;
    const msg = {
      method: 'SUBSCRIBE',
      params: allStreams,
      id: this.requestId,
    };

    this.ws!.send(JSON.stringify(msg));
    logger.info(
      {
        symbols: symbols.length,
        timeframe,
        streams: allStreams.length,
      },
      'Subscribed to Binance kline and miniTicker streams'
    );
  }

  /**
   * Unsubscribe from kline and miniTicker streams for specified symbols
   * Sends UNSUBSCRIBE method frame over existing WebSocket connection.
   */
  unsubscribe(symbols: string[], timeframe: Timeframe): void {
    if (!this.isConnected()) return;

    // Build stream names to unsubscribe
    const klineStreams = symbols.map(
      (s) => `${s.toLowerCase()}@kline_${timeframe}`
    );
    const tickerStreams = symbols.map(
      (s) => `${s.toLowerCase()}@miniTicker`
    );
    const allStreams = [...klineStreams, ...tickerStreams];

    this.requestId++;
    const msg = {
      method: 'UNSUBSCRIBE',
      params: allStreams,
      id: this.requestId,
    };

    this.ws!.send(JSON.stringify(msg));
    this.subscribedSymbols = this.subscribedSymbols.filter(
      (s) => !symbols.includes(s)
    );
    logger.info(
      { symbols: symbols.length, timeframe },
      'Unsubscribed from Binance streams'
    );
  }

  // ============================================
  // Message Handling
  // ============================================

  /**
   * Handle incoming WebSocket messages
   * Routes messages to appropriate handlers based on content type.
   *
   * Message types:
   * 1. Combined stream message (has `stream` and `data` fields) -> route by stream name
   * 2. Subscription response (has `result` and `id` fields) -> log confirmation
   * 3. Error message (has `error` field) -> log error
   */
  private handleMessage(data: WebSocket.Data): void {
    // Don't process messages after intentional disconnect
    if (this.isIntentionalClose) return;

    this.resetWatchdog();

    try {
      const msg = JSON.parse(data.toString());

      // Subscription response
      if ('id' in msg && 'result' in msg) {
        const resp = msg as BinanceSubscriptionResponse;
        logger.debug(
          { id: resp.id, result: resp.result },
          'Binance subscription response'
        );
        return;
      }

      // Combined stream format (used by /stream?streams= endpoint)
      if ('stream' in msg && 'data' in msg) {
        const combined = msg as BinanceCombinedMessage;
        const streamName = combined.stream;

        if (streamName.includes('@kline_')) {
          this.handleKlineMessage(combined.data as BinanceKlineEvent);
          return;
        }

        if (streamName.includes('@miniTicker')) {
          this.handleMiniTickerMessage(
            combined.data as BinanceMiniTickerEvent
          );
          return;
        }

        logger.warn({ stream: streamName }, 'Unknown Binance stream type');
        return;
      }

      // Raw stream format (used by /ws endpoint with SUBSCRIBE method)
      if ('e' in msg) {
        if (msg.e === 'kline') {
          this.handleKlineMessage(msg as BinanceKlineEvent);
          return;
        }

        if (msg.e === '24hrMiniTicker') {
          this.handleMiniTickerMessage(msg as BinanceMiniTickerEvent);
          return;
        }

        logger.warn({ eventType: msg.e }, 'Unknown Binance raw event type');
        return;
      }

      // Error response
      if ('error' in msg) {
        const errResp = msg as BinanceErrorResponse;
        logger.error(
          { error: errResp.error, id: errResp.id },
          'Binance WebSocket error message'
        );
        return;
      }

      // Unknown message format
      logger.debug({ keys: Object.keys(msg) }, 'Unknown Binance message format');
    } catch (error) {
      logger.error({ error }, 'Failed to parse Binance WebSocket message');
    }
  }

  /**
   * Handle kline (candlestick) message
   * Normalizes to UnifiedCandle and triggers onCandleClose when kline is finalized.
   *
   * Key: Binance sends x=true when the kline is closed (finalized).
   * This is much cleaner than Coinbase's timestamp-comparison approach.
   */
  private handleKlineMessage(event: BinanceKlineEvent): void {
    const kline = event.k;
    const symbol = event.s;
    const timeframe = kline.i as Timeframe;

    // Normalize to UnifiedCandle
    const candle = this.normalizeCandle(kline, symbol, timeframe);

    // When x is true, this kline is closed (finalized)
    if (kline.x) {
      // Fire and forget to avoid blocking message processing
      this.onCandleClose(candle).catch((err) => {
        logger.error({ err, symbol, timeframe }, 'Error processing candle close');
      });
    }

    // Always write latest data to cache (addCandleIfNewer handles versioning)
    this.candleCache
      .addCandleIfNewer(this.userId, this.exchangeIdNum, candle)
      .catch((error) => {
        logger.error(
          { error, symbol, timestamp: candle.timestamp },
          'Failed to write candle to cache'
        );
      });
  }

  /**
   * Normalize Binance kline to UnifiedCandle format
   */
  private normalizeCandle(
    kline: BinanceKline,
    symbol: string,
    timeframe: Timeframe
  ): UnifiedCandle {
    return {
      timestamp: kline.t, // Already in milliseconds
      open: parseFloat(kline.o),
      high: parseFloat(kline.h),
      low: parseFloat(kline.l),
      close: parseFloat(kline.c),
      volume: parseFloat(kline.v),
      symbol, // Native Binance format (e.g., BTCUSDT)
      timeframe,
      exchange: this.exchangeName, // 'binance' or 'binance_us'
    };
  }

  /**
   * Handle candle close event
   * Emits event, publishes to Redis pub/sub, writes to cache.
   */
  private async onCandleClose(candle: UnifiedCandle): Promise<void> {
    logger.info(
      {
        symbol: candle.symbol,
        timestamp: new Date(candle.timestamp).toISOString(),
        timeframe: candle.timeframe,
        event: 'candle_close_emitted',
      },
      'Candle closed'
    );

    // Emit typed event for local subscribers
    this.emit('candle:close', candle);

    // Publish to Redis pub/sub for distributed subscribers (indicator service)
    try {
      // Exchange-scoped channel (shared across users)
      const exchangeChannel = exchangeCandleCloseChannel(
        this.exchangeIdNum,
        candle.symbol,
        candle.timeframe
      );
      await this.redis.publish(exchangeChannel, JSON.stringify(candle));

      // Legacy user-scoped channel (backward compatibility during migration)
      const userChannel = candleCloseChannel(
        this.userId,
        this.exchangeIdNum,
        candle.symbol,
        candle.timeframe
      );
      await this.redis.publish(userChannel, JSON.stringify(candle));
    } catch (error) {
      logger.error(
        { error, symbol: candle.symbol },
        'Failed to publish candle:close to Redis'
      );
    }
  }

  /**
   * Handle miniTicker message
   * Transforms Binance 24hr mini ticker to Livermore Ticker format.
   */
  private handleMiniTickerMessage(event: BinanceMiniTickerEvent): void {
    const closePrice = parseFloat(event.c);
    const openPrice = parseFloat(event.o);

    const ticker: Ticker = {
      symbol: event.s,
      price: closePrice,
      change24h: closePrice - openPrice,
      changePercent24h:
        openPrice !== 0
          ? ((closePrice - openPrice) / openPrice) * 100
          : 0,
      volume24h: parseFloat(event.v),
      low24h: parseFloat(event.l),
      high24h: parseFloat(event.h),
      timestamp: event.E,
    };

    // Cache and publish - fire and forget
    this.tickerCache.setTicker(this.exchangeIdNum, ticker).catch((error) => {
      logger.error({ error, symbol: ticker.symbol }, 'Failed to cache ticker');
    });

    this.tickerCache
      .publishUpdate(this.exchangeIdNum, ticker)
      .catch((error) => {
        logger.error(
          { error, symbol: ticker.symbol },
          'Failed to publish ticker update'
        );
      });
  }

  // ============================================
  // Watchdog Timer
  // ============================================

  /**
   * Reset watchdog timer - call on every message
   * If no message received within WATCHDOG_INTERVAL_MS, force reconnect.
   */
  private resetWatchdog(): void {
    if (this.watchdogTimeout) {
      clearTimeout(this.watchdogTimeout);
    }

    this.watchdogTimeout = setTimeout(() => {
      logger.warn(
        {
          exchangeId: this.exchangeName,
          intervalMs: this.WATCHDOG_INTERVAL_MS,
        },
        'Watchdog timeout - no message received, forcing reconnect'
      );
      this.forceReconnect();
    }, this.WATCHDOG_INTERVAL_MS);
  }

  /**
   * Stop watchdog timer - call on intentional disconnect
   */
  private stopWatchdog(): void {
    if (this.watchdogTimeout) {
      clearTimeout(this.watchdogTimeout);
      this.watchdogTimeout = null;
    }
  }

  /**
   * Force reconnection due to watchdog timeout or other issue
   * Respects isIntentionalClose flag to prevent reconnect after pause.
   */
  private forceReconnect(): void {
    if (this.isIntentionalClose) {
      logger.debug(
        { exchangeId: this.exchangeName },
        'Skipping reconnect - intentional close'
      );
      return;
    }

    logger.info({ exchangeId: this.exchangeName }, 'Forcing reconnect');

    // Close existing connection without triggering normal disconnect
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this.stopWatchdog();

    // Trigger reconnect via base class
    this.handleReconnect();
  }

  // ============================================
  // Reconnection & Backfill
  // ============================================

  /**
   * Called after successful connection/reconnection
   * Resubscribes to channels and checks for backfill needs.
   */
  private async onConnected(): Promise<void> {
    if (this.subscribedSymbols.length > 0) {
      this.subscribe(this.subscribedSymbols, this.subscribedTimeframe);

      // Check for gaps and backfill if needed (only on reconnection)
      if (this.restClient && this.reconnectAttempts > 0) {
        await this.checkAndBackfill();
      }
    }
  }

  /**
   * Check for data gaps and backfill from REST API if needed
   * Called after reconnection to fill any gaps that occurred during disconnect.
   * THROTTLED: 100ms delay between REST calls to avoid 429 rate limiting.
   */
  private async checkAndBackfill(): Promise<void> {
    if (!this.restClient || this.subscribedSymbols.length === 0) {
      logger.debug('No REST client or no subscribed symbols - skipping backfill');
      return;
    }

    const now = Date.now();
    const symbolsNeedingBackfill: Array<{
      symbol: string;
      lastTimestamp: number;
    }> = [];

    // First pass: identify which symbols need backfill (no REST calls yet)
    for (const symbol of this.subscribedSymbols) {
      try {
        const latestCached = await this.candleCache.getLatestCandle(
          this.userId,
          this.exchangeIdNum,
          symbol,
          this.subscribedTimeframe
        );

        const lastTimestamp = latestCached?.timestamp ?? 0;
        const gapMs = now - lastTimestamp;

        if (gapMs > this.BACKFILL_THRESHOLD_MS) {
          symbolsNeedingBackfill.push({ symbol, lastTimestamp });
        }
      } catch (error) {
        logger.error({ error, symbol }, 'Error checking symbol for backfill');
      }
    }

    if (symbolsNeedingBackfill.length === 0) {
      logger.debug('No symbols need backfill');
      return;
    }

    logger.info(
      { count: symbolsNeedingBackfill.length },
      'Starting throttled backfill for symbols with gaps'
    );

    // Second pass: backfill with throttling (100ms between calls)
    for (const { symbol, lastTimestamp } of symbolsNeedingBackfill) {
      try {
        await this.backfillSymbol(symbol, lastTimestamp, now);
        // Throttle: wait 100ms between REST calls to avoid 429
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        logger.error({ error, symbol }, 'Error backfilling symbol');
      }
    }

    logger.info(
      { count: symbolsNeedingBackfill.length },
      'Backfill complete'
    );
  }

  /**
   * Backfill candles for a single symbol from REST API
   */
  private async backfillSymbol(
    symbol: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<void> {
    if (!this.restClient) return;

    try {
      const candles = await this.restClient.getCandles(
        symbol,
        this.subscribedTimeframe,
        fromTimestamp,
        toTimestamp
      );

      logger.info(
        {
          symbol,
          fromTimestamp: new Date(fromTimestamp).toISOString(),
          candleCount: candles.length,
        },
        'Fetched candles from REST API for backfill'
      );

      // Write to cache using versioned writes
      for (const candle of candles) {
        const unified: UnifiedCandle = {
          ...candle,
          exchange: this.exchangeName,
        };

        await this.candleCache.addCandleIfNewer(
          this.userId,
          this.exchangeIdNum,
          unified
        );
      }

      logger.info({ symbol, candleCount: candles.length }, 'Backfill complete');
    } catch (error) {
      logger.error({ error, symbol }, 'REST backfill failed');
    }
  }
}
