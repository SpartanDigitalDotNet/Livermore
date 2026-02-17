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

  /** Whether connected via /stream?streams= (combined format) vs /ws (raw format) */
  private usingCombinedEndpoint = false;

  /** Proactive reconnect timer to preempt Binance 24-hour hard disconnect */
  private reconnectTimer: NodeJS.Timeout | null = null;

  /** Proactive reconnect interval - reconnect before Binance's 24h hard cutoff */
  private readonly PROACTIVE_RECONNECT_MS = 23 * 60 * 60 * 1000; // 23 hours

  /** Timestamp of last kline message received (for kline-specific watchdog) */
  private lastKlineTimestamp = 0;

  /** Kline freshness watchdog interval timer */
  private klineWatchdogInterval: NodeJS.Timeout | null = null;

  /** How often to check kline freshness */
  private readonly KLINE_WATCHDOG_INTERVAL_MS = 120_000; // 2 minutes

  /** Max silence before declaring klines stale and reconnecting */
  private readonly KLINE_MAX_SILENCE_MS = 600_000; // 10 minutes

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
   * Build the WebSocket URL based on current subscription state.
   * If symbols are known, uses /stream?streams= (combined format).
   * Otherwise falls back to /ws (raw format) for initial bare connect.
   */
  private buildStreamUrl(): string {
    if (this.subscribedSymbols.length > 0) {
      // Subscribe to both 1m and primary timeframe kline streams
      // Binance natively supports 1m klines (unlike Coinbase which needs trade aggregation)
      const klineStreams = this.subscribedSymbols.flatMap((s) => {
        const lower = s.toLowerCase();
        const streams = [`${lower}@kline_${this.subscribedTimeframe}`];
        if (this.subscribedTimeframe !== '1m') {
          streams.push(`${lower}@kline_1m`);
        }
        return streams;
      });
      const tickerStreams = this.subscribedSymbols.map(
        (s) => `${s.toLowerCase()}@miniTicker`
      );
      const allStreams = [...klineStreams, ...tickerStreams];
      return `${this.wsUrl}/stream?streams=${allStreams.join('/')}`;
    }
    return `${this.wsUrl}/ws`;
  }

  /**
   * Establish connection to Binance WebSocket
   * Uses /stream?streams= when symbols are known (combined format),
   * falls back to /ws for initial bare connect before subscribe().
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isIntentionalClose = false;
      this.lastKlineTimestamp = 0;

      const url = this.buildStreamUrl();
      this.usingCombinedEndpoint = this.subscribedSymbols.length > 0;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        logger.info(
          { exchangeId: this.exchangeName, url, combined: this.usingCombinedEndpoint },
          'Connected to Binance WebSocket'
        );
        this.resetReconnectAttempts();
        this.resetWatchdog();
        this.startProactiveReconnectTimer();
        this.startKlineWatchdog();

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
    this.stopProactiveReconnectTimer();
    this.stopKlineWatchdog();
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

    if (this.usingCombinedEndpoint) {
      // Already subscribed via /stream?streams= URL — no SUBSCRIBE frame needed
      logger.info(
        { symbols: symbols.length, timeframe },
        'Streams already active via combined endpoint URL'
      );
      return;
    }

    // Connected to bare /ws — reconnect to /stream?streams= with symbols in URL
    logger.info(
      { symbols: symbols.length, timeframe },
      'Switching from /ws to /stream endpoint with stream subscriptions'
    );
    this.forceReconnect();
  }

  /**
   * Unsubscribe from kline and miniTicker streams for specified symbols
   * Sends UNSUBSCRIBE method frame over existing WebSocket connection.
   */
  unsubscribe(symbols: string[], timeframe: Timeframe): void {
    if (!this.isConnected()) return;

    // Build stream names to unsubscribe (includes 1m if primary is not 1m)
    const klineStreams = symbols.flatMap((s) => {
      const lower = s.toLowerCase();
      const streams = [`${lower}@kline_${timeframe}`];
      if (timeframe !== '1m') {
        streams.push(`${lower}@kline_1m`);
      }
      return streams;
    });
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
    this.lastKlineTimestamp = Date.now();

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
    this.stopProactiveReconnectTimer();
    this.stopKlineWatchdog();

    // Trigger reconnect via base class
    this.handleReconnect();
  }

  // ============================================
  // Proactive Reconnect Timer (24h protection)
  // ============================================

  /**
   * Start 23-hour proactive reconnect timer.
   * Binance hard-disconnects at 24 hours — reconnecting at 23h avoids the hard cut.
   */
  private startProactiveReconnectTimer(): void {
    this.stopProactiveReconnectTimer();

    this.reconnectTimer = setTimeout(() => {
      logger.info(
        { exchangeId: this.exchangeName },
        'Proactive 23h reconnect — preempting Binance 24h hard disconnect'
      );
      this.forceReconnect();
    }, this.PROACTIVE_RECONNECT_MS);

    logger.info(
      { exchangeId: this.exchangeName, hours: 23 },
      'Starting proactive reconnect timer'
    );
  }

  /**
   * Stop proactive reconnect timer
   */
  private stopProactiveReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ============================================
  // Kline Freshness Watchdog
  // ============================================

  /**
   * Start kline-specific freshness watchdog.
   * The general 30s watchdog resets on ANY message (including miniTicker every ~1s),
   * masking dead kline streams. This watchdog only cares about kline messages.
   */
  private startKlineWatchdog(): void {
    this.stopKlineWatchdog();

    this.klineWatchdogInterval = setInterval(() => {
      // Skip check if no klines received yet (still warming up)
      if (this.lastKlineTimestamp === 0) return;

      const silenceMs = Date.now() - this.lastKlineTimestamp;
      if (silenceMs > this.KLINE_MAX_SILENCE_MS) {
        logger.warn(
          {
            exchangeId: this.exchangeName,
            silenceMs,
            lastKline: new Date(this.lastKlineTimestamp).toISOString(),
          },
          'Kline watchdog: no kline messages received — forcing reconnect'
        );
        this.forceReconnect();
      }
    }, this.KLINE_WATCHDOG_INTERVAL_MS);

    logger.info(
      { exchangeId: this.exchangeName, checkIntervalMs: this.KLINE_WATCHDOG_INTERVAL_MS, maxSilenceMs: this.KLINE_MAX_SILENCE_MS },
      'Starting kline freshness watchdog'
    );
  }

  /**
   * Stop kline freshness watchdog
   */
  private stopKlineWatchdog(): void {
    if (this.klineWatchdogInterval) {
      clearInterval(this.klineWatchdogInterval);
      this.klineWatchdogInterval = null;
    }
  }

  // ============================================
  // Reconnection & Backfill
  // ============================================

  /**
   * Called after successful connection/reconnection
   * When using combined endpoint, streams are already active via URL.
   * When using bare /ws, subscribe() will be called by control-channel after connect().
   */
  private async onConnected(): Promise<void> {
    if (this.subscribedSymbols.length > 0 && this.usingCombinedEndpoint) {
      // Streams already active via /stream?streams= URL — just check backfill
      logger.info(
        { symbols: this.subscribedSymbols.length },
        'Streams active via combined endpoint — checking backfill'
      );

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
