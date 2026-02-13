/**
 * Coinbase Candle Adapter
 *
 * Connects to Coinbase Advanced Trade WebSocket candles channel for real-time
 * 5-minute candle data. Subscribes to heartbeats channel to prevent idle
 * disconnections (Coinbase disconnects after 60-90s of inactivity).
 *
 * Extends BaseExchangeAdapter for standardized event emission and reconnection logic.
 */
import WebSocket from 'ws';
import { BaseExchangeAdapter } from './base-adapter';
import { CoinbaseAuth } from '../rest/auth';
import { CoinbaseRestClient } from '../rest/client';
import { CandleCacheStrategy, candleCloseChannel, exchangeCandleCloseChannel, TickerCacheStrategy, type RedisClient } from '@livermore/cache';
import type { Timeframe, UnifiedCandle, Ticker, Candle } from '@livermore/schemas';
import { logger, getCandleTimestamp } from '@livermore/utils';

/**
 * State for locally-aggregated 1m candles built from ticker data
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
 * Coinbase candle from WebSocket candles channel
 * Note: All values are strings, timestamps are UNIX seconds
 */
interface CoinbaseWebSocketCandle {
  start: string;      // UNIX timestamp in SECONDS
  high: string;
  low: string;
  open: string;
  close: string;
  volume: string;
  product_id: string;
}

/**
 * Candle event from Coinbase WebSocket
 */
interface CandleEvent {
  type: 'snapshot' | 'update';
  candles: CoinbaseWebSocketCandle[];
}

/**
 * Candles channel message from Coinbase WebSocket
 */
interface CandlesMessage {
  channel: 'candles';
  client_id: string;
  timestamp: string;
  sequence_num: number;
  events: CandleEvent[];
}

/**
 * Heartbeats channel message from Coinbase WebSocket
 */
interface HeartbeatsMessage {
  channel: 'heartbeats';
  client_id: string;
  timestamp: string;
  sequence_num: number;
  events: Array<{
    current_time: string;
    heartbeat_counter: string;
  }>;
}

/**
 * Ticker event from Coinbase WebSocket
 */
interface CoinbaseTickerEvent {
  type: 'snapshot' | 'update';
  tickers: Array<{
    type: 'ticker';
    product_id: string;
    price: string;
    volume_24_h: string;
    low_24_h: string;
    high_24_h: string;
    price_percent_chg_24_h: string;
  }>;
}

/**
 * Ticker channel message from Coinbase WebSocket
 */
interface TickerMessage {
  channel: 'ticker';
  client_id: string;
  timestamp: string;
  sequence_num: number;
  events: CoinbaseTickerEvent[];
}

/**
 * Market trade from Coinbase WebSocket market_trades channel
 */
interface CoinbaseMarketTrade {
  trade_id: string;
  product_id: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  time: string;
}

/**
 * Market trades event from Coinbase WebSocket
 */
interface MarketTradesEvent {
  type: 'snapshot' | 'update';
  trades: CoinbaseMarketTrade[];
}

/**
 * Market trades channel message from Coinbase WebSocket
 */
interface MarketTradesMessage {
  channel: 'market_trades';
  client_id: string;
  timestamp: string;
  sequence_num: number;
  events: MarketTradesEvent[];
}

/**
 * All possible WebSocket message types
 */
type CoinbaseWSMessage =
  | CandlesMessage
  | HeartbeatsMessage
  | TickerMessage
  | MarketTradesMessage
  | { channel: 'subscriptions'; events: Array<{ subscriptions: Record<string, string[]> }> }
  | { channel: 'error'; message: string };

/**
 * Configuration options for CoinbaseAdapter
 */
export interface CoinbaseAdapterOptions {
  /** Coinbase API key ID (CDP key name) */
  apiKeyId: string;
  /** Coinbase private key in PEM format */
  privateKeyPem: string;
  /** Redis client for caching and pub/sub */
  redis: RedisClient;
  /** User ID for cache key scoping */
  userId: number;
  /** Exchange ID (numeric) for cache key scoping */
  exchangeId: number;
}

