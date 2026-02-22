import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getRedisClient, tickerKey } from '@livermore/cache';
import { getDbClient, exchanges, exchangeSymbols } from '@livermore/database';
import { eq, and, gt } from 'drizzle-orm';
import {
  PublicSymbolSchema,
  SymbolQuerySchema,
  createEnvelopeSchema,
} from '../schemas/index.js';
import { buildPaginationMeta, decodeCursor } from '../helpers/index.js';
import type { PublicSymbol } from '../schemas/symbol.schema.js';

/**
 * Symbol route handler - GET /public/v1/symbols
 *
 * Returns list of trading pairs (symbols) with liquidity grading.
 * Supports filtering by exchange and cursor-based pagination.
 *
 * Does NOT expose: id, volume_24h, volume_rank, global_rank, market_cap,
 * coingecko_id, trade_count_24h, liquidity_score (internal metrics).
 */
export const symbolsRoute: FastifyPluginAsyncZod = async (fastify) => {
  const db = getDbClient();
  const redis = getRedisClient();

  /**
   * Map internal liquidity_score (0.0-1.0) to public liquidity_grade enum.
   *
   * Aligned with internal grade boundaries (A/B/C):
   * - >= 0.6: 'high'   (matches internal A grade)
   * - >= 0.3: 'medium' (between B and C)
   * - < 0.3 or null: 'low'
   *
   * Note: liquidityScore from database is a string (numeric type).
   * The scoring service uses relative log-scaling where even BTC scores ~0.4-0.6.
   */
  function mapLiquidityGrade(score: string | null): 'high' | 'medium' | 'low' {
    if (score === null) return 'low';
    const numericScore = parseFloat(score);
    if (isNaN(numericScore)) return 'low';
    if (numericScore >= 0.6) return 'high';
    if (numericScore >= 0.3) return 'medium';
    return 'low';
  }

  fastify.get(
    '/',
    {
      schema: {
        description: `List all available trading pairs (symbols) across supported exchanges with liquidity grading.

This endpoint provides a comprehensive catalog of cryptocurrency trading pairs, including base/quote currency pairs and simplified liquidity classifications. Use this to discover tradable markets, filter symbols by exchange, or identify high-liquidity pairs for optimal execution.

**Liquidity grade:** A simplified classification (high, medium, low) derived from internal market analytics including 24-hour trading volume, order book depth, and trade frequency. High-liquidity pairs typically offer tighter spreads and better execution for automated trading strategies.

**Filtering:** Optionally filter symbols to a specific exchange using the \`exchange\` query parameter. Omit to retrieve symbols from all exchanges.

**Pagination:** Use cursor-based pagination for efficient iteration through large result sets. The \`next_cursor\` value in the response should be passed as the \`cursor\` query parameter to fetch the next page.`,
        tags: ['Symbols'],
        querystring: SymbolQuerySchema,
        response: {
          200: createEnvelopeSchema(z.array(PublicSymbolSchema)),
        },
      },
    },
    async (request, reply) => {
      const { exchange: exchangeFilter, cursor, limit } = request.query;

      // Resolve exchange filter to ID if provided
      let filterExchangeId: number | null = null;
      if (exchangeFilter) {
        const [exchange] = await db
          .select({ id: exchanges.id })
          .from(exchanges)
          .where(and(eq(exchanges.name, exchangeFilter), eq(exchanges.isActive, true)))
          .limit(1);

        if (!exchange) {
          return (reply as any).code(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: `Exchange "${exchangeFilter}" not found or inactive`,
            },
          });
        }

        filterExchangeId = exchange.id;
      }

      // Decode cursor if provided (cursor encodes last symbol ID for stable ordering)
      let cursorId = 0;
      if (cursor) {
        try {
          cursorId = decodeCursor(cursor);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid cursor';
          return (reply as any).code(400).send({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message,
            },
          });
        }
      }

      // Query symbols with pagination
      // Fetch limit + 1 to detect if more results exist
      const conditions = [eq(exchangeSymbols.isActive, true)];
      if (filterExchangeId !== null) {
        conditions.push(eq(exchangeSymbols.exchangeId, filterExchangeId));
      }
      if (cursorId > 0) {
        conditions.push(gt(exchangeSymbols.id, cursorId));
      }

      const rows = await db
        .select({
          id: exchangeSymbols.id,
          symbol: exchangeSymbols.symbol,
          baseCurrency: exchangeSymbols.baseCurrency,
          quoteCurrency: exchangeSymbols.quoteCurrency,
          liquidityScore: exchangeSymbols.liquidityScore,
          exchangeId: exchangeSymbols.exchangeId,
          exchangeName: exchanges.name,
        })
        .from(exchangeSymbols)
        .innerJoin(exchanges, eq(exchangeSymbols.exchangeId, exchanges.id))
        .where(and(...conditions))
        .orderBy(exchangeSymbols.id) // Stable ordering by primary key
        .limit(limit + 1); // Fetch one extra to detect has_more

      // Detect if more results exist
      const hasMore = rows.length > limit;
      const results = hasMore ? rows.slice(0, limit) : rows;

      // Batch-fetch ticker data from Redis for price/volume enrichment
      const tickerDataMap = new Map<string, { price: string | null; volume: string | null }>();
      await Promise.all(
        results.map(async (row) => {
          const mapKey = `${row.exchangeId}:${row.symbol}`;
          try {
            const raw = await redis.get(tickerKey(row.exchangeId, row.symbol));
            if (raw) {
              const ticker = JSON.parse(raw);
              tickerDataMap.set(mapKey, {
                price: ticker.price?.toString() ?? null,
                volume: ticker.volume_24h?.toString() ?? ticker.volume?.toString() ?? null,
              });
            }
          } catch {
            // Ticker unavailable — leave as null
          }
        })
      );

      // Map to public schema
      const publicSymbols: PublicSymbol[] = results.map((row) => {
        const ticker = tickerDataMap.get(`${row.exchangeId}:${row.symbol}`);
        return {
          symbol: row.symbol,
          base: row.baseCurrency,
          quote: row.quoteCurrency,
          exchange: row.exchangeName,
          liquidity_grade: mapLiquidityGrade(row.liquidityScore),
          last_price: ticker?.price ?? null,
          volume_24h: ticker?.volume ?? null,
        };
      });

      // Build pagination metadata
      const lastRow = results[results.length - 1];
      const lastValue = lastRow ? lastRow.id : null;
      const meta = buildPaginationMeta(publicSymbols, limit, lastValue);

      return reply.code(200).send({
        success: true,
        data: publicSymbols,
        meta,
      });
    }
  );
};
