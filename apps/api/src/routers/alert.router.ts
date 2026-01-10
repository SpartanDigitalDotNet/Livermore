import { z } from 'zod';
import { router, publicProcedure } from '@livermore/trpc-config';
import { TimeframeSchema, AlertConditionSchema } from '@livermore/schemas';
import { getDbClient, alerts, alertHistory } from '@livermore/database';
import { eq, and, desc } from 'drizzle-orm';

const db = getDbClient();

// Hardcoded for now - will be replaced with auth
const TEST_USER_ID = 1;
const TEST_EXCHANGE_ID = 1;

/**
 * Input schema for creating an alert
 */
const CreateAlertInput = z.object({
  name: z.string().min(1).max(100),
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
  conditions: z.array(AlertConditionSchema).min(1),
  cooldownMs: z.number().int().positive().default(300000), // 5 minutes
});

/**
 * Input schema for updating an alert
 */
const UpdateAlertInput = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  conditions: z.array(AlertConditionSchema).min(1).optional(),
  isActive: z.boolean().optional(),
  cooldownMs: z.number().int().positive().optional(),
});

/**
 * Input schema for getting alerts by symbol
 */
const GetAlertsBySymbolInput = z.object({
  symbol: z.string().min(1),
});

/**
 * Input schema for getting alert history
 */
const GetAlertHistoryInput = z.object({
  alertId: z.number().int().positive(),
  limit: z.number().int().positive().max(100).default(50),
});

/**
 * Alert Router
 *
 * Provides CRUD operations for price and indicator alerts.
 */
export const alertRouter = router({
  /**
   * List all alerts for the current user
   */
  list: publicProcedure.query(async () => {
    const userAlerts = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, TEST_USER_ID),
          eq(alerts.exchangeId, TEST_EXCHANGE_ID)
        )
      )
      .orderBy(desc(alerts.createdAt));

    return {
      success: true,
      data: userAlerts.map((a) => ({
        ...a,
        conditions: a.conditions as z.infer<typeof AlertConditionSchema>[],
      })),
    };
  }),

  /**
   * Get alerts for a specific symbol
   */
  bySymbol: publicProcedure
    .input(GetAlertsBySymbolInput)
    .query(async ({ input }) => {
      const { symbol } = input;

      const symbolAlerts = await db
        .select()
        .from(alerts)
        .where(
          and(
            eq(alerts.userId, TEST_USER_ID),
            eq(alerts.exchangeId, TEST_EXCHANGE_ID),
            eq(alerts.symbol, symbol)
          )
        )
        .orderBy(desc(alerts.createdAt));

      return {
        success: true,
        data: symbolAlerts.map((a) => ({
          ...a,
          conditions: a.conditions as z.infer<typeof AlertConditionSchema>[],
        })),
      };
    }),

  /**
   * Get a single alert by ID
   */
  byId: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { id } = input;

      const alert = await db.query.alerts.findFirst({
        where: and(
          eq(alerts.id, id),
          eq(alerts.userId, TEST_USER_ID)
        ),
      });

      if (!alert) {
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
          ...alert,
          conditions: alert.conditions as z.infer<typeof AlertConditionSchema>[],
        },
      };
    }),

  /**
   * Create a new alert
   */
  create: publicProcedure
    .input(CreateAlertInput)
    .mutation(async ({ input }) => {
      const { name, symbol, timeframe, conditions, cooldownMs } = input;

      const [newAlert] = await db
        .insert(alerts)
        .values({
          userId: TEST_USER_ID,
          exchangeId: TEST_EXCHANGE_ID,
          name,
          symbol,
          timeframe,
          conditions,
          cooldownMs,
          isActive: true,
        })
        .returning();

      return {
        success: true,
        data: {
          ...newAlert,
          conditions: newAlert.conditions as z.infer<typeof AlertConditionSchema>[],
        },
      };
    }),

  /**
   * Update an existing alert
   */
  update: publicProcedure
    .input(UpdateAlertInput)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;

      // Verify ownership
      const existing = await db.query.alerts.findFirst({
        where: and(
          eq(alerts.id, id),
          eq(alerts.userId, TEST_USER_ID)
        ),
      });

      if (!existing) {
        return {
          success: false,
          error: 'Alert not found',
          data: null,
        };
      }

      const [updated] = await db
        .update(alerts)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(alerts.id, id))
        .returning();

      return {
        success: true,
        error: null,
        data: {
          ...updated,
          conditions: updated.conditions as z.infer<typeof AlertConditionSchema>[],
        },
      };
    }),

  /**
   * Delete an alert
   */
  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { id } = input;

      // Verify ownership
      const existing = await db.query.alerts.findFirst({
        where: and(
          eq(alerts.id, id),
          eq(alerts.userId, TEST_USER_ID)
        ),
      });

      if (!existing) {
        return {
          success: false,
          error: 'Alert not found',
        };
      }

      await db.delete(alerts).where(eq(alerts.id, id));

      return {
        success: true,
        error: null,
      };
    }),

  /**
   * Toggle alert active status
   */
  toggle: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { id } = input;

      // Get current status
      const existing = await db.query.alerts.findFirst({
        where: and(
          eq(alerts.id, id),
          eq(alerts.userId, TEST_USER_ID)
        ),
      });

      if (!existing) {
        return {
          success: false,
          error: 'Alert not found',
          data: null,
        };
      }

      const [updated] = await db
        .update(alerts)
        .set({
          isActive: !existing.isActive,
          updatedAt: new Date(),
        })
        .where(eq(alerts.id, id))
        .returning();

      return {
        success: true,
        error: null,
        data: {
          ...updated,
          conditions: updated.conditions as z.infer<typeof AlertConditionSchema>[],
        },
      };
    }),

  /**
   * Get alert trigger history
   */
  history: publicProcedure
    .input(GetAlertHistoryInput)
    .query(async ({ input }) => {
      const { alertId, limit } = input;

      // Verify ownership
      const alert = await db.query.alerts.findFirst({
        where: and(
          eq(alerts.id, alertId),
          eq(alerts.userId, TEST_USER_ID)
        ),
      });

      if (!alert) {
        return {
          success: false,
          error: 'Alert not found',
          data: null,
        };
      }

      const history = await db
        .select()
        .from(alertHistory)
        .where(eq(alertHistory.alertId, alertId))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(limit);

      return {
        success: true,
        error: null,
        data: history.map((h) => ({
          ...h,
          price: parseFloat(h.price),
          conditions: h.conditions as z.infer<typeof AlertConditionSchema>[],
        })),
      };
    }),
});

export type AlertRouter = typeof alertRouter;
