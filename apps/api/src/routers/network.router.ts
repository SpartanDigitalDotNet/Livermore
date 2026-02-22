import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, exchanges, exchangeSymbols } from '@livermore/database';
import { getRedisClient, instanceStatusKey, networkActivityStreamKey, warmupStatsKey, exchangeCandleKey } from '@livermore/cache';
import { eq, asc, and, inArray } from 'drizzle-orm';
import { InstanceStatusSchema, type InstanceStatus } from '@livermore/schemas';
import type { Timeframe } from '@livermore/schemas';
import type { WarmupStats } from '@livermore/exchange-core';
import { getMonitoredSymbols } from '../services/runtime-state';

/**
 * Parse a Redis Stream entry's flat field-value array into an object.
 *
 * ioredis XREVRANGE returns entries as [id, fields] where fields is
 * a flat array: ['field1', 'value1', 'field2', 'value2', ...]
 * This helper converts it to { id, field1: value1, field2: value2, ... }
 */
function parseStreamEntry(
  id: string,
  fields: string[]
): Record<string, string> & { id: string } {
  const obj: Record<string, string> = { id };
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj as Record<string, string> & { id: string };
}

/**
 * Network Router
 *
 * Read-only views of exchange instance status and network activity.
 * Used by Admin UI to display the Perseus Network dashboard.
 *
 * - getInstances: All active exchanges with online/offline status
 * - getActivityLog: Reverse-chronological stream entries with pagination
 * - getExchangeStatus: Full status payload for a single exchange
 *
 * All Redis access uses individual key operations (no SCAN/KEYS/MGET)
 * for Azure Redis Cluster compatibility.
 */
