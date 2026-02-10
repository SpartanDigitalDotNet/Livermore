# Phase 32: tRPC Network Router - Research

**Researched:** 2026-02-10
**Domain:** tRPC router for reading Redis instance status keys and Redis Streams activity logs
**Confidence:** HIGH

## Summary

Phase 32 adds a `network` tRPC router to expose three read-only endpoints for the Admin UI: `getInstances` (all exchange statuses), `getActivityLog` (paginated stream entries), and `getExchangeStatus` (single exchange). The entire pattern already exists in the codebase -- `exchange-symbol.router.ts` has an `exchangeStatuses` procedure that does the exact DB-query-then-Redis-GET pattern needed for `getInstances`. The only new technical surface is calling `redis.xrevrange()` for stream reading, and the ioredis type signature for this is verified in the installed `RedisCommander.d.ts`.

All required infrastructure is in place from Phases 30-31: `InstanceStatusSchema` and `InstanceStatus` type in `@livermore/schemas`, `instanceStatusKey()` and `networkActivityStreamKey()` in `@livermore/cache`, the `exchanges` database table with `id`, `name`, `displayName`, `isActive` columns, and the flat field-value format of stream entries matching `StateTransitionEntrySchema` and `ErrorEntrySchema`.

**Primary recommendation:** Follow the existing `exchangeStatuses` pattern exactly -- query the `exchanges` table for active exchanges, `GET` each instance status key by ID, parse JSON, and merge. For activity logs, use `redis.xrevrange(key, '+', '-', 'COUNT', count)` per exchange, merge across exchanges in application code (never multi-stream XREAD in Cluster).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @trpc/server | (already installed) | Router/procedure definitions | Already the API framework for all routers |
| ioredis | 5.4.2 | Redis commands (GET, XREVRANGE) | Already installed; `xrevrange` with COUNT overload verified in RedisCommander.d.ts |
| drizzle-orm | (already installed) | Database queries (exchanges table) | Already used in exchange-symbol.router.ts for same query pattern |
| zod | (already installed) | Input validation schemas | Already used for all tRPC input schemas |
| @livermore/schemas | workspace | InstanceStatusSchema, activity log schemas | Phase 30-31 output; all types already exported |
| @livermore/cache | workspace | getRedisClient, instanceStatusKey, networkActivityStreamKey | Phase 30-31 output; key builders ready |
| @livermore/database | workspace | getDbClient, exchanges table | Already used in exchange-symbol.router.ts |
| @livermore/trpc-config | workspace | router, protectedProcedure | Already used in all existing routers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @livermore/utils | workspace | createLogger | Logging in the router (follows control.router.ts pattern) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB query for exchange list | Redis SCAN/KEYS | SCAN is unreliable in Cluster (scans single node); DB is authoritative source |
| Individual GET per exchange | MGET | MGET fails with CROSSSLOT in Azure Redis Cluster; individual GETs are correct |
| Multi-stream XREAD | Individual XREVRANGE per exchange | XREAD with multiple keys fails with CROSSSLOT; must read each stream separately |

**Installation:**
```bash
# No new packages needed -- everything is already installed
```

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/routers/
  network.router.ts         # NEW: network.getInstances, getActivityLog, getExchangeStatus
  index.ts                  # MODIFIED: register network router
  control.router.ts         # REFERENCE: existing pattern
  exchange-symbol.router.ts # REFERENCE: DB+Redis merge pattern
```

### Pattern 1: DB-then-Redis Merge (for getInstances and getExchangeStatus)
**What:** Query the `exchanges` DB table for the authoritative list of exchange IDs, then `GET` each `exchange:{id}:status` Redis key. Merge results: exchanges with a valid key are "online" with full status; exchanges with no key (expired TTL) are "offline".
**When to use:** `getInstances` and `getExchangeStatus` -- any time you need to show status for known exchanges.
**Example:**
```typescript
// Source: exchange-symbol.router.ts lines 220-260 (existing pattern)
const db = getDbClient();
const exchangeList = await db
  .select({
    id: exchanges.id,
    name: exchanges.name,
    displayName: exchanges.displayName,
  })
  .from(exchanges)
  .where(eq(exchanges.isActive, true))
  .orderBy(asc(exchanges.id));