/**
 * CoinbaseAdapter - Exchange adapter for Coinbase Advanced Trade API
 *
 * Subscribes to the native candles WebSocket channel for real-time 5-minute
 * candle updates. Handles connection lifecycle, automatic reconnection,
 * and heartbeat subscription to prevent idle disconnection.
 *
 * Events emitted:
 * - 'connected' - WebSocket connection established
 * - 'disconnected' - WebSocket connection closed (includes reason)
 * - 'error' - Error occurred
 * - 'reconnecting' - Attempting to reconnect (includes attempt number, delay)
 * - 'candle:close' - Candle closed (TODO: Plan 02)
 */
export class CoinbaseAdapter extends BaseExchangeAdapter {
  /** Exchange identifier for logging and UnifiedCandle.exchange field */
  protected readonly exchangeId = 'coinbase';

  /** Coinbase Advanced Trade WebSocket URL */
  private readonly WS_URL = 'wss://advanced-trade-ws.coinbase.com';

  /** WebSocket connection instance */
  private ws: WebSocket | null = null;

  /** Authentication helper for JWT generation */
  private auth: CoinbaseAuth;

  /** REST client for backfill operations (used in Plan 02 for handleMessage) */
  protected restClient: CoinbaseRestClient;

  /** Cache strategy for candle storage (used in Plan 02 for handleMessage) */
  protected candleCache: CandleCacheStrategy;

  /** Cache strategy for ticker storage and pub/sub */
  protected tickerCache: TickerCacheStrategy;

  /** Redis client for pub/sub (used in Plan 02 for handleMessage) */
  protected redis: RedisClient;

  /** User ID for cache key scoping (used in Plan 02 for handleMessage) */
  protected userId: number;

  /** Exchange ID (numeric) for cache key scoping (used in Plan 02 for handleMessage) */
  protected exchangeIdNum: number;

  /** Currently subscribed symbols */
  protected subscribedSymbols: string[] = [];

  /** Currently subscribed timeframe (always 5m for WebSocket) */
  protected subscribedTimeframe: Timeframe = '5m';

  /** Flag to prevent reconnection on intentional disconnect */
  private isIntentionalClose = false;

  /** Track last candle timestamp per symbol for close detection */
  private lastCandleTimestamps = new Map<string, number>();

  /** Watchdog timer to detect silent disconnections */
  private watchdogTimeout: NodeJS.Timeout | null = null;

  /** Watchdog interval - force reconnect if no message received within this time */
  private readonly WATCHDOG_INTERVAL_MS = 30_000; // 30 seconds

  /** Last sequence number received (per connection) */
  private lastSequenceNum = 0;

  /** Flag indicating a sequence gap was detected during this connection */
  private hasDetectedGap = false;

  /** Count of sequence gaps detected (for periodic logging) */
  private sequenceGapCount = 0;

  /** Total messages dropped (for periodic logging) */
  private totalDroppedMessages = 0;

  /** Backfill threshold - only backfill if gap is greater than this (5 minutes) */
  private readonly BACKFILL_THRESHOLD_MS = 5 * 60 * 1000;

  /** 1m candle state aggregated from ticker data (per symbol) */
  private oneMinuteCandles = new Map<string, CandleState>();

  constructor(options: CoinbaseAdapterOptions) {
    super();
    this.auth = new CoinbaseAuth(options.apiKeyId, options.privateKeyPem);
    this.restClient = new CoinbaseRestClient(options.apiKeyId, options.privateKeyPem);
    this.candleCache = new CandleCacheStrategy(options.redis);
    this.tickerCache = new TickerCacheStrategy(options.redis);
    this.redis = options.redis;
    this.userId = options.userId;
    this.exchangeIdNum = options.exchangeId;
  }

