import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getRedisClient, instanceStatusKey } from '@livermore/cache';
import { getDbClient, exchanges, exchangeSymbols } from '@livermore/database';
import { eq, sql } from 'drizzle-orm';
import type { InstanceStatus } from '@livermore/schemas';
import {
  PublicExchangeSchema,
  createEnvelopeSchema,
} from '../schemas/index.js';

/**
 * Exchange route handler - GET /public/v1/exchanges
 *
 * Returns list of supported exchanges with metadata including connection status,
 * display name, and active symbol count.
 *
 * Does NOT expose: ws_url, rest_url, api_limits, fee_schedule, geo_restrictions.
 */
export const exchangesRoute: FastifyPluginAsyncZod = async (fastify) => {
  const db = getDbClient();

  fastify.get(
    '/',
    {
      schema: {
        description: `List all supported cryptocurrency exchanges with real-time operational status and symbol counts.

This endpoint provides metadata about available exchanges, including their current online/offline status and the number of trading pairs (symbols) available on each platform. Use this to discover which exchanges are accessible and to enumerate available markets.

**Status field:** Indicates whether the exchange's data feed is currently active. Status is derived from the internal instance registry and reflects real-time WebSocket connection health. An "offline" status means candle data may not be updating until the connection is restored.

**Symbol count:** Total number of active trading pairs available on the exchange. This count reflects symbols that are actively tracked and available via the symbols endpoint.

No pagination is needed as the list of exchanges is small and relatively static.`,
        tags: ['Exchanges'],
        response: {
          200: createEnvelopeSchema(z.array(PublicExchangeSchema)),
        },
      },
    },
    async (_request, reply) => {
      try {
        // Query active exchanges from database
        const exchangeList = await db
          .select({
            id: exchanges.id,
            name: exchanges.name,
            displayName: exchanges.displayName,
          })
          .from(exchanges)
          .where(eq(exchanges.isActive, true))
          .orderBy(exchanges.id);

        // Query per-exchange active symbol counts
        const symbolCounts = await db
          .select({
            exchangeId: exchangeSymbols.exchangeId,
            count: sql<number>`count(*) filter (where ${exchangeSymbols.isActive} = true)::int`,
          })
          .from(exchangeSymbols)
          .groupBy(exchangeSymbols.exchangeId);

        const countMap = new Map(symbolCounts.map((sc) => [sc.exchangeId, sc.count ?? 0]));

        // Check Redis instance registry for connection status
        const redis = getRedisClient();
        const statusMap = new Map<number, InstanceStatus>();

        try {
          const statusResults = await Promise.all(
            exchangeList.map(async (ex) => {
              const data = await redis.get(instanceStatusKey(ex.id));
              return { id: ex.id, data };
            })
          );

          for (const result of statusResults) {
            if (result.data) {
              statusMap.set(result.id, JSON.parse(result.data) as InstanceStatus);
            }
          }
        } catch {
          // Redis unavailable - treat all exchanges as offline
        }

        // Map to public schema
        const publicExchanges = exchangeList.map((ex) => {
          const instanceStatus = statusMap.get(ex.id);
          const isOnline =
            instanceStatus != null &&
            instanceStatus.connectionState !== 'idle';

          return {
            id: ex.name, // Use name as public ID (e.g. "coinbase")
            name: ex.displayName, // Display name (e.g. "Coinbase Advanced Trade")
            status: (isOnline ? 'online' : 'offline') as 'online' | 'offline',
            symbol_count: countMap.get(ex.id) ?? 0,
          };
        });

        return reply.code(200).send({
          success: true,
          data: publicExchanges,
          meta: {
            count: publicExchanges.length,
            next_cursor: null,
            has_more: false,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch exchanges';
        return (reply as any).code(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message,
          },
        });
      }
    }
  );
};
