/**
 * WebSocket protocol types for the public API streaming interface.
 *
 * Defines message envelopes, client actions, and channel parsing.
 * External channel format: `candles:BTC-USD:1h` or `signals:ETH-USD:15m`
 */

/** Valid timeframes for WebSocket channel subscriptions */
export const VALID_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type ValidTimeframe = (typeof VALID_TIMEFRAMES)[number];

/** Server-to-client message types */
export type WsMessageType =
  | 'candle_close'
  | 'trade_signal'
  | 'subscribed'
  | 'unsubscribed'
  | 'error';

/** Server-to-client message envelope */
export interface WsEnvelope {
  type: WsMessageType;
  channel?: string;
  data?: unknown;
  channels?: string[];
  code?: string;
  message?: string;
}

/** Client-to-server action types */
export type ClientAction = 'subscribe' | 'unsubscribe';

/** Client-to-server message shape */
export interface ClientMessage {
  action: ClientAction;
  channels: string[];
}

/** Channel type discriminator */
export type ChannelType = 'candle' | 'signal';

/** Parsed external channel */
export interface ParsedChannel {
  type: ChannelType;
  symbol: string;
  timeframe: string;
}

/** Symbol format: letters/digits + hyphen (e.g. BTC-USD, ETH-BTC) */
const SYMBOL_PATTERN = /^[A-Za-z0-9]+-[A-Za-z0-9]+$/;

/** Channel type prefix to ChannelType mapping */
const CHANNEL_PREFIX_MAP: Record<string, ChannelType> = {
  candles: 'candle',
  signals: 'signal',
};

/**
 * Parse an external channel string into its components.
 *
 * Valid formats:
 * - `candles:BTC-USD:1h`
 * - `signals:ETH-USD:15m`
 *
 * Returns null for invalid formats, unknown prefixes, bad symbols, or unsupported timeframes.
 */
export function mapExternalChannel(external: string): ParsedChannel | null {
  const parts = external.split(':');
  if (parts.length !== 3) return null;

  const [prefix, symbol, timeframe] = parts;

  const channelType = CHANNEL_PREFIX_MAP[prefix];
  if (!channelType) return null;

  if (!SYMBOL_PATTERN.test(symbol)) return null;

  if (!(VALID_TIMEFRAMES as readonly string[]).includes(timeframe)) return null;

  return { type: channelType, symbol, timeframe };
}