  /**
   * Establish connection to Coinbase WebSocket
   * Subscribes to heartbeats channel immediately on connection to prevent idle disconnect.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isIntentionalClose = false;
      this.ws = new WebSocket(this.WS_URL);

      this.ws.on('open', () => {
        logger.info({ exchangeId: this.exchangeId }, 'Connected to Coinbase WebSocket');
        this.resetReconnectAttempts();
        this.resetSequenceTracking();
        this.subscribeToHeartbeats();
        this.resetWatchdog();

        // Handle post-connection setup (resubscribe, backfill)
        this.onConnected().catch(error => {
          logger.error({ error }, 'Error in post-connection setup');
        });

        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        logger.error({ error, exchangeId: this.exchangeId }, 'WebSocket error');

        // Only emit error if there are listeners (prevents unhandled error crash)
        // Network errors are expected during outages - let reconnection handle them
        if (this.listenerCount('error') > 0) {
          this.emit('error', error);
        }

        // Reject only if connection was never established
        // Runtime errors will trigger close event -> handleReconnect()
        if (!this.isConnected()) {
          reject(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(
          { code, reason: reason.toString(), exchangeId: this.exchangeId },
          'WebSocket closed'
        );
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
    logger.info({ exchangeId: this.exchangeId }, 'Disconnected from Coinbase WebSocket');
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to candles channel for specified symbols
   * Note: Coinbase WebSocket only supports 5m candles.
   */
  subscribe(symbols: string[], timeframe: Timeframe): void {
    if (!this.isConnected()) {
      throw new Error('Cannot subscribe: WebSocket not connected');
    }

    // Coinbase WebSocket only supports 5m candles
    if (timeframe !== '5m') {
      logger.warn({ timeframe }, 'Coinbase WebSocket only supports 5m candles, using 5m');
    }

    this.subscribedSymbols = symbols;
    this.subscribedTimeframe = '5m';

    const token = this.auth.generateToken();
    const subscribeMessage = {
      type: 'subscribe',
      product_ids: symbols,
      channel: 'candles',
      jwt: token,
    };

    this.ws!.send(JSON.stringify(subscribeMessage));
    logger.info({ symbols, channel: 'candles' }, 'Subscribed to candles channel');

    // Also subscribe to ticker for price updates (used by alerts)
    this.subscribeToTicker();

    // Subscribe to market_trades for accurate 1m candle building
    // Only for a limited subset of high-volume symbols to avoid sequence gaps
    this.subscribeToMarketTrades();
  }

  /**
   * Subscribe to market_trades channel for building accurate 1m candles
   * IMPORTANT: Only subscribe to symbols that need 1m candles to reduce message volume.
   */
  private subscribeToMarketTrades(): void {
    if (!this.isConnected() || this.subscribedSymbols.length === 0) return;

    const token = this.auth.generateToken();
    const subscribeMessage = {
      type: 'subscribe',
      channel: 'market_trades',
      product_ids: this.subscribedSymbols,
      jwt: token,
    };

    this.ws!.send(JSON.stringify(subscribeMessage));
    logger.info({ symbols: this.subscribedSymbols.length }, 'Subscribed to market_trades channel for 1m candles');
  }

  /**
   * Unsubscribe from candles channel for specified symbols
   */
  unsubscribe(symbols: string[], _timeframe: Timeframe): void {
    if (!this.isConnected()) return;

    const token = this.auth.generateToken();
    const unsubscribeMessage = {
      type: 'unsubscribe',
      product_ids: symbols,
      channel: 'candles',
      jwt: token,
    };

    this.ws!.send(JSON.stringify(unsubscribeMessage));
    this.subscribedSymbols = this.subscribedSymbols.filter((s) => !symbols.includes(s));
    logger.info({ symbols, channel: 'candles' }, 'Unsubscribed from candles channel');
  }

