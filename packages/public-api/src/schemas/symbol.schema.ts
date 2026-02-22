import { z } from 'zod';

/**
 * Public symbol schema
 *
 * Exposes trading pair information with simplified liquidity grading.
 * Internal analytics (volume_24h, volume_rank, global_rank, market_cap, coingecko_id,
 * trade_count_24h, liquidity_score) are NOT exposed to protect data sourcing strategy.
 */
export const PublicSymbolSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g. "BTC-USD")'),
  base: z.string().describe('Base currency code (e.g. "BTC")'),
  quote: z.string().describe('Quote currency code (e.g. "USD")'),
  exchange: z.string().describe('Exchange identifier (e.g. "coinbase")'),
  liquidity_grade: z.enum(['high', 'medium', 'low']).describe('Simplified liquidity classification mapped from internal scoring'),
  last_price: z.string().nullable().describe('Latest price as string decimal, or null if unavailable. Example: "67255.43"'),
  volume_24h: z.string().nullable().describe('24-hour trading volume as string decimal, or null if unavailable. Example: "1234567.89"'),
});

export type PublicSymbol = z.infer<typeof PublicSymbolSchema>;

/**
 * Query parameters for symbol list endpoint
 */
export const SymbolQuerySchema = z.object({
  exchange: z.string().optional().describe('Filter symbols by exchange identifier'),
  cursor: z.string().optional().describe('Opaque cursor for pagination'),
  limit: z.coerce.number().int().positive().max(1000).default(100).describe('Maximum symbols to return (1-1000). Default: 100'),
});

export type SymbolQuery = z.infer<typeof SymbolQuerySchema>;
