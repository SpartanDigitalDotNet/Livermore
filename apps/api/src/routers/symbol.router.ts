import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { CoinbaseRestClient } from '@livermore/exchange-core';
import { getDbClient, users } from '@livermore/database';
import { eq, and } from 'drizzle-orm';

/**
 * Helper: Normalize symbol format for Coinbase (BASE-QUOTE)
 * Handles common user inputs like "SOLUSD" -> "SOL-USD"
 */
function normalizeSymbol(input: string): string {
  const clean = input.trim().toUpperCase();
  if (clean.includes('-')) return clean;

  // Try to split at common quote currencies
  const quotes = ['USD', 'USDC', 'USDT', 'EUR', 'GBP'];
  for (const quote of quotes) {
    if (clean.endsWith(quote)) {
      return `${clean.slice(0, -quote.length)}-${quote}`;
    }
  }
  return clean;
}

/**
 * Create Coinbase REST client from environment variables
 */
function getCoinbaseClient(): CoinbaseRestClient {
  const apiKeyId = process.env.COINBASE_API_KEY_ID;
  const privateKeyPem = process.env.COINBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!apiKeyId || !privateKeyPem) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Coinbase API credentials not configured',
    });
  }

  return new CoinbaseRestClient(apiKeyId, privateKeyPem);
}

/**
 * Small delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Symbol Router
 *
 * Provides endpoints for Admin UI to search, validate, and preview symbols
 * against the Coinbase exchange before adding to watchlist.
 *
 * All endpoints require Clerk authentication (protectedProcedure).
 *
 * Endpoints:
 * - search: Search available symbols from Coinbase (SYM-04)
 * - validate: Validate a symbol exists and get metrics preview (SYM-03, SYM-06)
 * - metrics: Fetch metrics for multiple symbols (SYM-06)
 */