const redis = getRedisClient();
const results = await Promise.all(
  exchangeList.map(async (ex) => {
    const data = await redis.get(instanceStatusKey(ex.id));
    if (data) {
      const status = JSON.parse(data) as InstanceStatus;
      return { ...ex, online: true, status };
    }
    return { ...ex, online: false, status: null };
  })
);
```

### Pattern 2: XREVRANGE for Reverse-Chronological Stream Reading (for getActivityLog)
**What:** Read recent stream entries newest-first using `xrevrange` with COUNT for pagination. For multiple exchanges, read each stream individually and merge in application code.
**When to use:** `getActivityLog` endpoint.
**Example:**
```typescript
// Source: ioredis RedisCommander.d.ts lines 5776-5779 (verified type signature)
// xrevrange(key, end, start, 'COUNT', count) -> [id: string, fields: string[]][]

const streamKey = networkActivityStreamKey(exchangeName);
const entries = await redis.xrevrange(
  streamKey,
  '+',       // end = latest
  '-',       // start = earliest
  'COUNT', count
);

// Parse flat field array into objects
const parsed = entries.map(([id, fields]) => {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return { id, ...obj };
});
```

### Pattern 3: Cursor-Based Pagination with Stream IDs
**What:** Use the last stream entry ID as a cursor for pagination. On next page, pass that ID as the `end` parameter instead of `+`.
**When to use:** When `getActivityLog` needs "load more" functionality.
**Example:**
```typescript
// First page: end = '+'
// Subsequent pages: end = lastEntryId (exclusive, so subtract 1 from sequence)
const end = cursor ?? '+';
const entries = await redis.xrevrange(streamKey, end, '-', 'COUNT', count);

// The cursor for the next page is the ID of the last returned entry
const nextCursor = entries.length > 0 ? entries[entries.length - 1][0] : null;
```
**Note on cursor exclusivity:** XREVRANGE is inclusive on both ends. To avoid duplicating the boundary entry, the cursor value passed for the next page should have its sequence number decremented or the application should skip the first entry if it matches the previous cursor. Simplest approach: use the last entry's ID directly and skip it on the next read.

### Pattern 4: Multi-Exchange Activity Log Merge
**What:** When no specific exchange is filtered, read streams for all known exchanges individually (to avoid CROSSSLOT), merge entries, sort by timestamp, and return top N.
**When to use:** `getActivityLog` without exchange filter (global view).
**Example:**
```typescript
// Read each exchange's stream separately (CROSSSLOT safe)
const allEntries = await Promise.all(
  exchangeList.map(async (ex) => {
    const key = networkActivityStreamKey(ex.name);
    try {
      return await redis.xrevrange(key, '+', '-', 'COUNT', count);
    } catch {
      return []; // Stream may not exist yet
    }
  })
);

// Flatten, parse, sort by stream ID (which is timestamp-based), take top N
const merged = allEntries
  .flat()
  .map(([id, fields]) => ({ id, ...parseFields(fields) }))
  .sort((a, b) => b.id.localeCompare(a.id)) // Reverse chronological
  .slice(0, count);
