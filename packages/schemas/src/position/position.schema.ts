import { z } from 'zod';

/**
 * Individual position schema
 * Represents a single asset holding with P&L calculations
 */
export const PositionSchema = z.object({
  /** Asset symbol (e.g., 'BTC', 'ETH') */
  symbol: z.string().min(1),
  /** Display name (e.g., 'Bitcoin', 'Ethereum') */
  displayName: z.string().min(1),
  /** Total quantity held */
  quantity: z.number().nonnegative(),
  /** Quantity available (not on hold) */
  availableQuantity: z.number().nonnegative(),
  /** Total cost basis in USD */
  costBasis: z.number().nonnegative(),
  /** Current market price per unit */
  currentPrice: z.number().nonnegative(),
  /** Current total value (quantity * currentPrice) */
  currentValue: z.number().nonnegative(),
  /** Unrealized P&L in USD (currentValue - costBasis) */
  unrealizedPnL: z.number(),
  /** Unrealized P&L as percentage */
  unrealizedPnLPercent: z.number(),
  /** Last updated timestamp (Unix ms) */
  lastUpdated: z.number().int().positive(),
});

/**
 * Portfolio summary schema
 * Aggregates all positions with total P&L
 */
export const PortfolioSchema = z.object({
  /** Total portfolio value in USD */
  totalValue: z.number().nonnegative(),
  /** Total cost basis in USD */
  totalCostBasis: z.number().nonnegative(),
  /** Total unrealized P&L in USD */
  totalPnL: z.number(),
  /** Total unrealized P&L as percentage */
  totalPnLPercent: z.number(),
  /** All positions */
  positions: z.array(PositionSchema),
  /** Last sync timestamp (Unix ms) */
  lastSynced: z.number().int().positive(),
});

/**
 * Position sync request input
 */
export const PositionSyncInputSchema = z.object({
  /** Optional: only sync specific symbols */
  symbols: z.array(z.string()).optional(),
});

/**
 * Position query by symbol input
 */
export const PositionBySymbolInputSchema = z.object({
  symbol: z.string().min(1),
});

// Export inferred TypeScript types
export type Position = z.infer<typeof PositionSchema>;
export type Portfolio = z.infer<typeof PortfolioSchema>;
export type PositionSyncInput = z.infer<typeof PositionSyncInputSchema>;
export type PositionBySymbolInput = z.infer<typeof PositionBySymbolInputSchema>;
