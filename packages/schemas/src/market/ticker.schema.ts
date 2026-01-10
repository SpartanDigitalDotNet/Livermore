import { z } from 'zod';

/**
 * Real-time ticker data schema
 * Represents current price and 24h statistics for a symbol
 */
export const TickerSchema = z.object({
  /** Trading pair symbol (e.g., 'BTC-USD') */
  symbol: z.string().min(1),
  /** Current price */
  price: z.number().positive(),
  /** 24h price change amount */
  change24h: z.number(),
  /** 24h price change percentage */
  changePercent24h: z.number(),
  /** 24h high price */
  high24h: z.number().positive(),
  /** 24h low price */
  low24h: z.number().positive(),
  /** 24h trading volume */
  volume24h: z.number().nonnegative(),
  /** Best bid price */
  bid: z.number().positive().optional(),
  /** Best ask price */
  ask: z.number().positive().optional(),
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
});

/**
 * WebSocket message for ticker updates
 */
export const TickerUpdateMessageSchema = z.object({
  type: z.literal('ticker'),
  data: TickerSchema,
});

// Export inferred TypeScript types
export type Ticker = z.infer<typeof TickerSchema>;
export type TickerUpdateMessage = z.infer<typeof TickerUpdateMessageSchema>;
