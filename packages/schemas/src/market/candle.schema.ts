import { z } from 'zod';

/**
 * Timeframe enum - supported candle intervals
 */
export const TimeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d']);
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
