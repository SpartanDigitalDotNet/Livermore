import { z } from 'zod';
import { router, publicProcedure } from '@livermore/trpc-config';
import { getDbClient, alertHistory } from '@livermore/database';
import { eq, and, desc, type InferSelectModel } from 'drizzle-orm';

type AlertHistoryEntry = InferSelectModel<typeof alertHistory>;

const db = getDbClient();

/**
 * Alert Router
 *
 * Read-only endpoints for viewing alert trigger history.
 * Alert configuration is now rule-based (hardcoded in AlertEvaluationService).
 *
 * All endpoints accept an optional exchangeId filter.
 * When omitted, alerts from all exchanges are returned.
 */
export const alertRouter = router({
  /**
   * Get recent alert triggers (all symbols)
   */
  recent: publicProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(50),
        exchangeId: z.number().int().positive().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const exchangeId = input?.exchangeId;

      const triggers = await db
        .select()
        .from(alertHistory)
        .where(exchangeId ? eq(alertHistory.exchangeId, exchangeId) : undefined)
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(limit);

      return {
        success: true,
        data: triggers.map((t: AlertHistoryEntry) => {
          const details = t.details as Record<string, unknown> | null;
          return {
            ...t,
            price: parseFloat(t.price),
            triggerValue: t.triggerValue ? parseFloat(t.triggerValue) : null,
            /** signalDelta = macdV - signal; positive = recovering/bullish momentum */
            signalDelta: typeof details?.histogram === 'number' ? details.histogram : null,
          };
        }),
      };
    }),

  /**
   * Get alert triggers for a specific symbol
   */
  bySymbol: publicProcedure
    .input(
      z.object({
        symbol: z.string().min(1),
        limit: z.number().int().positive().max(100).default(50),
        exchangeId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const { symbol, limit, exchangeId } = input;

      const conditions = [eq(alertHistory.symbol, symbol)];
      if (exchangeId) conditions.push(eq(alertHistory.exchangeId, exchangeId));

      const triggers = await db
        .select()
        .from(alertHistory)
        .where(and(...conditions))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(limit);

      return {
        success: true,
        data: triggers.map((t: AlertHistoryEntry) => {
          const details = t.details as Record<string, unknown> | null;
          return {
            ...t,
            price: parseFloat(t.price),
            triggerValue: t.triggerValue ? parseFloat(t.triggerValue) : null,
            /** signalDelta = macdV - signal; positive = recovering/bullish momentum */
            signalDelta: typeof details?.histogram === 'number' ? details.histogram : null,
          };
        }),
      };
    }),

  /**
   * Get alert triggers by type
   */
  byType: publicProcedure
    .input(
      z.object({
        alertType: z.string().min(1),
        limit: z.number().int().positive().max(100).default(50),
        exchangeId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const { alertType, limit, exchangeId } = input;

      const conditions = [eq(alertHistory.alertType, alertType)];
      if (exchangeId) conditions.push(eq(alertHistory.exchangeId, exchangeId));

      const triggers = await db
        .select()
        .from(alertHistory)
        .where(and(...conditions))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(limit);

      return {
        success: true,
        data: triggers.map((t: AlertHistoryEntry) => {
          const details = t.details as Record<string, unknown> | null;
          return {
            ...t,
            price: parseFloat(t.price),
            triggerValue: t.triggerValue ? parseFloat(t.triggerValue) : null,
            /** signalDelta = macdV - signal; positive = recovering/bullish momentum */
            signalDelta: typeof details?.histogram === 'number' ? details.histogram : null,
          };
        }),
      };
    }),

  /**
   * Get a single alert trigger by ID
   */
  byId: publicProcedure
    .input(z.object({
      id: z.number().int().positive(),
      exchangeId: z.number().int().positive().optional(),
    }))
    .query(async ({ input }) => {
      const { id, exchangeId } = input;

      const conditions = [eq(alertHistory.id, id)];
      if (exchangeId) conditions.push(eq(alertHistory.exchangeId, exchangeId));

      const trigger = await db.query.alertHistory.findFirst({
        where: and(...conditions),
      });

      if (!trigger) {
        return {
          success: false,
          error: 'Alert not found',
          data: null,
        };
      }

      const details = trigger.details as Record<string, unknown> | null;
      return {
        success: true,
        error: null,
        data: {
          ...trigger,
          price: parseFloat(trigger.price),
          triggerValue: trigger.triggerValue ? parseFloat(trigger.triggerValue) : null,
          /** signalDelta = macdV - signal; positive = recovering/bullish momentum */
            signalDelta: typeof details?.histogram === 'number' ? details.histogram : null,
        },
      };
    }),
});

export type AlertRouter = typeof alertRouter;
