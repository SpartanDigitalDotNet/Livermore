import { z } from 'zod';
import { EventEmitter } from 'events';
import { CandleSchema, Timeframe } from '../market/candle.schema';

/**
 * UnifiedCandle schema - extends base CandleSchema with exchange-specific metadata
 *
 * Purpose: Provides a common candle format that any exchange adapter can produce,
 * allowing the indicator service to work with candles from any exchange without
 * knowing exchange-specific details.
 */
export const UnifiedCandleSchema = CandleSchema.extend({
  /** Exchange identifier (e.g., 'coinbase', 'binance') */
  exchange: z.string().min(1),
  /** Original exchange timestamp for debugging (ISO string) */
  exchangeTimestamp: z.string().optional(),
  /** Sequence number from WebSocket for gap detection */
  sequenceNum: z.number().int().nonnegative().optional(),
});

/** TypeScript type inferred from UnifiedCandleSchema */
export type UnifiedCandle = z.infer<typeof UnifiedCandleSchema>;

/**
 * Event map for typed EventEmitter (Node 20+)
 *
 * Defines all events that an exchange adapter can emit:
 * - candle:close - Emitted when a candle closes, contains the completed candle
 * - connected - Emitted when WebSocket connection is established
 * - disconnected - Emitted when connection is lost, includes reason
 * - error - Emitted on errors, contains Error object
 * - reconnecting - Emitted during reconnection attempts, includes attempt number and delay
 */
export type ExchangeAdapterEvents = {
  'candle:close': [candle: UnifiedCandle];
  'connected': [];
  'disconnected': [reason: string];
  'error': [error: Error];
  'reconnecting': [attempt: number, delay: number];
};

/**
 * IExchangeAdapter interface - contract for all exchange adapters
 *
 * Extends Node.js EventEmitter with typed events for type-safe event handling.
 * All exchange adapters (Coinbase, Binance, etc.) must implement this interface.
 *
 * Lifecycle:
 * 1. Create adapter instance
 * 2. Call connect() to establish WebSocket connection
 * 3. Call subscribe() to start receiving candle updates
 * 4. Handle 'candle:close' events as candles complete
 * 5. Call unsubscribe() / disconnect() when done
 */
export interface IExchangeAdapter extends EventEmitter<ExchangeAdapterEvents> {
  /** Establish connection to exchange WebSocket */
  connect(): Promise<void>;

  /** Gracefully close connection */
  disconnect(): void;

  /** Subscribe to candle updates for symbols at specified timeframe */
  subscribe(symbols: string[], timeframe: Timeframe): void;

  /** Unsubscribe from candle updates for symbols at specified timeframe */
  unsubscribe(symbols: string[], timeframe: Timeframe): void;

  /** Check if currently connected to the exchange */
  isConnected(): boolean;
}
