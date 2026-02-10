# Phase 31: Network Activity Logging - Research

**Researched:** 2026-02-10
**Domain:** Redis Streams event logging with ioredis in Azure Redis Cluster
**Confidence:** HIGH

## Summary

Phase 31 adds durable event logging for state transitions and errors using Redis Streams. The codebase already has a clean `StateMachineService.transition()` method and `InstanceRegistryService.recordError()` method from Phase 30 -- these are the exact hook points for logging. Redis Streams are a natural fit: each exchange gets its own stream key (`logs:network:{exchange_name}`), entries are auto-timestamped, and MINID-based trimming provides time-based retention with zero external cron jobs.

The ioredis library (v5.4.2) already in the project supports all required stream commands (`xadd`, `xrevrange`, `xlen`) with full TypeScript types. Redis Streams operate on single keys, making them inherently safe in Azure Redis Cluster (OSS Cluster mode). The MINID trimming strategy (available since Redis 6.2, Azure Managed Redis runs 7.4+) enables 90-day retention by computing `Date.now() - 90_DAYS_MS` on every XADD.

The recommended architecture is a standalone `NetworkActivityLogger` service that is injected into `StateMachineService` (for transitions) and called from error handlers. This keeps logging concerns separated from state machine logic and makes it easy to test independently.

**Primary recommendation:** Create a `NetworkActivityLogger` class that wraps `redis.xadd()` with MINID trimming, inject it into `StateMachineService` as an optional dependency, and call it from existing `recordError()` call sites. Define Zod schemas for log entry types in `@livermore/schemas`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | 5.4.2 | Redis client with Streams support | Already in project, supports XADD/XREVRANGE/XLEN natively on both Redis and Cluster |
| zod | (existing) | Log entry schema validation | Already used throughout for schemas; consistent pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | - | No additional dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Redis Streams | PostgreSQL event log | Streams are faster for append-only audit logs; DB adds latency to hot path. Streams already in Redis, no extra infra. |
| MINID trimming | MAXLEN trimming | MINID is time-based (90 days exactly); MAXLEN is count-based (would need to estimate entry rate). MINID is more predictable for retention policy. |
| Inline XADD trimming | Separate XTRIM cron | Inline is simpler (no scheduler), atomic with the write, and recommended by Redis docs. |

**Installation:**
```bash
# No new packages needed -- ioredis and zod already in project
```

## Architecture Patterns

### Recommended Project Structure
```
packages/schemas/src/network/
  instance-status.schema.ts        # (existing) InstanceStatus
  activity-log.schema.ts           # (NEW) NetworkActivityEntry, StateTransitionEntry, ErrorEntry

packages/cache/src/
  keys.ts                          # (MODIFY) Add networkActivityStreamKey()
  index.ts                         # (no change, keys.ts already exported)

apps/api/src/services/
  network-activity-logger.ts       # (NEW) NetworkActivityLogger class
  state-machine.service.ts         # (MODIFY) Add optional logger injection
  instance-registry.service.ts     # (no change -- error logging called from control-channel)
  control-channel.service.ts       # (MODIFY) Call logger on error
  types/service-registry.ts        # (MODIFY) Add activityLogger field
  server.ts                        # (MODIFY) Create and wire logger
```

### Pattern 1: Dedicated Logger Service (not hooks inside StateMachine)
**What:** A standalone `NetworkActivityLogger` service wraps all Redis Streams operations. StateMachineService calls it after successful transitions. Error handlers call it for error events.
**When to use:** Always. Separation of concerns keeps state machine testable without Redis Streams mocking.
**Example:**
```typescript
// NetworkActivityLogger - fire-and-forget pattern
export class NetworkActivityLogger {
  private readonly redis: RedisClient;
  private readonly exchangeName: string;
  private readonly exchangeId: number;
  private readonly hostname: string;
  private readonly ip: string | null;
  private readonly adminEmail: string | null;

  async logTransition(from: ConnectionState, to: ConnectionState): Promise<void> {
    const streamKey = networkActivityStreamKey(this.exchangeName);
    const minId = this.computeMinId();
    try {
      await this.redis.xadd(
        streamKey, 'MINID', '~', minId, '*',
        'event', 'state_transition',
        'timestamp', new Date().toISOString(),
        'fromState', from,
        'toState', to,
        'exchangeId', String(this.exchangeId),
        'exchangeName', this.exchangeName,
        'hostname', this.hostname,
        'ip', this.ip ?? '',
        'adminEmail', this.adminEmail ?? ''
      );
    } catch (err) {
      // Fire-and-forget: log failure but never throw
      logger.error({ err }, 'Failed to log state transition to stream');
    }
  }

  async logError(error: string, currentState: ConnectionState): Promise<void> {
    const streamKey = networkActivityStreamKey(this.exchangeName);
    const minId = this.computeMinId();
    try {
      await this.redis.xadd(
        streamKey, 'MINID', '~', minId, '*',
        'event', 'error',
        'timestamp', new Date().toISOString(),
        'error', error,
        'exchangeId', String(this.exchangeId),
        'exchangeName', this.exchangeName,
        'hostname', this.hostname,
        'ip', this.ip ?? '',
        'state', currentState
      );
    } catch (err) {
      logger.error({ err }, 'Failed to log error to stream');
    }
  }

  private computeMinId(): string {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    return `${Date.now() - NINETY_DAYS_MS}-0`;
  }
}
```

