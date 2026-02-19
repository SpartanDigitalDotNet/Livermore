import { z } from 'zod';

/**
 * Public exchange schema
 *
 * Exposes only user-facing exchange information.
 * Internal operational data (ws_url, rest_url, api_limits, fee_schedule, geo_restrictions)
 * is NOT exposed to protect infrastructure details.
 */
export const PublicExchangeSchema = z.object({
  id: z.string().describe('Exchange identifier string (e.g. "coinbase")'),
  name: z.string().describe('Human-readable exchange name (e.g. "Coinbase Advanced Trade")'),
  status: z.enum(['online', 'offline']).describe('Current operational status derived from Redis instance registry'),
  symbol_count: z.number().int().nonnegative().describe('Number of trading pairs available on this exchange'),
});

export type PublicExchange = z.infer<typeof PublicExchangeSchema>;

/**
 * Query parameters for exchange list endpoint
 */
export const ExchangeQuerySchema = z.object({
  cursor: z.string().optional().describe('Opaque cursor for pagination'),
  limit: z.coerce.number().int().positive().max(100).default(50).describe('Maximum exchanges to return (1-100). Default: 50'),
});

export type ExchangeQuery = z.infer<typeof ExchangeQuerySchema>;
