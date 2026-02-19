import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getDbClient, exchanges, alertHistory } from '@livermore/database';
import { eq, and, desc, lt } from 'drizzle-orm';
import {
  AlertQuerySchema,
  PublicAlertSchema,
  createEnvelopeSchema,
} from '../schemas/index.js';
import { transformAlertHistory } from '../transformers/index.js';
import { buildPaginationMeta, decodeCursor } from '../helpers/index.js';

/**
 * Alert route handler - GET /public/v1/alerts
 *
 * Reads historical trade alert events from PostgreSQL alert_history table.
 * Returns paginated alert history with generic signal classification.
 *
 * CRITICAL: Uses EXPLICIT column selection (whitelist). The following columns
 * are NEVER selected from the database:
 * - details (JSONB with internal indicator data)
 * - previousLabel (internal state transition tracking)
 * - notificationSent (internal delivery status)
 * - notificationError (internal error messages)
 * - alertType (internal type discriminator -- used only in WHERE clause)
 * - triggeredAtEpoch (internal epoch timestamp)
 */
export const alertsRoute: FastifyPluginAsyncZod = async (fastify) => {
  const db = getDbClient();

  // In-memory caches for exchange resolution (exchanges rarely change)
  const exchangeIdToName = new Map<number, string>();
  const exchangeNameToId = new Map<string, number>();

  /**
   * Resolve exchange name to ID for query filtering.
   * Results are cached in both directions (name->id, id->name).
   */
  async function resolveExchangeFilter(exchangeName: string): Promise<number | null> {
    // Check cache first
    if (exchangeNameToId.has(exchangeName)) {
      return exchangeNameToId.get(exchangeName)!;
    }

    // Query database
    const [exchange] = await db
      .select({ id: exchanges.id, name: exchanges.name })
      .from(exchanges)
      .where(and(eq(exchanges.name, exchangeName), eq(exchanges.isActive, true)))
      .limit(1);

    if (!exchange) {
      return null;
    }

    // Cache both directions
    exchangeNameToId.set(exchange.name, exchange.id);
    exchangeIdToName.set(exchange.id, exchange.name);
    return exchange.id;
  }

  /**
   * Resolve exchange ID to name for response transformation.
   * Checks cache first, queries database on cache miss.
   */
  async function getExchangeName(exchangeId: number): Promise<string> {
    // Check cache first
    if (exchangeIdToName.has(exchangeId)) {
      return exchangeIdToName.get(exchangeId)!;
    }

    // Query database
    const [exchange] = await db
      .select({ id: exchanges.id, name: exchanges.name })
      .from(exchanges)
      .where(eq(exchanges.id, exchangeId))
      .limit(1);

    if (!exchange) {
      return 'unknown';
    }

    // Cache both directions
    exchangeIdToName.set(exchange.id, exchange.name);
    exchangeNameToId.set(exchange.name, exchange.id);
    return exchange.name;
  }

  fastify.get(
    '/',
    {
      schema: {
        description: `Retrieve historical trade alert events with generic signal classification and pagination.

This endpoint provides a chronological record of trade signal trigger events, showing when signals changed direction or crossed significant thresholds. Each alert includes the signal direction, strength, price at trigger time, and the exchange/symbol context.

**Use cases:**
- **Backtesting** strategies against historical signal events
- **AI agents** analyzing signal frequency and accuracy patterns
- **Notification systems** replaying missed alerts
- **Market research** studying signal distribution across symbols and timeframes

**Filtering:** Narrow results using optional \`exchange\`, \`symbol\`, and \`timeframe\` query parameters. Multiple filters are combined with AND logic.

**Pagination:** Use cursor-based pagination for efficient iteration through large result sets. The \`next_cursor\` value in the response metadata should be passed as the \`cursor\` query parameter to fetch the next page. Results are returned in reverse chronological order (newest first).

**Response:** Returns an array of alert objects with generic signal labels. No proprietary indicator names or internal calculation details are included.`,
        tags: ['Alerts'],
        querystring: AlertQuerySchema,
        response: {
          200: createEnvelopeSchema(z.array(PublicAlertSchema)),
        },
      },
    },
    async (request, reply) => {
      const { exchange, symbol, timeframe, cursor, limit } = request.query;

      // Resolve exchange filter if provided
      let filterExchangeId: number | null = null;
      if (exchange) {
        const resolvedId = await resolveExchangeFilter(exchange);
        if (resolvedId === null) {
          return reply.code(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: `Exchange "${exchange}" not found or inactive`,
            },
          });
        }
        filterExchangeId = resolvedId;
      }

      // Build query conditions
      // Internal alert type filter -- 'macdv' used ONLY in WHERE clause, never in response
      const conditions: ReturnType<typeof eq>[] = [eq(alertHistory.alertType, 'macdv')];

      if (filterExchangeId !== null) {
        conditions.push(eq(alertHistory.exchangeId, filterExchangeId));
      }
      if (symbol) {
        conditions.push(eq(alertHistory.symbol, symbol));
      }
      if (timeframe) {
        conditions.push(eq(alertHistory.timeframe, timeframe));
      }

      // Decode cursor for pagination (reverse chronological: cursor = last seen ID)
      if (cursor) {
        try {
          const cursorId = decodeCursor(cursor);
          conditions.push(lt(alertHistory.id, cursorId));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid cursor';
          return reply.code(400).send({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message,
            },
          });
        }
      }

      // Execute query with EXPLICIT column selection (whitelist)
      // CRITICAL: Do NOT select details, previousLabel, notificationSent,
      // notificationError, alertType, triggeredAtEpoch
      const rows = await db
        .select({
          id: alertHistory.id,
          symbol: alertHistory.symbol,
          timeframe: alertHistory.timeframe,
          triggeredAt: alertHistory.triggeredAt,
          triggerLabel: alertHistory.triggerLabel,
          triggerValue: alertHistory.triggerValue,
          price: alertHistory.price,
          exchangeId: alertHistory.exchangeId,
        })
        .from(alertHistory)
        .where(and(...conditions))
        .orderBy(desc(alertHistory.id))
        .limit(limit + 1);

      // Detect has_more
      const hasMore = rows.length > limit;
      const results = hasMore ? rows.slice(0, limit) : rows;

      // Transform rows to public format with exchange name resolution
      const publicAlerts = [];
      for (const row of results) {
        const exchangeName = await getExchangeName(row.exchangeId);
        publicAlerts.push(
          transformAlertHistory(
            {
              triggeredAt: row.triggeredAt,
              symbol: row.symbol,
              timeframe: row.timeframe,
              triggerLabel: row.triggerLabel,
              triggerValue: row.triggerValue,
              price: row.price,
              exchangeId: row.exchangeId,
            },
            exchangeName
          )
        );
      }

      // Build pagination metadata
      const lastRow = results[results.length - 1];
      const lastValue = lastRow ? lastRow.id : null;
      const meta = buildPaginationMeta(publicAlerts, limit, lastValue);

      return reply.code(200).send({
        success: true,
        data: publicAlerts,
        meta,
      });
    }
  );
};