  /**
   * Subscribe to heartbeats channel to prevent idle disconnection
   * Called automatically on connection.
   */
  private subscribeToHeartbeats(): void {
    if (!this.isConnected()) return;

    const token = this.auth.generateToken();
    const subscribeMessage = {
      type: 'subscribe',
      channel: 'heartbeats',
      jwt: token,
    };

    this.ws!.send(JSON.stringify(subscribeMessage));
    logger.info('Subscribed to heartbeats channel');
  }

  /**
   * Subscribe to ticker channel for price updates
   * Called after candles subscription when symbols are known.
   * Unlike heartbeats, ticker requires product_ids.
   */
  private subscribeToTicker(): void {
    if (!this.isConnected() || this.subscribedSymbols.length === 0) return;

    const token = this.auth.generateToken();
    const subscribeMessage = {
      type: 'subscribe',
      channel: 'ticker',
      product_ids: this.subscribedSymbols,
      jwt: token,
    };

    this.ws!.send(JSON.stringify(subscribeMessage));
    logger.info({ symbols: this.subscribedSymbols.length }, 'Subscribed to ticker channel');
  }


  /**
   * Normalize Coinbase WebSocket candle to UnifiedCandle format
   */
  private normalizeCandle(candle: CoinbaseWebSocketCandle, sequenceNum: number): UnifiedCandle {
    return {
      timestamp: parseInt(candle.start, 10) * 1000, // Convert seconds to milliseconds
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.volume),
      symbol: candle.product_id,
      timeframe: '5m',  // Coinbase WebSocket candles are always 5m
      exchange: 'coinbase',
      sequenceNum,
    };
  }

  /**
   * Process incoming candle messages
   * Detects candle close by comparing timestamps.
   *
   * IMPORTANT: Only emits candle:close for 'update' events (real-time), not for 'snapshot'.
   * The snapshot contains ~100 historical candles per symbol which would flood the
   * BoundaryRestService with hundreds of boundary triggers.
   */
  private async handleCandlesMessage(message: CandlesMessage): Promise<void> {
    for (const event of message.events) {
      // Track whether this is a real-time update vs historical snapshot
      const isRealTimeUpdate = event.type === 'update';

      for (const rawCandle of event.candles) {
        const candle = this.normalizeCandle(rawCandle, message.sequence_num);
        const symbol = candle.symbol;
        const previousTimestamp = this.lastCandleTimestamps.get(symbol);

        // Detect candle close: timestamp changed means previous candle closed
        // ONLY emit for real-time updates, NOT for snapshot data
        if (isRealTimeUpdate && previousTimestamp !== undefined && previousTimestamp !== candle.timestamp) {
          // Previous candle just closed - emit close event for it
          // Note: We emit for the NEW candle (which contains the finalized OHLCV)
          // because Coinbase sends the new candle when the old one closes
          await this.onCandleClose(candle);
        }

        // Update tracking
        this.lastCandleTimestamps.set(symbol, candle.timestamp);

        // Always write to cache (addCandleIfNewer handles versioning)
        try {
          await this.candleCache.addCandleIfNewer(
            this.userId,
            this.exchangeIdNum,
            candle
          );
        } catch (error) {
          logger.error({ error, symbol, timestamp: candle.timestamp }, 'Failed to write candle to cache');
        }
      }
    }
  }

  /**
   * Handle candle close event
   * Writes to cache, publishes to Redis, emits event
   */
  private async onCandleClose(candle: UnifiedCandle): Promise<void> {
    logger.info(
      { symbol: candle.symbol, timestamp: new Date(candle.timestamp).toISOString(), event: 'candle_close_emitted' },
      'Candle closed'
    );

    // Emit typed event for local subscribers
    this.emit('candle:close', candle);

    // Publish to Redis pub/sub for distributed subscribers (indicator service)
    try {
      // NEW: Exchange-scoped channel (shared across users)
      const exchangeChannel = exchangeCandleCloseChannel(
        this.exchangeIdNum,
        candle.symbol,
        candle.timeframe
      );
      await this.redis.publish(exchangeChannel, JSON.stringify(candle));

      // LEGACY: User-scoped channel (backward compatibility during migration)
      const userChannel = candleCloseChannel(
        this.userId,
        this.exchangeIdNum,
        candle.symbol,
        candle.timeframe
      );
      await this.redis.publish(userChannel, JSON.stringify(candle));
    } catch (error) {
      logger.error({ error, symbol: candle.symbol }, 'Failed to publish candle:close to Redis');
    }
  }

  /**
   * Process incoming ticker messages
   * Transforms Coinbase ticker to Livermore Ticker format and publishes to Redis
   */
  private async handleTickerMessage(message: TickerMessage): Promise<void> {
    for (const event of message.events) {
      // Only process 'update' events, not 'snapshot'
      if (event.type !== 'update') continue;

      for (const tickerData of event.tickers) {
        const price = parseFloat(tickerData.price);
        const timestamp = new Date(message.timestamp).getTime();
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
          timestamp,
        };

        try {
          // Cache ticker in Redis (with 60s TTL)
          await this.tickerCache.setTicker(this.exchangeIdNum, ticker);

          // Publish update via Redis pub/sub (AlertEvaluationService subscribes to this)
          await this.tickerCache.publishUpdate(this.exchangeIdNum, ticker);

        } catch (error) {
          logger.error({ error, symbol: ticker.symbol }, 'Failed to cache/publish ticker');
        }
      }
    }
  }

  /**
   * Process incoming market_trades messages - SYNCHRONOUS to avoid blocking
   * Updates in-memory candle state only. Redis writes happen on candle close (fire-and-forget).
   */
  private handleMarketTradesMessage(message: MarketTradesMessage): void {
    for (const event of message.events) {
      // Only process 'update' events (not historical snapshots)
      if (event.type !== 'update') continue;

      for (const trade of event.trades) {
        const price = parseFloat(trade.price);
        const size = parseFloat(trade.size);
        const timestamp = new Date(trade.time).getTime();

        // Synchronous in-memory aggregation - no await!
        this.aggregateTradeInto1mCandle(trade.product_id, price, size, timestamp);
      }
    }
  }

  /**
   * Aggregate trade into local 1m candle - SYNCHRONOUS
   * Uses actual trade prices for accurate high/low. Volume is accumulated from trade sizes.
   * Only emits to Redis on candle close (fire-and-forget, non-blocking).
   */
  private aggregateTradeInto1mCandle(symbol: string, price: number, size: number, timestamp: number): void {
    const candleTime = getCandleTimestamp(timestamp, '1m');
    const existing = this.oneMinuteCandles.get(symbol);

    if (!existing || candleTime > existing.timestamp) {
      // New minute started - close previous candle if exists
      if (existing && !existing.isClosed) {
        existing.isClosed = true;
        // Fire-and-forget - don't await!
        this.emit1mCandleClose(symbol, existing).catch(err => {
          logger.error({ err, symbol }, 'Failed to emit 1m candle close');
        });
      }

      // Start new candle
      this.oneMinuteCandles.set(symbol, {
        timestamp: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: size,
        isClosed: false,
      });
    } else {
      // Update existing candle
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += size;
    }
  }

  /**
   * Emit 1m candle close - saves to cache and publishes event
   */
  private async emit1mCandleClose(symbol: string, state: CandleState): Promise<void> {
    const timeframe: Timeframe = '1m';

    logger.info({
      event: '1m_candle_close',
      symbol,
      timestamp: new Date(state.timestamp).toISOString(),
      ohlc: `${state.open}/${state.high}/${state.low}/${state.close}`,
      hl_range: (state.high - state.low).toFixed(2),
    }, `1m candle closed: ${symbol}`);

    const candle: Candle = {
      timestamp: state.timestamp,
      open: state.open,
      high: state.high,
      low: state.low,
      close: state.close,
      volume: state.volume,
      symbol,
      timeframe,
    };

    try {
      // Save to cache
      await this.candleCache.addCandles(this.userId, this.exchangeIdNum, [candle]);

      // Publish candle:close event (triggers indicator recalculation)
      const unified: UnifiedCandle = { ...candle, exchange: 'coinbase' };

      // NEW: Exchange-scoped channel (shared across users)
      const exchangeChannel = exchangeCandleCloseChannel(this.exchangeIdNum, symbol, timeframe);
      await this.redis.publish(exchangeChannel, JSON.stringify(unified));

      // LEGACY: User-scoped channel (backward compatibility during migration)
      const userChannel = candleCloseChannel(this.userId, this.exchangeIdNum, symbol, timeframe);
      await this.redis.publish(userChannel, JSON.stringify(unified));
    } catch (error) {
      logger.error({ error, symbol, timeframe }, 'Failed to persist 1m candle');
    }
  }

  /**
   * Track sequence numbers across ALL message types
   * Sequence numbers are global per connection, not per channel
   */
  private trackSequence(sequenceNum: number | undefined): void {
    if (sequenceNum === undefined) return;

    if (this.lastSequenceNum > 0 && sequenceNum > this.lastSequenceNum + 1) {
      const gap = sequenceNum - this.lastSequenceNum - 1;
      this.sequenceGapCount++;
      this.totalDroppedMessages += gap;
      this.hasDetectedGap = true;

      // Log periodically (every 100 gaps) instead of every time
      if (this.sequenceGapCount % 100 === 0) {
        logger.warn(
          { gapCount: this.sequenceGapCount, totalDropped: this.totalDroppedMessages },
          'Sequence gaps detected - some messages dropped'
        );
      }
    }
    this.lastSequenceNum = sequenceNum;
  }

  /**
   * Handle incoming WebSocket messages
   * Routes messages to appropriate handlers based on channel type
   */
  private handleMessage(data: WebSocket.Data): void {
    // Reset watchdog on every message (including heartbeats)
    this.resetWatchdog();

    try {
      const message = JSON.parse(data.toString()) as CoinbaseWSMessage;

      // Track sequence for all message types (global per connection)
      this.trackSequence((message as { sequence_num?: number }).sequence_num);

      // Log subscription confirmations
      if (message.channel === 'subscriptions') {
        logger.info({ events: message.events }, 'Subscription confirmed');
        return;
      }

      // Log errors
      if (message.channel === 'error') {
        logger.error({ error: message.message }, 'WebSocket error message');
        return;
      }

      // Handle candles - fire and forget to avoid blocking
      if (message.channel === 'candles') {
        this.handleCandlesMessage(message as CandlesMessage).catch(error => {
          logger.error({ error }, 'Error processing candles message');
        });
        return;
      }

      // Handle heartbeats - just log at debug level for now
      if (message.channel === 'heartbeats') {
        logger.debug({ counter: (message as HeartbeatsMessage).events[0]?.heartbeat_counter }, 'Heartbeat received');
        return;
      }

      // Handle ticker - fire and forget to avoid blocking
      if (message.channel === 'ticker') {
        this.handleTickerMessage(message as TickerMessage).catch(error => {
          logger.error({ error }, 'Error processing ticker message');
        });
        return;
      }

      // Handle market_trades - SYNCHRONOUS to avoid message backlog
      if (message.channel === 'market_trades') {
        this.handleMarketTradesMessage(message as MarketTradesMessage);
        return;
      }

      // Unknown channel
      logger.warn({ channel: (message as { channel: string }).channel }, 'Unknown WebSocket channel');
    } catch (error) {
      logger.error({ error, data: data.toString() }, 'Failed to parse WebSocket message');
    }
  }

  /**
   * Reset watchdog timer - call on every message
   * If no message received within WATCHDOG_INTERVAL_MS, force reconnect
   */
  private resetWatchdog(): void {
    if (this.watchdogTimeout) {
      clearTimeout(this.watchdogTimeout);
    }

    this.watchdogTimeout = setTimeout(() => {
      logger.warn(
        { exchangeId: this.exchangeId, intervalMs: this.WATCHDOG_INTERVAL_MS },
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
   * Respects isIntentionalClose flag to prevent reconnect after pause
   */
  private forceReconnect(): void {
    // Don't reconnect if this was an intentional disconnect (e.g., pause command)
    if (this.isIntentionalClose) {
      logger.debug({ exchangeId: this.exchangeId }, 'Skipping reconnect - intentional close');
      return;
    }

    logger.info({ exchangeId: this.exchangeId }, 'Forcing reconnect');

    // Close existing connection without triggering normal disconnect
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    // Clear watchdog
    this.stopWatchdog();

    // Trigger reconnect via base class
    this.handleReconnect();
  }

  /**
   * Reset sequence tracking - call after reconnection
   * Sequence numbers are per-connection, so reset to 0
   */
  private resetSequenceTracking(): void {
    // Log summary if there were gaps in previous connection
    if (this.sequenceGapCount > 0) {
      logger.info(
        { gapCount: this.sequenceGapCount, totalDropped: this.totalDroppedMessages },
        'Connection reset - sequence gap summary from previous connection'
      );
    }
    this.lastSequenceNum = 0;
    this.hasDetectedGap = false;
    this.sequenceGapCount = 0;
    this.totalDroppedMessages = 0;
  }

  /**
   * Check if we need to backfill after reconnection
   * Returns true if a sequence gap was detected during the last connection
   */
  needsBackfill(): boolean {
    return this.hasDetectedGap;
  }

  /**
   * Check for data gaps and backfill from REST API if needed
   * Called after reconnection to fill any gaps that occurred during disconnect.
   * THROTTLED: 100ms delay between REST calls to avoid 429 rate limiting.
   */
  private async checkAndBackfill(): Promise<void> {
    if (this.subscribedSymbols.length === 0) {
      logger.debug('No subscribed symbols - skipping backfill check');
      return;
    }

    const now = Date.now();
    const symbolsNeedingBackfill: Array<{ symbol: string; lastTimestamp: number }> = [];

    // First pass: identify which symbols need backfill (no REST calls yet)
    for (const symbol of this.subscribedSymbols) {
      try {
        const latestCached = await this.candleCache.getLatestCandle(
          this.userId,
          this.exchangeIdNum,
          symbol,
          '5m'
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
        await new Promise(resolve => setTimeout(resolve, 100));
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
  private async backfillSymbol(symbol: string, fromTimestamp: number, toTimestamp: number): Promise<void> {
    try {
      // Fetch candles from REST API
      const candles = await this.restClient.getCandles(
        symbol,
        '5m',
        fromTimestamp,
        toTimestamp
      );

      logger.info(
        { symbol, fromTimestamp: new Date(fromTimestamp).toISOString(), candleCount: candles.length },
        'Fetched candles from REST API for backfill'
      );

      // Write to cache using versioned writes
      for (const candle of candles) {
        const unified: UnifiedCandle = {
          ...candle,
          exchange: 'coinbase',
          // REST candles don't have sequence numbers
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

  /**
   * Called after successful connection/reconnection
   * Resubscribes to channels and checks for backfill needs
   */
  private async onConnected(): Promise<void> {
    // Resubscribe to channels if we had subscriptions
    if (this.subscribedSymbols.length > 0) {
      this.subscribe(this.subscribedSymbols, this.subscribedTimeframe);

      // Check for gaps and backfill if needed
      // Note: Only backfill on REconnection, not initial connection
      if (this.reconnectAttempts > 0 || this.hasDetectedGap) {
        await this.checkAndBackfill();
      }
    }
  }
}
