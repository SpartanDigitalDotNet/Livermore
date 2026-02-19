import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getRedisClient, exchangeIndicatorKey } from '@livermore/cache';
import { getDbClient, exchanges } from '@livermore/database';
import { eq, and } from 'drizzle-orm';
import type { Timeframe } from '@livermore/schemas';
import {
  SignalParamsSchema,
  SignalQuerySchema,
  PublicSignalSchema,
  createEnvelopeSchema,
} from '../schemas/index.js';
import { transformIndicatorToSignal } from '../transformers/index.js';

/**
 * Local interface for cached indicator data.
 * Copied from internal shape -- do NOT import from @livermore/cache
 * to maintain zero-dependency IP isolation boundary.
 *
 * Only the fields needed by transformIndicatorToSignal are included.
 */
interface CachedIndicator {
  timestamp: number;
  type: string;
  symbol: string;
  timeframe: string;
  value: Record<string, number>;
  params?: Record<string, unknown>;
}

/** Timeframes to query for signals when no filter is specified */
const SIGNAL_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];

/**
 * Signal route handler - GET /public/v1/signals/:exchange/:symbol
 *
 * Reads trade signal data from exchange-scoped Redis indicator cache.
 * Returns generic signal classification (direction + strength) per timeframe.
 *
 * IMPORTANT: Uses direct Redis commands (not IndicatorCacheStrategy) to avoid userId dependency.
 * Exchange-scoped indicators are stored in Redis with key: `indicator:{exchangeId}:{symbol}:{timeframe}:macd-v`
 *
 * CRITICAL: Internal indicator type name ('macd-v') is used ONLY for Redis key construction.
 * It NEVER appears in the response body. All responses use generic labels only.
 */
export const signalsRoute: FastifyPluginAsyncZod = async (fastify) => {
  const redis = getRedisClient();
  const db = getDbClient();

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
    '/:exchange/:symbol',
    {
      schema: {
        description: `Retrieve current trade signals for a trading pair across multiple timeframes from a specific exchange.

This endpoint provides real-time generic trade signal classifications derived from ongoing market analysis. Each signal includes a direction (bullish, bearish, or neutral), strength category (weak to extreme), and the timeframe it applies to.

**Use cases:**
- **Algorithmic trading bots** checking signal direction before placing orders
- **AI agents** incorporating multi-timeframe signal consensus into trading strategies
- **Portfolio managers** monitoring momentum across timeframes for position sizing
- **Market scanners** filtering symbols by signal direction and strength

**Timeframes:** Signals are available for 15-minute, 1-hour, 4-hour, and 1-day intervals. Use the optional \`timeframe\` query parameter to filter to a specific interval, or omit to retrieve all available timeframes.

**Data freshness:** Signals are updated in real-time as new candles close on the exchange. The \`updated_at\` field indicates when each signal was last recalculated.

**Response:** Returns an array of signal objects, one per available timeframe. Timeframes with insufficient data for reliable signal generation are omitted from the response.`,
        tags: ['Signals'],
        params: SignalParamsSchema,
        querystring: SignalQuerySchema,
        response: {
          200: createEnvelopeSchema(z.array(PublicSignalSchema)),
        },
      },
    },
    async (request, reply) => {
      const { exchange: exchangeName, symbol } = request.params;
      const { timeframe } = request.query;

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

      // Determine which timeframes to query
      const timeframesToQuery: Timeframe[] = timeframe
        ? [timeframe as Timeframe]
        : SIGNAL_TIMEFRAMES;

      // Fetch indicator data from Redis for each timeframe
      // Internal indicator type 'macd-v' used ONLY for key construction -- never in response
      const signals = [];

      for (const tf of timeframesToQuery) {
        const key = exchangeIndicatorKey(exchangeId, symbol, tf, 'macd-v');
        const raw = await redis.get(key);

        if (!raw) continue;

        try {
          const indicator = JSON.parse(raw) as CachedIndicator;

          // Only include signals where indicator data is seeded (complete)
          if (!indicator.params?.seeded) continue;

          signals.push(transformIndicatorToSignal(indicator));
        } catch {
          // Skip malformed cache entries
          continue;
        }
      }

      return reply.code(200).send({
        success: true,
        data: signals,
        meta: {
          count: signals.length,
          next_cursor: null,
          has_more: false,
        },
      });
    }
  );
};