### Pattern 2: ioredis XADD with MINID Approximate Trimming
**What:** Use `redis.xadd(key, 'MINID', '~', threshold, '*', ...fields)` for every write. The `~` (approximate) modifier is more efficient than exact `=` because it aligns with Redis's internal radix tree structure.
**When to use:** Every XADD call.
**Example:**
```typescript
// ioredis xadd signature: variadic (...args: RedisValue[])
// Arguments mirror the Redis CLI command exactly as positional strings
const entryId = await redis.xadd(
  'logs:network:coinbase',   // key
  'MINID', '~',              // trimming strategy (approximate)
  '1699747200000-0',         // MINID threshold (90 days ago in ms)
  '*',                       // auto-generate stream ID
  'event', 'state_transition',
  'timestamp', '2026-02-10T14:30:00.000Z',
  'fromState', 'idle',
  'toState', 'starting'
  // ... more field-value pairs
);
// entryId = '1707574200000-0' (auto-generated timestamp-sequence)
```

### Pattern 3: Reading Streams for Phase 32 (future tRPC router)
**What:** Use `xrevrange` for reverse-chronological reading with COUNT for pagination.
**When to use:** Phase 32 will use this pattern.
**Example:**
```typescript
// Read last 50 entries (newest first)
const entries = await redis.xrevrange(
  'logs:network:coinbase',
  '+',     // end = latest
  '-',     // start = earliest
  'COUNT', 50
);
// entries = [['1707574200000-0', ['event', 'state_transition', ...]], ...]
```

### Anti-Patterns to Avoid
- **Logging inside heartbeatTick():** Requirement LOG-06 explicitly forbids logging heartbeats. The heartbeat timer in InstanceRegistryService must NOT call the logger.
- **Throwing from logger:** Activity logging must be fire-and-forget. A Redis Streams failure must never crash the state machine or block startup.
- **Using MAXLEN instead of MINID:** MAXLEN caps by count, which makes retention time unpredictable. MINID caps by time, which directly maps to the 90-day requirement.
- **Storing complex objects as single field values:** Redis Streams use flat field-value pairs. Do not JSON-stringify the entire entry into one field -- use separate fields for each property.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stream trimming scheduler | Custom cron/timer to trim old entries | `MINID ~` on every XADD | Inline trimming is atomic, requires no scheduler, recommended by Redis docs |
| Stream ID generation | Custom timestamp-sequence IDs | `*` auto-generation in XADD | Redis guarantees monotonic, unique IDs with `*`. Custom IDs risk collisions. |
| Retry logic for XADD | Custom retry wrapper | ioredis built-in retry strategy | ioredis already retries on connection errors via `retryStrategy` / `clusterRetryStrategy` |
| Stream key routing in cluster | Hash tags or manual slot management | Natural single-key routing | Each XADD targets one key = one slot = inherently cluster-safe |

**Key insight:** Redis Streams are designed as an append-only log with built-in trimming. The XADD command with MINID does everything needed for this phase in a single atomic operation. No external scheduler, no custom trimming logic, no consumer groups needed.

## Common Pitfalls

### Pitfall 1: XADD Field Values Must Be Strings
**What goes wrong:** Passing numbers or null directly to `redis.xadd()` causes type errors or unexpected behavior.
**Why it happens:** ioredis `xadd` accepts `RedisValue[]` which is `string | Buffer | number`, but null/undefined are not valid. Redis stores all stream field values as strings internally.
**How to avoid:** Convert all values to strings explicitly. Use `String(this.exchangeId)` for numbers, and `this.ip ?? ''` for nullable fields.
**Warning signs:** TypeScript errors on null arguments, or empty fields in stream entries.

### Pitfall 2: Approximate MINID May Not Trim Immediately
**What goes wrong:** After XADD with `MINID ~ threshold`, some entries older than 90 days may still exist.
**Why it happens:** The `~` modifier allows Redis to optimize by trimming at macro-node boundaries rather than exact entry boundaries. This can leave a few extra entries.
**How to avoid:** Accept this behavior -- it is by design and saves performance. The extra entries are minimal (a few dozen at most) and will be cleaned up on subsequent XADDs.
**Warning signs:** Expecting exact 90-day cutoff in tests. Use approximate assertions.

