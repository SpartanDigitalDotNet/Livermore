import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import { transformCandle } from '../transformers/candle.transformer.js';
import {
  deriveAlertDirection,
  deriveAlertStrength,
} from '../transformers/alert.transformer.js';
import { ClientConnection } from './connection.js';
import type { WsEnvelope } from './types.js';

/**
 * Local interface for alert payloads received via Redis pub/sub.
 * Copied from internal shape -- do NOT import from @livermore/database
 * to maintain zero-dependency IP isolation boundary.
 *
 * Contains ONLY the fields we need to read. Proprietary fields listed
 * here are intentionally NOT forwarded to clients.
 */
interface AlertRedisPayload {
  symbol: string;
  timeframe: string;
  triggerLabel: string;
  triggerValue: string | null;
  price: number | string;
  triggeredAt: string;
  /** Internal -- never forwarded */
  alertType?: string;
  /** Internal -- never forwarded */
  signalDelta?: number;
  /** Internal -- never forwarded */
  sourceExchangeId?: number;
}

/**
 * WebSocketBridge manages a shared Redis subscriber that receives candle close
 * and alert events, transforms them through IP-protective transformers, and
 * fans out to subscribed WebSocket clients.
 *
 * Architecture:
 * - One Redis subscriber (via redis.duplicate()) with psubscribe patterns
 * - Many ClientConnections, each tracking their own channel subscriptions
 * - Per-API-key connection counting for WS-06 enforcement
 * - Messages are stringified ONCE then sent to all matching clients
 */
export class WebSocketBridge {
  /** Max concurrent connections per API key */
  static readonly MAX_CONNECTIONS_PER_KEY = 5;

  /** Active client connections keyed by connectionId */
  public readonly clients: Map<string, ClientConnection> = new Map();

  /** Per-API-key connection counts for WS-06 enforcement */
  private readonly keyConnectionCounts: Map<number, number> = new Map();

  /** Dedicated Redis subscriber instance */
  private subscriber: any = null;

  private readonly redis: any;
  private readonly exchangeId: number;
  private readonly exchangeName: string;

  constructor(opts: { redis: any; exchangeId: number; exchangeName: string }) {
    this.redis = opts.redis;
    this.exchangeId = opts.exchangeId;
    this.exchangeName = opts.exchangeName;
  }

  /**
   * Start the bridge: create a dedicated Redis subscriber and subscribe
   * to candle close and alert patterns for this exchange.
   */
  async start(): Promise<void> {
    this.subscriber = this.redis.duplicate();

    // Subscribe to all candle close events for this exchange
    await this.subscriber.psubscribe(
      `channel:exchange:${this.exchangeId}:candle:close:*:*`
    );

    // Subscribe to all alert events for this exchange
    await this.subscriber.psubscribe(
      `channel:alerts:exchange:${this.exchangeId}`
    );

    // Attach message handler
    this.subscriber.on(
      'pmessage',
      (_pattern: string, channel: string, message: string) => {
        this.handleRedisMessage(channel, message);
      }
    );
  }