export const symbolRouter = router({
  /**
   * GET /symbol.search
   *
   * Search available symbols from Coinbase exchange.
   * Filters to online, tradeable products only.
   * Requirement: SYM-04
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(20),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      ctx.logger.debug({ query: input.query, limit: input.limit }, 'Searching symbols');

      const client = getCoinbaseClient();
      const products = await client.getProducts();

      // Filter by query (case-insensitive)
      const query = input.query.toUpperCase();
      const matches = products
        .filter(
          (p: any) =>
            p.product_id?.includes(query) ||
            p.base_display_symbol?.toUpperCase().includes(query)
        )
        .filter((p: any) => p.status === 'online' && !p.trading_disabled)
        .slice(0, input.limit)
        .map((p: any) => ({
          symbol: p.product_id,
          baseName: p.base_name,
          quoteName: p.quote_name,
        }));

      ctx.logger.debug({ matchCount: matches.length }, 'Symbol search complete');

      return { results: matches, exchange: 'coinbase' };
    }),

  /**
   * GET /symbol.validate
   *
   * Validate a symbol exists on Coinbase and get metrics preview.
   * Handles symbol normalization (e.g., "SOLUSD" -> "SOL-USD").
   * Requirement: SYM-03 (validation), SYM-06 (metrics preview)
   */
  validate: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const normalizedSymbol = normalizeSymbol(input.symbol);
      ctx.logger.debug({ input: input.symbol, normalized: normalizedSymbol }, 'Validating symbol');

      const client = getCoinbaseClient();

      try {
        const product = await client.getProduct(normalizedSymbol);

        // Check if trading is enabled
        if (product.trading_disabled || product.status !== 'online') {
          ctx.logger.debug({ symbol: normalizedSymbol }, 'Symbol not available for trading');
          return {
            valid: false,
            symbol: normalizedSymbol,
            error: 'Symbol is not available for trading',
          };
        }

        ctx.logger.debug({ symbol: normalizedSymbol }, 'Symbol validated successfully');

        return {
          valid: true,
          symbol: normalizedSymbol,
          metrics: {
            price: product.price,
            priceChange24h: product.price_percentage_change_24h,
            volume24h: product.volume_24h,
            baseName: product.base_name,
            quoteName: product.quote_name,
          },
        };
      } catch (error) {
        ctx.logger.debug({ symbol: normalizedSymbol, error }, 'Symbol not found on exchange');
        return {
          valid: false,
          symbol: normalizedSymbol,
          error: 'Symbol not found on exchange',
        };
      }
    }),

  /**
   * GET /symbol.metrics
   *
   * Fetch metrics for multiple symbols (convenience endpoint).
   * Respects rate limits with 100ms delay between calls.
   * Requirement: SYM-06
   */
  metrics: protectedProcedure
    .input(
      z.object({
        symbols: z.array(z.string()).min(1).max(20),
      })
    )
    .query(async ({ ctx, input }) => {
      ctx.logger.debug({ symbolCount: input.symbols.length }, 'Fetching metrics for symbols');

      const client = getCoinbaseClient();
      const results: Array<
        | { symbol: string; price: string; priceChange24h: string; volume24h: string }
        | { symbol: string; error: string }
      > = [];

      for (const rawSymbol of input.symbols) {
        const symbol = normalizeSymbol(rawSymbol);

        try {
          const product = await client.getProduct(symbol);

          if (product.trading_disabled || product.status !== 'online') {
            results.push({ symbol, error: 'Symbol not available for trading' });
          } else {
            results.push({
              symbol,
              price: product.price,
              priceChange24h: product.price_percentage_change_24h,
              volume24h: product.volume_24h,
            });
          }
        } catch (error) {
          results.push({ symbol, error: 'Symbol not found on exchange' });
        }

        // Rate limit: 100ms delay between calls
        if (input.symbols.indexOf(rawSymbol) < input.symbols.length - 1) {
          await delay(100);
        }
      }

      ctx.logger.debug(
        {
          total: results.length,
          success: results.filter((r) => !('error' in r)).length,
        },
        'Metrics fetch complete'
      );

      return results;
    }),

  /**
   * GET /symbol.bulkValidate
   *
   * Validate multiple symbols for bulk import.
   * Returns validation status for each: valid, invalid, or duplicate.
   * Implements delta-based validation - skips symbols already in user's list.
   *
   * Requirement: SYM-05 (bulk import), SYM-03 (delta validation)
   */
  bulkValidate: protectedProcedure
    .input(
      z.object({
        symbols: z.array(z.string()).min(1).max(50),
      })
    )
    .query(async ({ ctx, input }) => {
      ctx.logger.debug({ symbolCount: input.symbols.length }, 'Bulk validating symbols');

      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      // Get user's current symbols for delta calculation
      const [user] = await db
        .select({ settings: users.settings })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      const existing = new Set<string>(
        ((user.settings as Record<string, unknown>)?.symbols as string[]) ?? []
      );

      const client = getCoinbaseClient();

      // Validate each symbol
      type ValidationResult = {
        symbol: string;
        status: 'valid' | 'invalid' | 'duplicate';
        metrics?: {
          price: string;
          volume24h: string;
          priceChange24h: string;
          baseName: string;
          quoteName: string;
        };
        error?: string;
      };

      const results: ValidationResult[] = [];

      for (const rawSymbol of input.symbols) {
        const symbol = normalizeSymbol(rawSymbol);

        // Check duplicates first (no API call needed)
        if (existing.has(symbol)) {
          results.push({ symbol, status: 'duplicate' });
          continue;
        }

        // Validate against exchange
        try {
          const product = await client.getProduct(symbol);

          if (product.trading_disabled || product.status !== 'online') {
            results.push({
              symbol,
              status: 'invalid',
              error: 'Symbol not available for trading',
            });
          } else {
            results.push({
              symbol,
              status: 'valid',
              metrics: {
                price: product.price || '0',
                volume24h: product.volume_24h || '0',
                priceChange24h: product.price_percentage_change_24h || '0',
                baseName: product.base_name || '',
                quoteName: product.quote_name || '',
              },
            });
          }
        } catch {
          results.push({
            symbol,
            status: 'invalid',
            error: 'Symbol not found on exchange',
          });
        }

        // Rate limit: 100ms delay between API calls (safe for 10 req/sec limit)
        if (input.symbols.indexOf(rawSymbol) < input.symbols.length - 1) {
          await delay(100);
        }
      }

      ctx.logger.debug(
        {
          total: results.length,
          valid: results.filter((r) => r.status === 'valid').length,
          invalid: results.filter((r) => r.status === 'invalid').length,
          duplicate: results.filter((r) => r.status === 'duplicate').length,
        },
        'Bulk validation complete'
      );

      return {
        results,
        summary: {
          valid: results.filter((r) => r.status === 'valid').length,
          invalid: results.filter((r) => r.status === 'invalid').length,
          duplicate: results.filter((r) => r.status === 'duplicate').length,
          total: results.length,
        },
      };
    }),
});

export type SymbolRouter = typeof symbolRouter;
