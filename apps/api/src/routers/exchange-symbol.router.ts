import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, exchangeSymbols, exchanges, userExchanges, users } from '@livermore/database';
import { eq, and, asc, sql } from 'drizzle-orm';
import { hasEnvVar } from '@livermore/utils';
import { getRedisClient, instanceStatusKey } from '@livermore/cache';
import type { InstanceStatus } from '@livermore/schemas';

/**
 * Exchange Symbol Router
 *
 * Read-only views of the exchange_symbols table for Admin UI.
 * All queries hit the database only — no external API calls.
 * Symbol population is handled by the seed script / scheduled job.
 */
export const exchangeSymbolRouter = router({
  /**
   * List exchange symbols for a single exchange (paginated, DB-only).
   */
  list: protectedProcedure
    .input(
      z.object({
        exchangeId: z.number(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = getDbClient();
      const { exchangeId, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(exchangeSymbols)
        .where(eq(exchangeSymbols.exchangeId, exchangeId));

      const total = countResult?.count ?? 0;

      const symbols = await db
        .select({
          id: exchangeSymbols.id,
          exchangeId: exchangeSymbols.exchangeId,
          symbol: exchangeSymbols.symbol,
          baseCurrency: exchangeSymbols.baseCurrency,
          quoteCurrency: exchangeSymbols.quoteCurrency,
          volume24h: exchangeSymbols.volume24h,
          globalRank: exchangeSymbols.globalRank,
          marketCap: exchangeSymbols.marketCap,
          displayName: exchangeSymbols.displayName,
          isActive: exchangeSymbols.isActive,
          updatedAt: exchangeSymbols.updatedAt,
        })
        .from(exchangeSymbols)
        .where(eq(exchangeSymbols.exchangeId, exchangeId))
        .orderBy(asc(exchangeSymbols.globalRank))
        .limit(pageSize)
        .offset(offset);

      return {
        symbols,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  /**
   * Get all exchanges with their symbol counts.
   */
  exchanges: protectedProcedure
    .query(async () => {
      const db = getDbClient();

      const exchangeList = await db
        .select({
          id: exchanges.id,
          name: exchanges.name,
          displayName: exchanges.displayName,
          supportedTimeframes: exchanges.supportedTimeframes,
          feeSchedule: exchanges.feeSchedule,
          geoRestrictions: exchanges.geoRestrictions,
        })
        .from(exchanges)
        .where(eq(exchanges.isActive, true))
        .orderBy(asc(exchanges.id));

      // Per-exchange counts via aggregate
      const counts = await db
        .select({
          exchangeId: exchangeSymbols.exchangeId,
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where is_active = true)::int`,
        })
        .from(exchangeSymbols)
        .groupBy(exchangeSymbols.exchangeId);

      const countMap = new Map(counts.map((c) => [c.exchangeId, c]));

      // Last refresh across all symbols
      const [lastRefreshRow] = await db
        .select({ lastUpdate: sql<string>`max(updated_at)::timestamptz` })
        .from(exchangeSymbols);

      return {
        exchanges: exchangeList.map((ex) => ({
          ...ex,
          symbolCount: countMap.get(ex.id)?.total ?? 0,
          activeCount: countMap.get(ex.id)?.active ?? 0,
        })),
        lastRefresh: lastRefreshRow?.lastUpdate ?? null,
      };
    }),

  /**
   * Get the authenticated user's default exchange ID.
   */
  defaultExchange: protectedProcedure
    .query(async ({ ctx }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      // Get user ID from Clerk identity
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!user) return { exchangeId: null };

      // Find default exchange (join user_exchanges.exchangeName → exchanges.name)
      const [defaultEx] = await db
        .select({ exchangeId: exchanges.id })
        .from(userExchanges)
        .innerJoin(exchanges, eq(userExchanges.exchangeName, exchanges.name))
        .where(
          and(
            eq(userExchanges.userId, user.id),
            eq(userExchanges.isDefault, true),
            eq(userExchanges.isActive, true)
          )
        )
        .limit(1);

      if (defaultEx?.exchangeId) return { exchangeId: defaultEx.exchangeId };

      // Fallback: first active exchange for this user
      const [anyEx] = await db
        .select({ exchangeId: exchanges.id })
        .from(userExchanges)
        .innerJoin(exchanges, eq(userExchanges.exchangeName, exchanges.name))
        .where(
          and(
            eq(userExchanges.userId, user.id),
            eq(userExchanges.isActive, true)
          )
        )
        .limit(1);

      return { exchangeId: anyEx?.exchangeId ?? null };
    }),

  /**
   * Get the user's configuration status for all exchanges.
   * Returns which exchanges the user has set up and whether credentials are present.
   */
  userStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!user) return { statuses: [] };

      const userExList = await db
        .select({
          exchangeName: userExchanges.exchangeName,
          displayName: userExchanges.displayName,
          isDefault: userExchanges.isDefault,
          apiKeyEnvVar: userExchanges.apiKeyEnvVar,
          apiSecretEnvVar: userExchanges.apiSecretEnvVar,
        })
        .from(userExchanges)
        .where(
          and(
            eq(userExchanges.userId, user.id),
            eq(userExchanges.isActive, true)
          )
        );

      return {
        statuses: userExList.map((ue) => ({
          exchangeName: ue.exchangeName,
          displayName: ue.displayName,
          isDefault: ue.isDefault,
          apiKeyEnvVar: ue.apiKeyEnvVar,
          apiSecretEnvVar: ue.apiSecretEnvVar,
          hasCredentials: !!(ue.apiKeyEnvVar && ue.apiSecretEnvVar),
        })),
      };
    }),

  /**
   * List exchanges with Redis connection status (busy/available).
   */
  exchangeStatuses: protectedProcedure
    .query(async () => {
      const db = getDbClient();

      const exchangeList = await db
        .select({
          id: exchanges.id,
          name: exchanges.name,
          displayName: exchanges.displayName,
          geoRestrictions: exchanges.geoRestrictions,
        })
        .from(exchanges)
        .where(eq(exchanges.isActive, true))
        .orderBy(asc(exchanges.id));

      let statusMap = new Map<number, InstanceStatus>();
      try {
        const redis = getRedisClient();
        const results = await Promise.all(
          exchangeList.map(async (ex) => {
            const data = await redis.get(instanceStatusKey(ex.id));
            return { id: ex.id, data };
          })
        );
        for (const r of results) {
          if (r.data) {
            statusMap.set(r.id, JSON.parse(r.data) as InstanceStatus);
          }
        }
      } catch {
        // Redis unavailable — treat all as available
      }

      return {
        exchanges: exchangeList.map((ex) => {
          const status = statusMap.get(ex.id);
          const isBusy = status != null && status.connectionState !== 'idle';
          return { ...ex, isBusy };
        }),
      };
    }),

  /**
   * Check if environment variable names exist on the server.
   */
  checkEnvVars: protectedProcedure
    .input(
      z.object({
        envVars: z.array(z.string()).max(10),
      })
    )
    .query(({ input }) => {
      const results: Record<string, boolean> = {};
      for (const name of input.envVars) {
        results[name] = hasEnvVar(name);
      }
      return { results };
    }),

  /**
   * Create a user_exchanges record for initial exchange setup.
   */
  setupExchange: protectedProcedure
    .input(
      z.object({
        exchangeName: z.string().min(1),
        apiKeyEnvVar: z.string().min(1),
        apiSecretEnvVar: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Validate exchange exists
      const [exchange] = await db
        .select({ id: exchanges.id, name: exchanges.name })
        .from(exchanges)
        .where(and(eq(exchanges.name, input.exchangeName), eq(exchanges.isActive, true)))
        .limit(1);

      if (!exchange) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Exchange not found' });
      }

      // Check for duplicate
      const [existing] = await db
        .select({ id: userExchanges.id })
        .from(userExchanges)
        .where(
          and(
            eq(userExchanges.userId, user.id),
            eq(userExchanges.exchangeName, input.exchangeName)
          )
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Exchange already configured for this user' });
      }

      // is_default orchestration: unset any existing defaults before inserting new default
      await db.update(userExchanges)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(userExchanges.userId, user.id),
            eq(userExchanges.isDefault, true)
          )
        );

      const [inserted] = await db
        .insert(userExchanges)
        .values({
          userId: user.id,
          exchangeName: input.exchangeName,
          exchangeId: exchange.id,
          apiKeyEnvVar: input.apiKeyEnvVar,
          apiSecretEnvVar: input.apiSecretEnvVar,
          isDefault: true,
          isActive: true,
        })
        .returning({ id: userExchanges.id });

      return { success: true, userExchangeId: inserted.id };
    }),

  /**
   * Update an existing user_exchanges record.
   * Supports updating API key env var names, display name, and default status.
   */
  updateExchange: protectedProcedure
    .input(
      z.object({
        exchangeName: z.string().min(1),
        apiKeyEnvVar: z.string().min(1).optional(),
        apiSecretEnvVar: z.string().min(1).optional(),
        displayName: z.string().max(100).optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      // Get user ID from Clerk identity
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Find the existing user_exchanges record
      const [existing] = await db
        .select({ id: userExchanges.id })
        .from(userExchanges)
        .where(
          and(
            eq(userExchanges.userId, user.id),
            eq(userExchanges.exchangeName, input.exchangeName)
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Exchange not configured for this user' });
      }

      // Build update object dynamically from provided fields
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.apiKeyEnvVar) updates.apiKeyEnvVar = input.apiKeyEnvVar;
      if (input.apiSecretEnvVar) updates.apiSecretEnvVar = input.apiSecretEnvVar;
      if (input.displayName !== undefined) updates.displayName = input.displayName;

      // is_default orchestration
      if (input.isDefault === true) {
        // Unset all other defaults for this user first
        await db.update(userExchanges)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(userExchanges.userId, user.id),
              eq(userExchanges.isDefault, true)
            )
          );
        updates.isDefault = true;
      } else if (input.isDefault === false) {
        updates.isDefault = false;
      }

      // Execute the update
      await db.update(userExchanges)
        .set(updates)
        .where(eq(userExchanges.id, existing.id));

      return { success: true };
    }),

  /**
   * Test connectivity to an exchange's REST API.
   * Uses a public ping/time endpoint — no credentials required.
   */
  testConnection: protectedProcedure
    .input(z.object({ exchangeName: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDbClient();

      const [exchange] = await db
        .select({ restUrl: exchanges.restUrl })
        .from(exchanges)
        .where(and(eq(exchanges.name, input.exchangeName), eq(exchanges.isActive, true)))
        .limit(1);

      if (!exchange?.restUrl) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Exchange REST URL not configured' });
      }

      const pingPaths: Record<string, string> = {
        binance: '/api/v3/ping',
        binance_us: '/api/v3/ping',
        coinbase: '/api/v3/brokerage/market/products/BTC-USD',
        kraken: '/0/public/Time',
        kucoin: '/api/v1/timestamp',
        mexc: '/api/v3/ping',
      };

      const pingPath = pingPaths[input.exchangeName] ?? '/';
      const url = `${exchange.restUrl}${pingPath}`;

      try {
        const start = Date.now();
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        });
        const latencyMs = Date.now() - start;

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        return { success: true, latencyMs };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection failed';
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Test connection failed: ${message}`,
        });
      }
    }),

});

export type ExchangeSymbolRouter = typeof exchangeSymbolRouter;
