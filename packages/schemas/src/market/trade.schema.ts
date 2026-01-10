import { z } from 'zod';

/**
 * Individual trade/match schema
 * Represents a single executed trade
 */
export const TradeSchema = z.object({
  /** Unique trade ID */
  id: z.string().min(1),
  /** Trading pair symbol (e.g., 'BTC-USD') */
  symbol: z.string().min(1),
  /** Trade price */
  price: z.number().positive(),
  /** Trade size/quantity */
  size: z.number().positive(),
  /** Side of the trade (maker perspective) */
  side: z.enum(['buy', 'sell']),
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
});

/**
 * WebSocket message for trade updates
 */
export const TradeUpdateMessageSchema = z.object({
  type: z.literal('trade'),
  data: TradeSchema,
});

// Export inferred TypeScript types
export type Trade = z.infer<typeof TradeSchema>;
export type TradeUpdateMessage = z.infer<typeof TradeUpdateMessageSchema>;