### Pitfall 3: Stream Key Naming with Exchange Name (Not ID)
**What goes wrong:** Using exchange ID in the stream key (`logs:network:1`) instead of exchange name (`logs:network:coinbase`) as the requirement specifies.
**Why it happens:** The rest of the codebase uses exchange ID for key scoping (e.g., `exchange:{exchangeId}:status`). But LOG-01 explicitly specifies exchange name.
**How to avoid:** The key builder function must accept `exchangeName: string` and produce `logs:network:{exchange_name}`. Normalize the name to lowercase for consistency.
**Warning signs:** Stream keys with numbers instead of names.

### Pitfall 4: Forgetting to Update Logger Identity After IP Detection
**What goes wrong:** Early log entries (during startup) show empty IP because `detectPublicIp()` runs asynchronously after registration.
**Why it happens:** `NetworkActivityLogger` is created before IP is known. The `idle->starting` transition happens before IP detection completes.
**How to avoid:** Allow the logger to accept a mutable reference to identity fields (or have a `setIp()` method like `InstanceRegistryService` does). Alternatively, accept that the first 1-2 log entries may have no IP -- this is acceptable for an audit log.
**Warning signs:** First few entries in stream always have empty IP field.

### Pitfall 5: Error Events Need Current State, Not From/To
**What goes wrong:** Trying to log `fromState` and `toState` for error events when errors are not transitions.
**Why it happens:** Conflating LOG-02 (transition events) with LOG-03 (error events). They have different schemas.
**How to avoid:** Error events log `state` (current state at time of error), not `fromState`/`toState`. The Zod schemas should enforce this distinction with a discriminated union on the `event` field.
**Warning signs:** Error log entries with null/undefined fromState/toState.

## Code Examples

### Key Builder Function
```typescript
// In packages/cache/src/keys.ts
/**
 * Build Redis Stream key for network activity logging.
 * Phase 31: One stream per exchange, keyed by normalized name.
 *
 * @example networkActivityStreamKey('Coinbase') // 'logs:network:coinbase'
 */
export function networkActivityStreamKey(exchangeName: string): string {
  return `logs:network:${exchangeName.toLowerCase()}`;
}
```

### Zod Schemas for Log Entries
```typescript
// In packages/schemas/src/network/activity-log.schema.ts
import { z } from 'zod';
import { ConnectionStateSchema } from './instance-status.schema';

// Base fields present on ALL log entry types
const BaseLogEntrySchema = z.object({
  timestamp: z.string(), // ISO 8601
  exchangeId: z.string(), // String because Redis stores as string
  exchangeName: z.string(),
  hostname: z.string(),
  ip: z.string(), // Empty string if unknown
});

// LOG-02: State transition event
export const StateTransitionEntrySchema = BaseLogEntrySchema.extend({
  event: z.literal('state_transition'),
  fromState: ConnectionStateSchema,
  toState: ConnectionStateSchema,
  adminEmail: z.string(),
});

// LOG-03: Error event
export const ErrorEntrySchema = BaseLogEntrySchema.extend({
  event: z.literal('error'),
  error: z.string(),
  state: ConnectionStateSchema,
});

// Discriminated union for all event types
export const NetworkActivityEntrySchema = z.discriminatedUnion('event', [
  StateTransitionEntrySchema,
  ErrorEntrySchema,
]);

export type StateTransitionEntry = z.infer<typeof StateTransitionEntrySchema>;
export type ErrorEntry = z.infer<typeof ErrorEntrySchema>;
export type NetworkActivityEntry = z.infer<typeof NetworkActivityEntrySchema>;
```

### XADD with MINID Trimming (ioredis API)
```typescript
// Source: ioredis RedisCommander.d.ts line 4552 + Redis XADD docs
// ioredis xadd is variadic: xadd(key, ...args: RedisValue[])
// Args mirror Redis CLI: XADD key [MINID ~ threshold] * field value [field value ...]

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000; // 7_776_000_000

// State transition event
const minId = `${Date.now() - NINETY_DAYS_MS}-0`;
await redis.xadd(
  'logs:network:coinbase',
  'MINID', '~', minId,
  '*',
  'event', 'state_transition',
  'timestamp', new Date().toISOString(),
  'fromState', 'idle',
  'toState', 'starting',
  'exchangeId', '1',
  'exchangeName', 'coinbase',
  'hostname', 'DESKTOP-ABC',
  'ip', '203.0.113.42',
  'adminEmail', 'admin@example.com'
);

// Error event
await redis.xadd(
  'logs:network:coinbase',
  'MINID', '~', minId,
  '*',
  'event', 'error',
  'timestamp', new Date().toISOString(),
  'error', 'WebSocket connection timeout after 10000ms',
  'exchangeId', '1',
  'exchangeName', 'coinbase',
  'hostname', 'DESKTOP-ABC',
  'ip', '203.0.113.42',
  'state', 'warming'
);
```

