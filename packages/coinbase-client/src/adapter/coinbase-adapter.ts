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
import type { Redis } from 'ioredis';
import { BaseExchangeAdapter } from './base-adapter';
import { CoinbaseAuth } from '../rest/auth';
import { CoinbaseRestClient } from '../rest/client';
import { CandleCacheStrategy, candleCloseChannel } from '@livermore/cache';
import type { Timeframe, UnifiedCandle } from '@livermore/schemas';
import { logger } from '@livermore/utils';

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
 * All possible WebSocket message types
 */
type CoinbaseWSMessage =
  | CandlesMessage
  | HeartbeatsMessage
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
  redis: Redis;
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

  /** Redis client for pub/sub (used in Plan 02 for handleMessage) */
  protected redis: Redis;

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

  constructor(options: CoinbaseAdapterOptions) {
    super();
    this.auth = new CoinbaseAuth(options.apiKeyId, options.privateKeyPem);
    this.restClient = new CoinbaseRestClient(options.apiKeyId, options.privateKeyPem);
    this.candleCache = new CandleCacheStrategy(options.redis);
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
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        logger.error({ error, exchangeId: this.exchangeId }, 'WebSocket error');
        this.emit('error', error);
        reject(error);
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
   * Tracks sequence numbers, detects gaps, and detects candle close by comparing timestamps
   */
  private async handleCandlesMessage(message: CandlesMessage): Promise<void> {
    const sequenceNum = message.sequence_num;

    // Check for sequence gap (more than 1 difference indicates missed messages)
    // Note: Sequence numbers reset per connection, so only check after first message
    if (this.lastSequenceNum > 0 && sequenceNum > this.lastSequenceNum + 1) {
      const gap = sequenceNum - this.lastSequenceNum - 1;
      logger.warn(
        { lastSequence: this.lastSequenceNum, newSequence: sequenceNum, gap },
        'Sequence gap detected - messages may have been dropped'
      );
      this.hasDetectedGap = true;
    }

    this.lastSequenceNum = sequenceNum;

    for (const event of message.events) {
      for (const rawCandle of event.candles) {
        const candle = this.normalizeCandle(rawCandle, sequenceNum);
        const symbol = candle.symbol;
        const previousTimestamp = this.lastCandleTimestamps.get(symbol);

        // Detect candle close: timestamp changed means previous candle closed
        if (previousTimestamp !== undefined && previousTimestamp !== candle.timestamp) {
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
    logger.debug(
      { symbol: candle.symbol, timestamp: new Date(candle.timestamp).toISOString() },
      'Candle closed'
    );

    // Emit typed event for local subscribers
    this.emit('candle:close', candle);

    // Publish to Redis pub/sub for distributed subscribers (indicator service)
    try {
      const channel = candleCloseChannel(
        this.userId,
        this.exchangeIdNum,
        candle.symbol,
        candle.timeframe
      );
      await this.redis.publish(channel, JSON.stringify(candle));
    } catch (error) {
      logger.error({ error, symbol: candle.symbol }, 'Failed to publish candle:close to Redis');
    }
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
   */
  private forceReconnect(): void {
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
    this.lastSequenceNum = 0;
    this.hasDetectedGap = false;
  }

  /**
   * Check if we need to backfill after reconnection
   * Returns true if a sequence gap was detected during the last connection
   */
  needsBackfill(): boolean {
    return this.hasDetectedGap;
  }
}
