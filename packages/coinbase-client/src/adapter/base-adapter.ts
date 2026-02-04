import { EventEmitter } from 'events';
import { logger } from '@livermore/utils';
import type { ExchangeAdapterEvents, IExchangeAdapter, Timeframe } from '@livermore/schemas';

/**
 * Abstract base class for exchange adapters
 *
 * Provides shared infrastructure for all exchange implementations:
 * - Typed event emission (candle:close, connected, disconnected, error, reconnecting)
 * - Exponential backoff reconnection logic
 * - Connection state tracking
 *
 * Concrete adapters (CoinbaseAdapter, BinanceAdapter) extend this class
 * and implement the abstract methods.
 */
export abstract class BaseExchangeAdapter
  extends EventEmitter<ExchangeAdapterEvents>
  implements IExchangeAdapter
{
  /** Current reconnection attempt counter */
  protected reconnectAttempts = 0;

  /** Maximum reconnection attempts before giving up */
  protected maxReconnectAttempts = 100;

  /** Base delay between reconnection attempts (ms) */
  protected reconnectDelay = 5000;

  /** Maximum delay between reconnection attempts (ms) - caps exponential backoff */
  protected maxReconnectDelay = 300000; // 5 minutes

  /** Exchange identifier for logging and UnifiedCandle.exchange field */
  protected abstract readonly exchangeId: string;

  /**
   * Establish connection to exchange WebSocket
   * Implementations should:
   * 1. Create WebSocket connection
   * 2. Set up message handlers
   * 3. Emit 'connected' event on success
   * 4. Call handleReconnect() on unexpected disconnect
   */
  abstract connect(): Promise<void>;

  /**
   * Gracefully close connection
   * Implementations should:
   * 1. Set intentional close flag to prevent auto-reconnect
   * 2. Close WebSocket connection
   * 3. Emit 'disconnected' event with reason
   */
  abstract disconnect(): void;

  /**
   * Subscribe to candle updates for symbols
   * @param symbols Array of trading pairs (e.g., ['BTC-USD', 'ETH-USD'])
   * @param timeframe Candle timeframe (e.g., '5m')
   */
  abstract subscribe(symbols: string[], timeframe: Timeframe): void;

  /**
   * Unsubscribe from candle updates
   * @param symbols Array of trading pairs to unsubscribe
   * @param timeframe Candle timeframe
   */
  abstract unsubscribe(symbols: string[], timeframe: Timeframe): void;

  /**
   * Check if currently connected to exchange
   */
  abstract isConnected(): boolean;

  /**
   * Handle reconnection with exponential backoff
   *
   * Call this from concrete adapter's close/error handlers when
   * disconnection was unexpected (not intentional close).
   *
   * Emits 'reconnecting' event before each attempt.
   * Emits 'error' event if max attempts reached.
   */
  protected async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const error = new Error(
        `Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${this.exchangeId}`
      );
      logger.error({ exchangeId: this.exchangeId }, error.message);
      // Only emit error if there are listeners (prevents unhandled error crash)
      if (this.listenerCount('error') > 0) {
        this.emit('error', error);
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    logger.info(
      { exchangeId: this.exchangeId, attempt: this.reconnectAttempts, delay },
      'Attempting to reconnect to exchange WebSocket'
    );

    this.emit('reconnecting', this.reconnectAttempts, delay);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
      // Reset counter on successful reconnect
      this.reconnectAttempts = 0;
    } catch (error) {
      logger.error(
        { exchangeId: this.exchangeId, error, attempt: this.reconnectAttempts },
        'Reconnection attempt failed'
      );
      // Recursive call for next attempt
      await this.handleReconnect();
    }
  }

  /**
   * Reset reconnection counter
   * Call this after successful connection in concrete adapter
   */
  protected resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}
