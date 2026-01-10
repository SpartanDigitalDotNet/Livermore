import WebSocket from 'ws';
import { logger } from '@livermore/utils';
import { CoinbaseAuth } from '../rest/auth';

/**
 * Ticker event from Coinbase Advanced Trade WebSocket
 */
export interface CoinbaseTickerEvent {
  type: 'ticker';
  product_id: string;
  price: string;
  volume_24_h: string;
  low_24_h: string;
  high_24_h: string;
  low_52_w: string;
  high_52_w: string;
  price_percent_chg_24_h: string;
  best_bid: string;
  best_ask: string;
  best_bid_quantity: string;
  best_ask_quantity: string;
}

/**
 * L2 update from Coinbase Advanced Trade WebSocket
 */
export interface CoinbaseL2Update {
  side: 'bid' | 'offer';
  event_time: string;
  price_level: string;
  new_quantity: string;
}

/**
 * Message types from Coinbase Advanced Trade WebSocket
 */
export type CoinbaseWSMessage =
  | { channel: 'subscriptions'; events: Array<{ subscriptions: Record<string, string[]> }> }
  | { channel: 'ticker'; timestamp: string; sequence_num: number; events: Array<{ type: 'update'; tickers: CoinbaseTickerEvent[] }> }
  | { channel: 'l2_data'; timestamp: string; sequence_num: number; events: Array<{ type: 'update' | 'snapshot'; product_id: string; updates: CoinbaseL2Update[] }> }
  | { channel: 'error'; message: string };

export type MessageHandler = (message: CoinbaseWSMessage) => void | Promise<void>;

/**
 * Coinbase WebSocket client for real-time market data
 *
 * Subscribes to ticker, level2 (orderbook), and matches (trades) channels
 * Reference: https://docs.cdp.coinbase.com/advanced-trade/docs/ws-overview
 */
export class CoinbaseWebSocketClient {
  private ws: WebSocket | null = null;
  private wsUrl = 'wss://advanced-trade-ws.coinbase.com';
  private auth: CoinbaseAuth;
  private reconnectDelay = 5000; // 5 seconds
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private messageHandlers: MessageHandler[] = [];
  private subscribedChannels: Set<string> = new Set();
  private subscribedProducts: Set<string> = new Set();
  private isIntentionalClose = false;

  constructor(apiKeyId: string, privateKeyPem: string) {
    this.auth = new CoinbaseAuth(apiKeyId, privateKeyPem);
  }

  /**
   * Connect to Coinbase WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('Connecting to Coinbase WebSocket...');

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        logger.info('Connected to Coinbase WebSocket');
        this.reconnectAttempts = 0;

        // Resubscribe to channels if reconnecting
        if (this.subscribedChannels.size > 0) {
          this.resubscribe();
        }

        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as CoinbaseWSMessage;
          this.handleMessage(message);
        } catch (error) {
          logger.error({ error, data: data.toString() }, 'Failed to parse WebSocket message');
        }
      });

      this.ws.on('error', (error) => {
        logger.error({ error }, 'WebSocket error');
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        logger.warn({ code, reason: reason.toString() }, 'WebSocket connection closed');

        if (!this.isIntentionalClose) {
          this.handleReconnect();
        }
      });
    });
  }

  /**
   * Subscribe to channels for specific products
   * Public channels (ticker, level2, candles, market_trades) don't require JWT
   * Private channels (user, futures_balance_summary) require JWT
   */
  subscribe(channels: string[], products: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    logger.info({ channels, products }, 'Subscribing to Coinbase channels');

    // Subscribe to each channel separately with JWT
    for (const channel of channels) {
      const token = this.auth.generateToken();

      const subscribeMessage = {
        type: 'subscribe',
        product_ids: products,
        channel: channel,
        jwt: token,
      };

      this.ws.send(JSON.stringify(subscribeMessage));
      this.subscribedChannels.add(channel);
    }

    // Track products for reconnection
    products.forEach(p => this.subscribedProducts.add(p));
  }

  /**
   * Unsubscribe from channels
   */
  unsubscribe(channels: string[], products: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    logger.info({ channels, products }, 'Unsubscribing from Coinbase channels');

    // Unsubscribe from each channel separately
    for (const channel of channels) {
      const token = this.auth.generateToken();

      const unsubscribeMessage = {
        type: 'unsubscribe',
        product_ids: products,
        channel: channel,
        jwt: token,
      };

      this.ws.send(JSON.stringify(unsubscribeMessage));
      this.subscribedChannels.delete(channel);
    }

    // Remove products from tracking
    products.forEach(p => this.subscribedProducts.delete(p));
  }

  /**
   * Add message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Close WebSocket connection
   */
  close(): void {
    if (this.ws) {
      this.isIntentionalClose = true;
      this.ws.close();
      this.ws = null;
      logger.info('WebSocket connection closed intentionally');
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: CoinbaseWSMessage): void {
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

    // Forward to all handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        logger.error({ error, message }, 'Error in message handler');
      }
    });
  }

  /**
   * Resubscribe to all channels after reconnection
   */
  private resubscribe(): void {
    if (this.subscribedChannels.size === 0) return;

    const channels = Array.from(this.subscribedChannels);
    const products = Array.from(this.subscribedProducts);

    logger.info({ channels, products }, 'Resubscribing to channels after reconnection');

    this.subscribe(channels, products);
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached, giving up');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(
      { attempt: this.reconnectAttempts, delay },
      'Attempting to reconnect to WebSocket...'
    );

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (error) {
      logger.error({ error }, 'Reconnection failed');
      this.handleReconnect();
    }
  }
}