### XREVRANGE for Reading (Phase 32 reference)
```typescript
// Source: ioredis RedisCommander.d.ts line 5776-5779
// xrevrange(key, end, start, 'COUNT', count) -> [id, fields][]

const entries = await redis.xrevrange(
  'logs:network:coinbase',
  '+',     // end: latest
  '-',     // start: earliest
  'COUNT', '50'
);

// entries shape: [['1707574200000-0', ['event', 'state_transition', 'timestamp', '...', ...]], ...]
// Fields are flat array of alternating key-value strings
// Parse into object:
function parseStreamEntry(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj;
}
```

### Integration into StateMachineService
```typescript
// Modified transition() method in state-machine.service.ts
export class StateMachineService {
  private currentState: ConnectionState = 'idle';
  private registry: InstanceRegistryService;
  private activityLogger: NetworkActivityLogger | null;

  constructor(registry: InstanceRegistryService, activityLogger?: NetworkActivityLogger) {
    this.registry = registry;
    this.activityLogger = activityLogger ?? null;
  }

  async transition(to: ConnectionState): Promise<void> {
    const from = this.currentState;
    // ... existing validation and state update logic ...

    // Log to stream (fire-and-forget, after successful transition)
    if (this.activityLogger) {
      this.activityLogger.logTransition(from, to).catch(() => {
        // Already logged inside logTransition; swallow here
      });
    }

    logger.info({ from, to }, 'State transition');
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MAXLEN for stream trimming | MINID for time-based retention | Redis 6.2 (2021) | Direct time-based retention without count estimation |
| Exact trimming (`=`) | Approximate trimming (`~`) | Redis 6.2 (2021) | 10-100x more efficient, recommended default |
| Consumer groups for audit logs | Simple XREVRANGE reads | Always available | Consumer groups add complexity; audit logs only need reverse-chronological reads |

**Deprecated/outdated:**
- Consumer groups (XREADGROUP) for this use case: overkill per REQUIREMENTS.md "Out of Scope" section
- MAXLEN-based trimming for time-retention: MINID is the purpose-built alternative

## Open Questions

1. **Exchange name normalization**
   - What we know: LOG-01 says `logs:network:{exchange_name}`. Current `exchangeName` values in the codebase are "Coinbase" (capitalized).
   - What's unclear: Should the key use `coinbase` (lowercase) or `Coinbase` (as-is)?
   - Recommendation: Lowercase. Key builder should call `.toLowerCase()`. This matches common Redis key conventions and avoids case-sensitivity issues.

2. **Logger identity update for IP**
   - What we know: IP is detected asynchronously after registration. First few transitions (idle->starting) happen before IP is known.
   - What's unclear: Is it acceptable for early log entries to have empty IP?
   - Recommendation: Yes, accept it. Add a `setIp(ip: string)` method on the logger, called from the same `detectPublicIp()` callback that updates the registry. Early entries will show empty IP, which is honest and expected.

3. **Error logging call sites**
   - What we know: `recordError()` is called from control-channel.service.ts line 610. But errors also come from other places (adapter errors, Redis errors).
   - What's unclear: Should we log ALL errors or only the ones that call `recordError()`?
   - Recommendation: Log from the same call sites that currently call `recordError()`. This keeps LOG-03 scoped to meaningful errors. The logger should also be callable independently for additional error sites if needed.

## Sources

### Primary (HIGH confidence)
- ioredis `RedisCommander.d.ts` (local: `node_modules/.pnpm/ioredis@5.4.2/node_modules/ioredis/built/utils/RedisCommander.d.ts`) - xadd, xrevrange, xlen, xtrim type signatures verified
- Redis XADD official docs (https://redis.io/docs/latest/commands/xadd/) - MINID syntax, approximate trimming, stream ID format
- Redis Streams docs (https://redis.io/docs/latest/develop/data-types/streams/) - stream data type architecture
- Local codebase: `state-machine.service.ts`, `instance-registry.service.ts`, `control-channel.service.ts` - hook points verified

### Secondary (MEDIUM confidence)
- Azure Managed Redis architecture (https://learn.microsoft.com/en-us/azure/redis/architecture) - Runs Redis 7.4+, supports MINID (6.2+ feature)
- Redis cluster specification (https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) - Single-key commands are cluster-safe

### Tertiary (LOW confidence)
- None. All findings verified with primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - ioredis types verified locally, no new dependencies
- Architecture: HIGH - hook points identified in existing code, patterns verified against ioredis types
- Pitfalls: HIGH - derived from codebase analysis and Redis docs
- Cluster safety: HIGH - Redis single-key commands are inherently cluster-safe per spec

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days -- stable domain, no fast-moving dependencies)