```

### Anti-Patterns to Avoid
- **Using `redis.keys('exchange:*:status')`:** KEYS only scans the connected node in Cluster. Use the known exchange IDs from the DB.
- **Using multi-stream XREAD:** `XREAD STREAMS logs:network:coinbase logs:network:binance 0-0 0-0` fails with CROSSSLOT in Azure Redis Cluster. Read each stream individually.
- **Using MGET for multiple status keys:** MGET requires all keys to hash to the same slot. Individual GET calls are correct for cross-slot keys.
- **Parsing stream entries with JSON.parse:** Stream entries are flat field-value arrays, NOT JSON strings. Parse by iterating pairs.
- **Using publicProcedure:** STATE.md lists "routers use publicProcedure" as HIGH priority tech debt. New routers MUST use `protectedProcedure`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exchange list discovery | Redis SCAN for instance keys | `exchanges` DB table + individual GET | DB is authoritative; SCAN unreliable in Cluster |
| Stream entry parser | Custom per-field parsing | Shared `parseStreamFields()` helper | Flat field-value arrays are uniform across all stream entries |
| Pagination cursor logic | Offset-based pagination | Redis Stream ID as cursor | Stream IDs are naturally ordered and unique; offset is meaningless in streams |
| Input validation | Manual type checking | Zod schemas on tRPC input | All existing routers use Zod for input; consistent pattern |
| Offline instance detection | Heartbeat polling from router | Absence of Redis key (TTL expired) | InstanceRegistryService already manages TTL; key missing = offline |

**Key insight:** The entire DB+Redis merge pattern for `getInstances` is already implemented in `exchange-symbol.router.ts:exchangeStatuses` (lines 220-260). The only genuinely new code is the XREVRANGE call for reading streams and the field-parsing helper.

## Common Pitfalls

### Pitfall 1: CROSSSLOT Errors in Azure Redis Cluster
**What goes wrong:** Using MGET, multi-key DEL, or multi-stream XREAD with keys that hash to different slots causes CROSSSLOT errors.
**Why it happens:** Azure Managed Redis with OSS Cluster mode distributes keys across hash slots. Multi-key commands require all keys to be on the same slot.
**How to avoid:** Always use individual GET/XREVRANGE calls per key. Use `Promise.all()` for parallelism.
**Warning signs:** Runtime error containing "CROSSSLOT" in the message.

### Pitfall 2: Stream Key May Not Exist Yet
**What goes wrong:** Calling `xrevrange` on a stream key that hasn't been created yet (no XADD ever done for that exchange) returns an error or unexpected result.
**Why it happens:** If an exchange is in the DB but has never been started, its `logs:network:{name}` stream doesn't exist.
**How to avoid:** Wrap XREVRANGE calls in try-catch and return empty array for non-existent streams. ioredis returns an empty array for XREVRANGE on a non-existent key (verified in Redis docs), but the key type mismatch if a non-stream key exists would error.
**Warning signs:** Empty stream results even when expecting data; or errors on first-ever query.

### Pitfall 3: JSON.parse on InstanceStatus Key Can Fail
**What goes wrong:** If the Redis key contains malformed data, `JSON.parse()` throws and crashes the procedure.
**Why it happens:** Key corruption, incomplete writes, or legacy data format.
**How to avoid:** Wrap JSON.parse in try-catch. On failure, treat as offline. The existing `exchangeStatuses` uses a try-catch around the entire Redis block.
**Warning signs:** 500 errors on `getInstances` when Redis has stale data.

### Pitfall 4: Activity Log Merge Produces Duplicate Entries at Page Boundaries
**What goes wrong:** When paginating across multiple exchange streams with cursor-based pagination, the merge-and-sort-across-streams logic can show duplicate entries or skip entries at page boundaries.
**Why it happens:** Each stream has independent IDs. A cursor from exchange A's stream doesn't apply to exchange B's stream.
**How to avoid:** For the global (multi-exchange) activity log, simplify: read the last N entries from each stream, merge and sort, return top N. Cursor-based pagination across multiple independent streams is complex; for v1, use simple "last N" without deep pagination. If exchange filtering is provided, cursor pagination on a single stream works cleanly.
**Warning signs:** Users see the same entry twice when scrolling.

### Pitfall 5: ioredis Cluster xrevrange Return Type
**What goes wrong:** In Cluster mode, ioredis may return slightly different types (Buffer vs string) depending on configuration.
**Why it happens:** Cluster mode can behave differently from standalone for some commands.
**How to avoid:** Use the string overload (default). Ensure `xrevrange` (not `xrevrangeBuffer`) is called. The return type is `[id: string, fields: string[]][]`.
**Warning signs:** TypeScript type errors or runtime `.toString()` calls needed.

## Code Examples

### Complete getInstances Procedure
```typescript
// Source: Adapted from exchange-symbol.router.ts:exchangeStatuses (lines 220-260)
import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, exchanges } from '@livermore/database';
import { getRedisClient, instanceStatusKey, networkActivityStreamKey } from '@livermore/cache';
import { eq, asc } from 'drizzle-orm';
import type { InstanceStatus } from '@livermore/schemas';

