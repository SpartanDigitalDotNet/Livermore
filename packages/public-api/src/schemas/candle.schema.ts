import { z } from 'zod';

/**
 * Public candle schema - EXPLICIT WHITELIST ONLY
 *
 * CRITICAL: Only these 6 fields are exposed publicly.
 * Internal fields (macdV, fastEMA, slowEMA, atr, informativeATR, isSynthetic, sequenceNum)
 * are NEVER included to protect proprietary IP.
 */
export const PublicCandleSchema = z.object({
  timestamp: z.string().describe('ISO 8601 timestamp of candle open time. Example: 2026-02-18T12:00:00.000Z'),
  open: z.string().describe('Opening price as string decimal. Example: "42350.50"'),
  high: z.string().describe('Highest price during period as string decimal. Example: "42450.75"'),
  low: z.string().describe('Lowest price during period as string decimal. Example: "42300.25"'),
  close: z.string().describe('Closing price as string decimal. Example: "42400.00"'),
  volume: z.string().describe('Trading volume as string decimal. Example: "123.456"'),
});

export type PublicCandle = z.infer<typeof PublicCandleSchema>;

/**
 * Timeframe enum for public API
 * Maps to internal Timeframe type from @livermore/schemas
 */
export const PublicTimeframeSchema = z.enum([
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

export type PublicTimeframe = z.infer<typeof PublicTimeframeSchema>;

/**
 * URL path parameters for candle endpoints
 * Example: GET /api/v1/candles/:exchange/:symbol/:timeframe
 */
export const CandleParamsSchema = z.object({
  exchange: z.string().min(1).describe('Exchange identifier (e.g. "coinbase")'),
  symbol: z.string().min(1).describe('Trading pair symbol (e.g. "BTC-USD")'),
  timeframe: PublicTimeframeSchema.describe('Candle timeframe interval'),
});

export type CandleParams = z.infer<typeof CandleParamsSchema>;

/**
 * Query parameters for candle endpoints
 * Supports cursor-based pagination and time filtering
 */
export const CandleQuerySchema = z.object({
  cursor: z.string().optional().describe('Opaque cursor for pagination. Omit for first page.'),
  limit: z.coerce.number().int().positive().max(1000).default(100).describe('Maximum candles to return (1-1000). Default: 100'),
  start_time: z.string().datetime().optional().describe('Filter candles after this ISO 8601 timestamp'),
  end_time: z.string().datetime().optional().describe('Filter candles before this ISO 8601 timestamp'),
});

export type CandleQuery = z.infer<typeof CandleQuerySchema>;
