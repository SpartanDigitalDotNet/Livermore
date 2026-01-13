import { z } from 'zod';

/**
 * Timeframe enum - canonical candle intervals supported across exchanges
 *
 * Note: Not all exchanges support all timeframes. Each exchange adapter
 * should map these canonical timeframes to exchange-specific formats
 * and handle unsupported timeframes gracefully.
 *
 * Supported by most exchanges:
 * - 1m, 5m, 15m, 30m, 1h, 4h, 1d
 *
 * Exchange-specific:
 * - 2h, 6h: Coinbase (no 4h, has 2h/6h instead)
 * - 12h, 1w, 1M: Binance, others (future support)
 */
export const TimeframeSchema = z.enum([
  '1m',   // 1 minute
  '5m',   // 5 minutes
  '15m',  // 15 minutes
  '30m',  // 30 minutes
  '1h',   // 1 hour
  '2h',   // 2 hours
  '4h',   // 4 hours
  '6h',   // 6 hours
  '1d',   // 1 day
]);
export type Timeframe = z.infer<typeof TimeframeSchema>;

/**
 * Candle (OHLCV) data schema
 * Represents a single candlestick with open, high, low, close, and volume
 */
export const CandleSchema = z.object({
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
  /** Opening price */
  open: z.number().positive(),
  /** Highest price during period */
  high: z.number().positive(),
  /** Lowest price during period */
  low: z.number().positive(),
  /** Closing price */
  close: z.number().positive(),
  /** Trading volume */
  volume: z.number().nonnegative(),
  /** Trading pair symbol (e.g., 'BTC-USD') */
  symbol: z.string().min(1),
  /** Candle timeframe */
  timeframe: TimeframeSchema,
  /** True if this candle was forward-filled due to missing trades (in-memory only, not persisted) */
  isSynthetic: z.boolean().optional(),
});

/**
 * Array of candles
 */
export const CandleArraySchema = z.array(CandleSchema);

/**
 * WebSocket message for candle updates
 */
export const CandleUpdateMessageSchema = z.object({
  type: z.literal('candle'),
  data: CandleSchema,
});

/**
 * Request schema for fetching historical candles
 */
export const GetCandlesRequestSchema = z.object({
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
  /** Optional start time (unix timestamp in ms) */
  start: z.number().int().positive().optional(),
  /** Optional end time (unix timestamp in ms) */
  end: z.number().int().positive().optional(),
  /** Maximum number of candles to return */
  limit: z.number().int().positive().max(1000).default(300),
});

// Export inferred TypeScript types
export type Candle = z.infer<typeof CandleSchema>;
export type CandleArray = z.infer<typeof CandleArraySchema>;
export type CandleUpdateMessage = z.infer<typeof CandleUpdateMessageSchema>;
export type GetCandlesRequest = z.infer<typeof GetCandlesRequestSchema>;