// getInstances: returns all exchanges with their instance status (online/offline)
getInstances: protectedProcedure.query(async () => {
  const db = getDbClient();
  const redis = getRedisClient();

  // Step 1: Get authoritative exchange list from DB (not SCAN)
  const exchangeList = await db
    .select({
      id: exchanges.id,
      name: exchanges.name,
      displayName: exchanges.displayName,
    })
    .from(exchanges)
    .where(eq(exchanges.isActive, true))
    .orderBy(asc(exchanges.id));

  // Step 2: GET each instance status key (parallel, no MGET for cluster safety)
  const instances = await Promise.all(
    exchangeList.map(async (ex) => {
      const key = instanceStatusKey(ex.id);
      try {
        const data = await redis.get(key);
        if (data) {
          const status = JSON.parse(data) as InstanceStatus;
          return {
            exchangeId: ex.id,
            exchangeName: ex.name,
            displayName: ex.displayName,
            online: true,
            status,
          };
        }
      } catch {
        // JSON parse failure or Redis error -- treat as offline
      }
      return {
        exchangeId: ex.id,
        exchangeName: ex.name,
        displayName: ex.displayName,
        online: false,
        status: null,
      };
    })
  );

  return { instances };
}),
```

### Complete getActivityLog Procedure
```typescript
// Source: ioredis RedisCommander.d.ts line 5778 (xrevrange with COUNT)
// Source: Phase 31 RESEARCH.md lines 309-330 (parsing pattern)

getActivityLog: protectedProcedure
  .input(z.object({
    exchangeName: z.string().optional(),  // Filter to single exchange
    count: z.number().min(1).max(200).default(50),
    cursor: z.string().optional(),        // Stream ID for pagination (single-exchange only)
  }))
  .query(async ({ input }) => {
    const db = getDbClient();
    const redis = getRedisClient();
    const { exchangeName, count, cursor } = input;

    // Helper: parse flat field-value array into object
    function parseStreamEntry(id: string, fields: string[]): Record<string, string> & { id: string } {
      const obj: Record<string, string> = { id };
      for (let i = 0; i < fields.length; i += 2) {
        obj[fields[i]] = fields[i + 1];
      }
      return obj as Record<string, string> & { id: string };
    }

    if (exchangeName) {
      // Single-exchange mode: cursor pagination works cleanly
      const streamKey = networkActivityStreamKey(exchangeName);
      const end = cursor ?? '+';
      try {
        const raw = await redis.xrevrange(streamKey, end, '-', 'COUNT', count + 1);
        // If cursor was provided, first entry may be the cursor itself (inclusive)
        const entries = cursor && raw.length > 0 && raw[0][0] === cursor
          ? raw.slice(1)
          : raw;
        const limited = entries.slice(0, count);
        const parsed = limited.map(([id, fields]) => parseStreamEntry(id, fields));
        const nextCursor = limited.length === count ? limited[limited.length - 1][0] : null;
        return { entries: parsed, nextCursor };
      } catch {
        return { entries: [], nextCursor: null };
      }
    }

    // Global mode: read from all exchanges, merge, return top N
    const exchangeList = await db
      .select({ name: exchanges.name })
      .from(exchanges)
      .where(eq(exchanges.isActive, true));

    const allRaw = await Promise.all(
      exchangeList.map(async (ex) => {
        const key = networkActivityStreamKey(ex.name);
        try {
          return await redis.xrevrange(key, '+', '-', 'COUNT', count);
        } catch {
          return [];
        }
      })
    );

    const merged = allRaw
      .flat()
      .map(([id, fields]) => parseStreamEntry(id, fields))
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, count);

    return { entries: merged, nextCursor: null }; // No cursor in global mode
  }),
```

### Complete getExchangeStatus Procedure
```typescript
getExchangeStatus: protectedProcedure
  .input(z.object({
    exchangeId: z.number(),
  }))
  .query(async ({ input }) => {
    const redis = getRedisClient();
    const key = instanceStatusKey(input.exchangeId);

    try {
      const data = await redis.get(key);
      if (data) {
        const status = JSON.parse(data) as InstanceStatus;
        return { online: true, status };
      }
    } catch {
      // Parse error or Redis error
    }

    return { online: false, status: null };
  }),
```

### Router Registration (index.ts)
```typescript
// apps/api/src/routers/index.ts
import { networkRouter } from './network.router';

