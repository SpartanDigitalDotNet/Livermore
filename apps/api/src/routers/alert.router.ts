import { z } from 'zod';
import { router, publicProcedure } from '@livermore/trpc-config';
import { getDbClient, alertHistory } from '@livermore/database';
import { eq, and, desc, type InferSelectModel } from 'drizzle-orm';

type AlertHistoryEntry = InferSelectModel<typeof alertHistory>;

const db = getDbClient();

// Hardcoded for now - will be replaced with auth
const TEST_EXCHANGE_ID = 1;

/**
 * Alert Router
 *
 * Read-only endpoints for viewing alert trigger history.
 * Alert configuration is now rule-based (hardcoded in AlertEvaluationService).
 */
export const alertRouter = router({
  /**
   * Get recent alert triggers (all symbols)
   */
  recent: publicProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(50),
      }).optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;

      const triggers = await db
        .select()
        .from(alertHistory)
        .where(eq(alertHistory.exchangeId, TEST_EXCHANGE_ID))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(limit);

      return {
        success: true,
        data: triggers.map((t: AlertHistoryEntry) => ({
          ...t,
          price: parseFloat(t.price),
          triggerValue: t.triggerValue ? parseFloat(t.triggerValue) : null,
        })),
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
      })
    )
    .query(async ({ input }) => {
      const { symbol, limit } = input;

      const triggers = await db
        .select()
        .from(alertHistory)
        .where(
          and(
            eq(alertHistory.exchangeId, TEST_EXCHANGE_ID),
            eq(alertHistory.symbol, symbol)
          )
        )
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(limit);

      return {
        success: true,
        data: triggers.map((t: AlertHistoryEntry) => ({
          ...t,
          price: parseFloat(t.price),
          triggerValue: t.triggerValue ? parseFloat(t.triggerValue) : null,
        })),
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
      })
    )
    .query(async ({ input }) => {
      const { alertType, limit } = input;

      const triggers = await db
        .select()
        .from(alertHistory)
        .where(
          and(
            eq(alertHistory.exchangeId, TEST_EXCHANGE_ID),
            eq(alertHistory.alertType, alertType)
          )
        )
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(limit);

      return {
        success: true,
        data: triggers.map((t: AlertHistoryEntry) => ({
          ...t,
          price: parseFloat(t.price),
          triggerValue: t.triggerValue ? parseFloat(t.triggerValue) : null,
        })),
      };
    }),

  /**
   * Get a single alert trigger by ID
   */
  byId: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { id } = input;

      const trigger = await db.query.alertHistory.findFirst({
        where: and(
          eq(alertHistory.id, id),
          eq(alertHistory.exchangeId, TEST_EXCHANGE_ID)
        ),
      });

      if (!trigger) {
        return {
          success: false,
          error: 'Alert not found',
          data: null,
        };
      }

      return {
        success: true,
        error: null,
        data: {
          ...trigger,
          price: parseFloat(trigger.price),
          triggerValue: trigger.triggerValue ? parseFloat(trigger.triggerValue) : null,
        },
      };
    }),
});

export type AlertRouter = typeof alertRouter;
