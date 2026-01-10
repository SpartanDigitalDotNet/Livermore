import { z } from 'zod';

/**
 * Individual order in the orderbook
 */
export const OrderSchema = z.object({
  /** Price level */
  price: z.number().positive(),
  /** Size/quantity at this price level */
  size: z.number().positive(),
  /** Number of orders at this price level (optional) */
  numOrders: z.number().int().positive().optional(),
});

/**
 * Orderbook snapshot schema
 * Contains bids and asks at various price levels
 */
export const OrderbookSchema = z.object({
  /** Trading pair symbol (e.g., 'BTC-USD') */
  symbol: z.string().min(1),
  /** Bid orders (buy side), sorted by price descending */
  bids: z.array(OrderSchema),
  /** Ask orders (sell side), sorted by price ascending */
  asks: z.array(OrderSchema),
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
});

/**
 * Orderbook update (incremental) schema
 */
export const OrderbookUpdateSchema = z.object({
  /** Trading pair symbol */
  symbol: z.string().min(1),
  /** Side of the update */
  side: z.enum(['bid', 'ask']),
  /** Price level being updated */
  price: z.number().positive(),
  /** New size at this price level (0 means remove) */
  size: z.number().nonnegative(),
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
});

/**
 * Orderbook "wall" detection schema
 * Represents a significant price level with large orders
 */
export const OrderbookWallSchema = z.object({
  /** Trading pair symbol */
  symbol: z.string().min(1),
  /** Side of the wall */
  side: z.enum(['bid', 'ask']),
  /** Price level of the wall */
  price: z.number().positive(),
  /** Total size at this wall */
  size: z.number().positive(),
  /** Percentage of total orderbook volume */
  percentOfTotal: z.number().positive(),
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
});

/**
 * WebSocket message for orderbook updates
 */
export const OrderbookUpdateMessageSchema = z.object({
  type: z.literal('orderbook'),
  data: OrderbookUpdateSchema,
});

/**
 * WebSocket message for orderbook snapshot
 */
export const OrderbookSnapshotMessageSchema = z.object({
  type: z.literal('orderbook_snapshot'),
  data: OrderbookSchema,
});

// Export inferred TypeScript types
export type Order = z.infer<typeof OrderSchema>;
export type Orderbook = z.infer<typeof OrderbookSchema>;
export type OrderbookUpdate = z.infer<typeof OrderbookUpdateSchema>;
export type OrderbookWall = z.infer<typeof OrderbookWallSchema>;
export type OrderbookUpdateMessage = z.infer<typeof OrderbookUpdateMessageSchema>;
export type OrderbookSnapshotMessage = z.infer<typeof OrderbookSnapshotMessageSchema>;
