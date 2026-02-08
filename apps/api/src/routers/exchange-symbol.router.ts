import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, exchangeSymbols, exchanges, userExchanges, users } from '@livermore/database';
import { eq, and, asc, sql } from 'drizzle-orm';
import { hasEnvVar } from '@livermore/utils';

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
          isDefault: ue.isDefault,
          hasCredentials: hasEnvVar(ue.apiKeyEnvVar) && hasEnvVar(ue.apiSecretEnvVar),
        })),
      };
    }),

});

export type ExchangeSymbolRouter = typeof exchangeSymbolRouter;
