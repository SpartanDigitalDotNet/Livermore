import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getRedisClient, exchangeCandleKey } from '@livermore/cache';
import { getDbClient, exchanges } from '@livermore/database';
import { eq, and } from 'drizzle-orm';
import type { Candle } from '@livermore/schemas';
import {
  CandleParamsSchema,
  CandleQuerySchema,
  PublicCandleSchema,
  createEnvelopeSchema,
} from '../schemas/index.js';
import { transformCandleWithContext } from '../transformers/index.js';
import { buildPaginationMeta, decodeCursor } from '../helpers/index.js';

/**
 * Candle route handler - GET /public/v1/candles/:exchange/:symbol/:timeframe
 *
 * Reads OHLCV candle data from exchange-scoped Redis cache.
 * Supports cursor-based pagination and time-range filtering.
 *
 * IMPORTANT: Uses direct Redis commands (not CandleCacheStrategy) to avoid userId dependency.
 * Exchange-scoped candles are stored in Redis with key: `candles:{exchangeId}:{symbol}:{timeframe}`
 */
export const candlesRoute: FastifyPluginAsyncZod = async (fastify) => {
  const db = getDbClient();
  const redis = getRedisClient();

  // In-memory cache for exchange name -> ID mapping (exchanges rarely change)
  const exchangeCache = new Map<string, number>();

  /**
   * Resolve exchange name (URL param) to exchange ID via database lookup.
   * Results are cached in-memory to reduce database queries.
   */
  async function resolveExchangeId(exchangeName: string): Promise<number | null> {
    // Check cache first
    if (exchangeCache.has(exchangeName)) {
      return exchangeCache.get(exchangeName)!;
    }

    // Query database
    const [exchange] = await db
      .select({ id: exchanges.id })
      .from(exchanges)
      .where(and(eq(exchanges.name, exchangeName), eq(exchanges.isActive, true)))
      .limit(1);

    if (!exchange) {
      return null;
    }

    // Cache result
    exchangeCache.set(exchangeName, exchange.id);
    return exchange.id;
  }

  fastify.get(
    '/:exchange/:symbol/:timeframe',
    {
      schema: {
        description: `Retrieve OHLCV (Open, High, Low, Close, Volume) candle data for a trading pair from a specific exchange.

This endpoint provides historical and recent price data in standard candlestick format, sourced from live exchange WebSocket feeds and cached for high-performance access. Ideal for charting applications, technical analysis, algorithmic trading strategies, and market data aggregation.

**Data freshness:** Candles are updated in real-time as they close on the exchange. The most recent candle may still be forming (open candle) until the timeframe interval completes.

**Pagination:** Use cursor-based pagination to iterate through large result sets efficiently. The \`next_cursor\` field in the response metadata should be passed as the \`cursor\` query parameter for the next page.

**Time filtering:** Optionally filter candles by time range using \`start_time\` and \`end_time\` ISO 8601 timestamps. If omitted, returns the most recent candles up to the specified limit.`,
        tags: ['Candles'],
        params: CandleParamsSchema,
        querystring: CandleQuerySchema,
        response: {
          200: createEnvelopeSchema(z.array(PublicCandleSchema)),
        },
      },
    },
    async (request, reply) => {
      const { exchange: exchangeName, symbol, timeframe } = request.params;
      const { cursor, limit, start_time, end_time } = request.query;

      // Resolve exchange name to ID
      const exchangeId = await resolveExchangeId(exchangeName);
      if (!exchangeId) {
        return (reply as any).code(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Exchange "${exchangeName}" not found or inactive`,
          },
        });
      }

      // Build Redis key for exchange-scoped candles
      const key = exchangeCandleKey(exchangeId, symbol, timeframe);

      // Determine Redis query based on params
      let results: string[] = [];

      try {
        if (start_time || end_time) {
          // Time-range query using ZRANGEBYSCORE
          const startMs = start_time ? new Date(start_time).getTime() : '-inf';
          const endMs = end_time ? new Date(end_time).getTime() : '+inf';

          // ZRANGEBYSCORE key min max [LIMIT offset count]
          results = await redis.zrangebyscore(
            key,
            startMs,
            endMs,
            'LIMIT',
            0,
            limit
          );
        } else if (cursor) {
          // Cursor-based forward pagination
          const cursorTs = decodeCursor(cursor);

          // Get candles AFTER cursor timestamp (exclusive range using '(')
          results = await redis.zrangebyscore(
            key,
            `(${cursorTs}`, // Exclusive lower bound
            '+inf',
            'LIMIT',
            0,
            limit
          );
        } else {
          // Default: most recent candles
          results = await redis.zrange(key, -limit, -1);
        }
      } catch (error) {
        // Redis error or cursor decode error
        const message = error instanceof Error ? error.message : 'Failed to fetch candles';
        return (reply as any).code(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message,
          },
        });
      }

      // Parse and transform candles with request context
      const candles: Candle[] = results.map((json) => JSON.parse(json));
      const candleContext = { exchange: exchangeName, symbol, timeframe };
      const publicCandles = candles.map((c) => transformCandleWithContext(c, candleContext));

      // Build pagination metadata
      const lastCandle = candles[candles.length - 1];
      const lastValue = lastCandle ? lastCandle.timestamp : null;
      const meta = buildPaginationMeta(publicCandles, limit, lastValue);

      return reply.code(200).send({
        success: true,
        data: publicCandles,
        meta,
      });
    }
  );
};