export const networkRouter = router({
  /**
   * GET /network.getInstances
   *
   * Returns status for every active exchange in the database.
   * Merges DB exchange list with Redis instance status keys.
   * Exchanges without a Redis key (expired heartbeat) show as offline.
   */
  getInstances: protectedProcedure.query(async () => {
    const db = getDbClient();

    // Authoritative exchange list from database
    const exchangeList = await db
      .select({
        id: exchanges.id,
        name: exchanges.name,
        displayName: exchanges.displayName,
      })
      .from(exchanges)
      .where(eq(exchanges.isActive, true))
      .orderBy(asc(exchanges.id));

    // Fetch instance status from Redis (individual GETs, not MGET)
    const statusMap = new Map<number, InstanceStatus>();
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
          try {
            const parsed = InstanceStatusSchema.safeParse(JSON.parse(r.data));
            if (parsed.success) {
              statusMap.set(r.id, parsed.data);
            }
          } catch {
            // Parse failure -- treat as offline
          }
        }
      }
    } catch {
      // Redis unavailable -- all instances will show as offline
    }

    return {
      instances: exchangeList.map((ex) => {
        const status = statusMap.get(ex.id) ?? null;
        return {
          exchangeId: ex.id,
          exchangeName: ex.name,
          displayName: ex.displayName,
          online: status !== null,
          status,
        };
      }),
    };
  }),

  /**
   * GET /network.getActivityLog
   *
   * Returns activity stream entries in reverse chronological order.
   *
   * Single-exchange mode (exchangeName provided):
   *   Reads one stream with cursor-based pagination via XREVRANGE.
   *
   * Global mode (no exchangeName):
   *   Reads all active exchange streams in parallel, merges, and
   *   returns top N entries sorted by stream ID descending.
   *   No cursor pagination in global mode.
   */
  getActivityLog: protectedProcedure
    .input(
      z.object({
        exchangeName: z.string().optional(),
        count: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const redis = getRedisClient();
      const { exchangeName, count, cursor } = input;

      // Single-exchange mode: cursor-based pagination
      if (exchangeName) {
        try {
          const streamKey = networkActivityStreamKey(exchangeName);
          const end = cursor ?? '+';

          // Fetch count + 1 to detect if cursor entry is included
          const raw = await redis.xrevrange(
            streamKey,
            end,
            '-',
            'COUNT',
            count + 1
          );

          let entries = raw.map(([id, fields]) => parseStreamEntry(id, fields));

          // XREVRANGE is inclusive: if cursor was provided and first entry matches, skip it
          if (cursor && entries.length > 0 && entries[0].id === cursor) {
            entries = entries.slice(1);
          }

          // Trim to requested count
          const page = entries.slice(0, count);

          // nextCursor = last entry ID if we have a full page (more data likely exists)
          const nextCursor =
            page.length === count ? page[page.length - 1].id : null;

          return { entries: page, nextCursor };
        } catch {
          // Stream may not exist yet
          return { entries: [] as Array<Record<string, string> & { id: string }>, nextCursor: null };
        }
      }

      // Global mode: read all exchange streams in parallel, merge, top N
      const db = getDbClient();
      const exchangeList = await db
        .select({ name: exchanges.name })
        .from(exchanges)
        .where(eq(exchanges.isActive, true));

      const allEntries = await Promise.all(
        exchangeList.map(async (ex) => {
          try {
            const streamKey = networkActivityStreamKey(ex.name);
            const raw = await redis.xrevrange(
              streamKey,
              '+',
              '-',
              'COUNT',
              count
            );
            return raw.map(([id, fields]) => parseStreamEntry(id, fields));
          } catch {
            return [];
          }
        })
      );

      // Flatten, sort by stream ID descending (lexicographic, which is chronological for Redis IDs)
      const merged = allEntries
        .flat()
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, count);

      return { entries: merged, nextCursor: null };
    }),

  /**
   * GET /network.getExchangeStatus
   *
   * Returns the full InstanceStatus payload for a single exchange.
   * Returns online=false when the Redis key has expired or is missing.
   */
  getExchangeStatus: protectedProcedure
    .input(
      z.object({
        exchangeId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        const redis = getRedisClient();
        const data = await redis.get(instanceStatusKey(input.exchangeId));

        if (!data) {
          return { online: false as const, status: null };
        }

        const status = JSON.parse(data) as InstanceStatus;
        return { online: true as const, status };
      } catch {
        return { online: false as const, status: null };
      }
    }),

  /**
   * GET /network.getWarmupStats
   *
   * Returns real-time warmup progress stats for a single exchange.
   * Used by Admin UI WarmupProgressPanel to display percent complete, ETA, current symbol, failures.
   *
   * Returns null when no warmup is active or stats have expired.
   */
  getWarmupStats: protectedProcedure
    .input(
      z.object({
        exchangeId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        const redis = getRedisClient();
        const data = await redis.get(warmupStatsKey(input.exchangeId));

        if (!data) {
          return { stats: null };
        }

        const stats = JSON.parse(data) as WarmupStats;
        return { stats };
      } catch {
        // Redis unavailable or parse failure -- return null
        return { stats: null };
      }
    }),
  /**
   * GET /network.getCandleTimestamps
   *
   * Returns the latest candle timestamp for each symbol × timeframe pair
   * for a given exchange. Used by Candle Meter to seed initial state.
   *
   * Uses individual zrevrangebyscore calls (Azure Cluster compatible).
   */
  getCandleTimestamps: protectedProcedure
    .input(
      z.object({
        exchangeId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { exchangeId } = input;
      const symbols = getMonitoredSymbols(exchangeId);
      const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

      if (symbols.length === 0) {
        return { exchangeId, symbols: [], timestamps: {}, ranks: {} as Record<string, number | null> };
      }

      const redis = getRedisClient();
      const db = getDbClient();

      // Build all symbol × timeframe queries in parallel
      const timestamps: Record<string, Record<string, number | null>> = {};

      // Fetch globalRank for each symbol (for tier display in Candle Meter)
      const rankRows = await db
        .select({ symbol: exchangeSymbols.symbol, globalRank: exchangeSymbols.globalRank })
        .from(exchangeSymbols)
        .where(
          and(
            eq(exchangeSymbols.exchangeId, exchangeId),
            inArray(exchangeSymbols.symbol, symbols)
          )
        );
      const ranks: Record<string, number | null> = {};
      for (const r of rankRows) {
        ranks[r.symbol] = r.globalRank;
      }

      await Promise.all(
        symbols.map(async (symbol) => {
          const tfResults: Record<string, number | null> = {};

          await Promise.all(
            timeframes.map(async (tf) => {
              try {
                const key = exchangeCandleKey(exchangeId, symbol, tf);
                // Get the single most recent entry (highest score = most recent timestamp)
                const results = await redis.zrevrangebyscore(key, '+inf', '-inf', 'WITHSCORES', 'LIMIT', 0, 1);
                // results = [member, score] or empty
                tfResults[tf] = results.length >= 2 ? Number(results[1]) : null;
              } catch {
                tfResults[tf] = null;
              }
            })
          );

          timestamps[symbol] = tfResults;
        })
      );

      return { exchangeId, symbols, timestamps, ranks };
    }),
});

export type NetworkRouter = typeof networkRouter;