export const appRouter = router({
  // ... existing routers
  network: networkRouter,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `redis.keys('exchange:*:status')` | DB query + individual GET | Phase 30 (2026-02-10) | Cluster-safe; no SCAN needed |
| Single activity stream | Per-exchange streams `logs:network:{name}` | Phase 31 (2026-02-10) | Each stream is one key = inherently cluster-safe |
| publicProcedure everywhere | protectedProcedure for new routers | STATE.md tech debt | New router MUST use protectedProcedure |

**Deprecated/outdated:**
- `publicProcedure` usage in existing routers: HIGH priority tech debt per STATE.md. Do NOT follow that pattern in network router.
- `exchange:status` (old prototype key without exchange ID): Replaced by `exchange:{exchangeId}:status` in Phase 30.

## Open Questions

Things that couldn't be fully resolved:

1. **Global activity log pagination across multiple streams**
   - What we know: XREVRANGE works cleanly for single-stream cursor pagination. For global (multi-exchange) view, stream IDs from different exchanges are independent but timestamp-based so they sort correctly across exchanges.
   - What's unclear: Whether deep pagination (page 5+) across multiple streams is needed for v1. Each page requires reading N entries from ALL exchanges and merging.
   - Recommendation: For v1, support cursor-based pagination only when filtering by single exchange. Global mode returns last N entries without deep pagination. Phase 33 UI can add exchange filtering to enable deep scrolling.

2. **Should getExchangeStatus also return recent activity log entries?**
   - What we know: RPC-03 says "returns status for a single exchange by ID." No mention of log entries.
   - What's unclear: Whether the Phase 33 UI will want a combined status+log view per exchange.
   - Recommendation: Keep getExchangeStatus lean (just instance status). The UI can call getActivityLog with exchangeName filter for the combined view. Two small calls are better than one bloated one.

3. **ioredis xrevrange on non-existent stream key behavior**
   - What we know: Redis XREVRANGE on a non-existent key returns an empty array (not an error) per Redis documentation.
   - What's unclear: Whether ioredis Cluster client handles this identically to standalone.
   - Recommendation: Wrap in try-catch regardless. Return empty array on any error. This is defensive and costs nothing.

## Sources

### Primary (HIGH confidence)
- `packages/trpc-config/src/trpc.ts` -- router, protectedProcedure, publicProcedure definitions (lines 52-54)
- `packages/trpc-config/src/context.ts` -- BaseContext and AuthenticatedContext types
- `apps/api/src/routers/exchange-symbol.router.ts` -- `exchangeStatuses` procedure (lines 220-260): exact DB+Redis merge pattern
- `apps/api/src/routers/control.router.ts` -- protectedProcedure usage, mutation patterns
- `apps/api/src/routers/index.ts` -- router registration pattern
- `packages/schemas/src/network/instance-status.schema.ts` -- InstanceStatus type definition
- `packages/schemas/src/network/activity-log.schema.ts` -- StateTransitionEntry, ErrorEntry, NetworkActivityEntry
- `packages/cache/src/keys.ts` -- instanceStatusKey(), networkActivityStreamKey()
- `packages/database/src/schema/exchanges.ts` -- exchanges table schema (id, name, displayName, isActive)
- `packages/database/src/client.ts` -- getDbClient() singleton pattern
- `packages/cache/src/client.ts` -- getRedisClient() singleton, RedisClient type (Redis | Cluster)
- `node_modules/.pnpm/ioredis@5.4.2/node_modules/ioredis/built/utils/RedisCommander.d.ts` lines 5776-5779 -- xrevrange type signature verified
- `.planning/phases/31-network-activity-logging/31-RESEARCH.md` lines 309-330 -- XREVRANGE code patterns and field parsing
- `.planning/STATE.md` -- tech debt noting publicProcedure is HIGH priority issue
- `.planning/REQUIREMENTS.md` -- RPC-01, RPC-02, RPC-03 definitions
- `.planning/research/PITFALLS.md` -- CROSSSLOT pitfall documentation

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` lines 360-402 -- network router pseudocode and Admin UI polling patterns

### Tertiary (LOW confidence)
- None. All findings are from direct codebase inspection and verified type definitions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed and used in existing routers; no new dependencies
- Architecture: HIGH -- DB+Redis merge pattern already implemented in exchangeStatuses; XREVRANGE verified in ioredis types
- Pitfalls: HIGH -- CROSSSLOT documented in prior research and verified against Azure Redis Cluster configuration in client.ts
- Code examples: HIGH -- Adapted directly from existing working code (exchange-symbol.router.ts lines 220-260)

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable -- no external dependencies or rapidly changing APIs)