  /**
   * Stop the bridge: unsubscribe, disconnect Redis, destroy all clients.
   */
  async stop(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.punsubscribe();
        await this.subscriber.disconnect();
      } catch {
        // Best effort cleanup
      }
      this.subscriber = null;
    }

    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
    this.keyConnectionCounts.clear();
  }

  /**
   * Add a new client connection. Returns the ClientConnection if accepted,
   * or null if the per-API-key connection limit is exceeded.
   *
   * @param socket - Raw WebSocket connection
   * @param apiKeyId - Validated API key ID from auth middleware
   * @returns ClientConnection or null if limit exceeded (caller closes with 4008)
   */
  addClient(socket: WebSocket, apiKeyId: number): ClientConnection | null {
    const currentCount = this.keyConnectionCounts.get(apiKeyId) ?? 0;
    if (currentCount >= WebSocketBridge.MAX_CONNECTIONS_PER_KEY) {
      return null;
    }

    const connectionId = randomUUID();
    const connection = new ClientConnection({ socket, apiKeyId, connectionId });
    connection.startHeartbeat();

    this.clients.set(connectionId, connection);
    this.keyConnectionCounts.set(apiKeyId, currentCount + 1);

    return connection;
  }

  /**
   * Remove a client connection and clean up.
   */
  removeClient(connectionId: string): void {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    connection.destroy();
    this.clients.delete(connectionId);

    const currentCount = this.keyConnectionCounts.get(connection.apiKeyId) ?? 1;
    if (currentCount <= 1) {
      this.keyConnectionCounts.delete(connection.apiKeyId);
    } else {
      this.keyConnectionCounts.set(connection.apiKeyId, currentCount - 1);
    }
  }

  /**
   * Get current connection count for an API key.
   */
  getConnectionCount(apiKeyId: number): number {
    return this.keyConnectionCounts.get(apiKeyId) ?? 0;
  }

  /**
   * THE CRITICAL RELAY PATH
   *
   * Parse Redis pub/sub messages, transform through IP-protective transformers,
   * and fan out to subscribed clients.
   *
   * This method NEVER throws -- relay failures are logged but do not crash the bridge.
   */
  private handleRedisMessage(channel: string, rawMessage: string): void {
    try {
      // Determine message type from Redis channel pattern
      const candlePrefix = `channel:exchange:${this.exchangeId}:candle:close:`;
      const alertChannel = `channel:alerts:exchange:${this.exchangeId}`;

      if (channel.startsWith(candlePrefix)) {
        this.handleCandleMessage(channel, candlePrefix, rawMessage);
      } else if (channel === alertChannel) {
        this.handleAlertMessage(rawMessage);
      }
    } catch (err) {
      // Relay failures must not crash the bridge
      console.error('[WebSocketBridge] Error handling Redis message:', err);
    }
  }

  /**
   * Handle a candle close event from Redis.
   * Parses the channel to extract symbol/timeframe, transforms the candle,
   * and fans out to subscribed clients.
   */
  private handleCandleMessage(
    channel: string,
    prefix: string,
    rawMessage: string
  ): void {
    // Extract symbol and timeframe from channel
    // Channel format: channel:exchange:{id}:candle:close:{symbol}:{timeframe}
    const suffix = channel.slice(prefix.length);
    const lastColon = suffix.lastIndexOf(':');
    if (lastColon === -1) return;

    const symbol = suffix.slice(0, lastColon);
    const timeframe = suffix.slice(lastColon + 1);
    const externalChannel = `candles:${symbol}:${timeframe}`;

    // Parse and transform through IP-protective whitelist transformer
    const internal = JSON.parse(rawMessage);
    const publicCandle = transformCandle(internal);

    const envelope: WsEnvelope = {
      type: 'candle_close',
      channel: externalChannel,
      data: publicCandle,
    };

    this.fanOut(externalChannel, JSON.stringify(envelope));
  }

  /**
   * Handle an alert event from Redis.
   * Parses the payload, derives generic direction/strength labels,
   * and fans out to subscribed clients.
   *
   * CRITICAL: Proprietary fields (alertType, signalDelta, triggerLabel,
   * triggerValue, sourceExchangeId) are NEVER included in the envelope.
   */
  private handleAlertMessage(rawMessage: string): void {
    const payload: AlertRedisPayload = JSON.parse(rawMessage);
    const externalChannel = `signals:${payload.symbol}:${payload.timeframe}`;

    const envelope: WsEnvelope = {
      type: 'trade_signal',
      channel: externalChannel,
      data: {
        symbol: payload.symbol,
        exchange: this.exchangeName,
        timeframe: payload.timeframe,
        signal_type: 'momentum_signal',
        direction: deriveAlertDirection(payload.triggerLabel),
        strength: deriveAlertStrength(payload.triggerValue),
        price: String(payload.price),
        timestamp: payload.triggeredAt,
      },
    };

    this.fanOut(externalChannel, JSON.stringify(envelope));
  }

  /**
   * Fan out a stringified message to all clients subscribed to the given channel.
   * Message is stringified ONCE, then sent to all matching clients.
   */
  private fanOut(externalChannel: string, stringified: string): void {
    for (const client of this.clients.values()) {
      if (client.hasSubscription(externalChannel)) {
        client.send(stringified);
      }
    }
  }
}
