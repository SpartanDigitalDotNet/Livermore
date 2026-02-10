# Stack Research: v6.0 Perseus Network - Distributed Instance Coordination

**Project:** Livermore Trading Platform - Instance Registration, Heartbeat, Activity Logging
**Researched:** 2026-02-10
**Confidence:** HIGH (verified against installed ioredis 5.4.2 type definitions and Redis official docs)

## Executive Summary

v6.0 Perseus Network requires distributed instance registration, heartbeat health monitoring, and network activity logging. The good news: the existing stack (ioredis 5.4.2 on Azure Managed Redis with OSS Cluster mode) already has full support for every Redis primitive needed. No new Redis client library is required. Redis Streams (XADD, XRANGE, XTRIM with MINID) are natively supported by ioredis 5.4.2 with complete TypeScript type definitions. The key additions are: (1) a lightweight state machine for instance lifecycle, (2) public IP detection for instance identity, and (3) a disciplined approach to Redis key design for cluster compatibility.

**Key Decision:** Build the state machine in-house rather than importing a library. The instance lifecycle has exactly 5 states and 7 transitions -- XState is extreme overkill, and the micro-libraries (typescript-fsm, typestate) add dependencies for what amounts to ~80 lines of typed code.

---

## Recommended Stack

### Core Infrastructure (Already Installed -- No Changes)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| ioredis | 5.4.2 (pinned) | Redis client with Cluster + Streams support | INSTALLED |
| Redis (Azure Managed) | 6.x+ (OSS Cluster) | Coordination bus, streams, TTL-based heartbeat | PRODUCTION |
| TypeScript | 5.9.3 | Type safety for state machine, stream entries | INSTALLED |
| Zod | 3.25.x | Schema validation for stream entries, registration payloads | INSTALLED |
| Pino | 9.x/10.x | Structured logging | INSTALLED |

### New Dependencies

| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **None required** | -- | -- | Everything builds on existing stack |

**This is a zero-new-dependency milestone.** All capabilities come from ioredis primitives already available.

### Public IP Detection (No Library)

**Recommendation: Use Node.js built-in `https` module to query a single service.**

Do NOT install `public-ip` (sindresorhus). Reasons:
- v7+ and v8.0.0 are **ESM-only** (pure ESM package). The Livermore monorepo builds with tsup to both ESM and CJS (`--format esm,cjs`). Importing a pure-ESM package from CJS output causes runtime failures.
- The package's DNS-based detection (OpenDNS, Google DNS) is overkill for a server that needs its IP once at startup.
- Zero-dependency alternatives like `node-public-ip` have 1 weekly download and are effectively abandoned.

**Instead, use a 10-line utility function:**

```typescript
import https from 'node:https';

/**
 * Detect public IPv4 address by querying a lightweight HTTP service.
 * Falls back gracefully if detection fails (non-critical for operation).
 */
export async function detectPublicIp(timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org', { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data.trim() || null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
```

**Why ipify.org:**
- Free, no API key required
- Returns plain-text IPv4 address (no JSON parsing needed)
- High availability, used by millions of services
- Single HTTPS call, no DNS tricks

**Fallback chain (if ipify fails):**
- `https://icanhazip.com` (Cloudflare-owned)
- `https://ifconfig.me/ip`
- Return `null` (public IP is informational, not critical)

**Confidence:** HIGH -- ipify.org is a well-established service. The implementation uses only Node.js built-in `https`.

---

## Redis Streams: ioredis API Reference

**Verified:** All method signatures confirmed present in `ioredis@5.4.2` type definitions at `node_modules/.pnpm/ioredis@5.4.2/.../RedisCommander.d.ts`.

### XADD -- Add Entry to Stream

```typescript
// Auto-generated ID (timestamp-based)
const entryId = await redis.xadd(
  'perseus:activity',         // stream key
  '*',                        // auto-generate ID
  'instanceId', instanceId,   // field-value pairs
  'event', 'REGISTERED',
  'exchange', 'coinbase',
  'timestamp', Date.now().toString()
);
// Returns: "1707580800000-0" (timestamp-sequence)

// With MAXLEN trimming on write (approximate)
const entryId = await redis.xadd(
  'perseus:activity',
  'MAXLEN', '~', '100000',    // keep ~100K entries max
  '*',
  'instanceId', instanceId,
  'event', 'HEARTBEAT'
);
```

**Type signature (from RedisCommander.d.ts):**
```typescript
xadd(...args: [key: RedisKey, ...args: RedisValue[]]): Result<string | null, Context>;
```

### XRANGE -- Read Range of Entries

```typescript
// Read all entries
const entries = await redis.xrange('perseus:activity', '-', '+');
// Returns: [["1707580800000-0", ["instanceId", "abc", "event", "REGISTERED"]], ...]

// Read entries in a time window (last 24 hours)
const since = (Date.now() - 86400000).toString();
const entries = await redis.xrange('perseus:activity', since, '+');

// Read with COUNT limit
const entries = await redis.xrange('perseus:activity', '-', '+', 'COUNT', '100');
```

**Type signature:**
```typescript
xrange(
  key: RedisKey,
  start: string | Buffer | number,
  end: string | Buffer | number,
  callback?: Callback<[id: string, fields: string[]][]>
): Result<[id: string, fields: string[]][], Context>;

xrange(
  key: RedisKey,
  start: string | Buffer | number,
  end: string | Buffer | number,
  countToken: "COUNT",
  count: number | string,
  callback?: Callback<[id: string, fields: string[]][]>
): Result<[id: string, fields: string[]][], Context>;
```

**Return format:** Array of `[id, [field1, value1, field2, value2, ...]]` tuples. The fields array is flat (not key-value pairs), so parsing requires stepping by 2.

### XREAD -- Blocking Read (Consumer Pattern)

```typescript
// Non-blocking read from a position
const result = await redis.xread('COUNT', '10', 'STREAMS', 'perseus:activity', lastId);

// Blocking read (for real-time consumers)
const result = await redis.xread('BLOCK', 5000, 'STREAMS', 'perseus:activity', '$');
// Blocks up to 5 seconds waiting for new entries
```

**Important for Cluster Mode:** XREAD with multiple streams requires all stream keys to hash to the same slot. Use hash tags if reading multiple streams atomically.

### XTRIM -- Retention Management with MINID

```typescript
// Remove all entries older than 90 days (MINID strategy)
const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
const trimmed = await redis.xtrim('perseus:activity', 'MINID', ninetyDaysAgo.toString());
// Returns: number of entries removed

// Approximate trimming (more efficient, recommended for periodic cleanup)
const trimmed = await redis.xtrim('perseus:activity', 'MINID', '~', ninetyDaysAgo.toString());

// With LIMIT (process in batches to avoid blocking)
const trimmed = await redis.xtrim(
  'perseus:activity',
  'MINID', '~', ninetyDaysAgo.toString(),
  'LIMIT', '1000'
);
```

**Type signatures (verified in RedisCommander.d.ts):**
```typescript
xtrim(key: RedisKey, minid: "MINID", threshold: string | Buffer | number,
      callback?: Callback<number>): Result<number, Context>;
xtrim(key: RedisKey, minid: "MINID", approximately: "~", threshold: string | Buffer | number,
      callback?: Callback<number>): Result<number, Context>;
xtrim(key: RedisKey, minid: "MINID", approximately: "~", threshold: string | Buffer | number,
      countToken: "LIMIT", count: number | string,
      callback?: Callback<number>): Result<number, Context>;
```

**MINID works because Redis Stream IDs are timestamp-based.** When using auto-generated IDs (`*`), the ID is `<millisecond-timestamp>-<sequence>`. XTRIM MINID treats the threshold as a stream ID, removing all entries with IDs numerically less than the threshold. Passing a millisecond timestamp as the threshold effectively means "remove everything older than this time."

**Confidence:** HIGH -- verified against installed ioredis 5.4.2 type definitions and Redis official documentation.

### XLEN -- Stream Length

```typescript
const length = await redis.xlen('perseus:activity');
// Returns: number
```

### XINFO -- Stream Metadata

```typescript
const info = await redis.xinfo('STREAM', 'perseus:activity');
// Returns stream metadata (first/last entry ID, length, etc.)
```

---

## Heartbeat with TTL-Based Dead Instance Detection

### Pattern: SET with EX + Periodic Renewal

The standard Redis heartbeat pattern uses `SET key value EX ttl` and periodic renewal. If an instance dies, the key expires automatically, and the absence of the key indicates a dead instance.

```typescript
// Instance heartbeat (every 15 seconds, with 45-second TTL)
// TTL should be 3x the heartbeat interval for tolerance
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TTL_SECONDS = 45;

// Write heartbeat
await redis.set(
  `perseus:heartbeat:${instanceId}`,
  JSON.stringify({ lastBeat: Date.now(), state: 'running', exchange: 'coinbase' }),
  'EX', HEARTBEAT_TTL_SECONDS
);

// Check if instance is alive
const heartbeat = await redis.get(`perseus:heartbeat:${instanceId}`);
if (!heartbeat) {
  // Instance is dead (key expired)
}

// Check TTL remaining
const ttl = await redis.ttl(`perseus:heartbeat:${instanceId}`);
// Returns: seconds remaining, -2 if key doesn't exist, -1 if no expiry
```

### Dead Instance Detection Strategy

Two complementary approaches:

**1. Passive Detection (TTL Expiry):** When key expires, the instance is dead. Any consumer checking `GET` returns null.

**2. Active Scanning (Periodic Sweep):** A coordinator periodically scans all `perseus:heartbeat:*` keys to build network state. Use `SCAN` (not `KEYS`) in production:

```typescript
// Cluster-safe scanning of heartbeat keys
async function* scanHeartbeatKeys(redis: RedisClient): AsyncGenerator<string> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'perseus:heartbeat:*', 'COUNT', '100');
    cursor = nextCursor;
    for (const key of keys) yield key;
  } while (cursor !== '0');
}
```

**Why not Redis Keyspace Notifications?**
Keyspace notifications (`__keyevent@0__:expired`) are unreliable in cluster mode and add pub/sub overhead. Periodic scanning is simpler and more predictable for a small number of instances (2-10).

### Why 15s Interval / 45s TTL

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Heartbeat interval | 15 seconds | Frequent enough for timely detection, infrequent enough to avoid Redis load |
| TTL | 45 seconds (3x interval) | Tolerates 2 missed heartbeats before declaring dead |
| Detection latency | 30-45 seconds | Acceptable for network visibility (not trading-critical) |
| Redis operations | ~4/min per instance | Negligible load on Azure Managed Redis |

**Confidence:** HIGH -- this is a well-established distributed systems pattern.

---

## State Machine: Build In-House

### Why Not Use a Library

| Library | Size | Why Not |
|---------|------|---------|
| XState v5 | ~47 KB min | Massive overkill for 5 states. Designed for complex UI interactions, not server lifecycle. |
| typescript-fsm | 1 KB | Decent but adds npm dependency for ~80 lines of code. Async support via promises is adequate but we can do better with our own types. |
| typestate | ~3 KB | Last meaningful update 2021. No async transition support. |
| robot | 1.2 KB | Functional API is elegant but React-focused. |
| fiume | new | Zero stars, no adoption evidence. |

**Recommendation:** Write a typed state machine in ~80-100 lines. The instance lifecycle is simple and stable:

```
States: IDLE -> REGISTERING -> RUNNING -> DRAINING -> DEAD
```

Benefits of in-house:
- Perfect TypeScript integration with Livermore's patterns (Zod schemas, pino logging)
- Zero new dependencies
- Full control over async transitions (heartbeat setup, stream logging)
- Testable without library-specific test utilities
- The state machine will never grow complex enough to justify XState

### Recommended Implementation Pattern

```typescript
/** Instance lifecycle states */
type InstanceState = 'idle' | 'registering' | 'running' | 'draining' | 'dead';

/** Events that trigger state transitions */
type InstanceEvent = 'REGISTER' | 'REGISTERED' | 'DRAIN' | 'DRAINED' | 'ERROR' | 'HEARTBEAT_LOST';

/** Transition definition */
interface Transition {
  from: InstanceState;
  event: InstanceEvent;
  to: InstanceState;
  action?: () => Promise<void>;
}

const TRANSITIONS: Transition[] = [
  { from: 'idle',        event: 'REGISTER',       to: 'registering' },
  { from: 'registering', event: 'REGISTERED',     to: 'running' },
  { from: 'registering', event: 'ERROR',          to: 'dead' },
  { from: 'running',     event: 'DRAIN',          to: 'draining' },
  { from: 'running',     event: 'ERROR',          to: 'dead' },
  { from: 'running',     event: 'HEARTBEAT_LOST', to: 'dead' },
  { from: 'draining',    event: 'DRAINED',        to: 'dead' },
];
```

This is explicit, type-safe, and requires no library. Illegal transitions are caught at runtime by checking the transition table.

**Confidence:** HIGH -- straightforward engineering decision.

---

## Redis Key Patterns for Instance Registration

### Namespace Design

All Perseus Network keys use the `perseus:` prefix to avoid collision with existing Livermore keys (`candles:`, `indicator:`, `ticker:`, `channel:`, `livermore:`).

### Key Schema

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `perseus:instance:{instanceId}` | Hash | None (managed by lifecycle) | Instance registration record |
| `perseus:heartbeat:{instanceId}` | String | 45s (auto-renewing) | Heartbeat liveness signal |
| `perseus:activity` | Stream | XTRIM MINID ~90 days | Network activity log |
| `perseus:network:state` | String (JSON) | None | Aggregated network state snapshot |

### Instance ID Generation

Use `{hostname}:{exchangeId}:{pid}:{startupTimestamp}` format:

```typescript
const instanceId = `${os.hostname()}:${exchangeId}:${process.pid}:${Date.now()}`;
// Example: "DESKTOP-ABC:1:12345:1707580800000"
```

This is:
- Unique across instances (PID + timestamp)
- Human-readable for debugging
- Contains exchange ID for filtering
- Deterministic (same instance always generates same ID pattern)

### Instance Registration Hash

```typescript
// Registration uses HSET for structured data
await redis.hset(`perseus:instance:${instanceId}`, {
  instanceId,
  hostname: os.hostname(),
  exchangeId: exchangeId.toString(),
  exchangeName: 'coinbase',
  publicIp: publicIp || 'unknown',
  privateIp: getPrivateIp(),
  pid: process.pid.toString(),
  version: packageVersion,
  state: 'running',
  registeredAt: new Date().toISOString(),
  lastStateChange: new Date().toISOString(),
});
```

**Why HSET instead of SET with JSON:**
- Individual field reads without deserializing (`HGET perseus:instance:abc state`)
- Atomic field updates (`HSET perseus:instance:abc state draining`)
- Smaller operations for heartbeat-like field updates
- Native Redis data structure, no JSON parse overhead

### Azure Cluster Considerations

**Hash Slot Routing:** In Azure Redis with OSS Cluster mode, keys are distributed across slots via CRC16 hashing. This matters for:

1. **No multi-key operations across different instances:** `perseus:instance:abc` and `perseus:instance:def` will likely hash to different slots. Use `deleteKeysClusterSafe()` (already in codebase) for bulk cleanup.

2. **Stream is a single key:** `perseus:activity` is one key on one slot. All XADD/XRANGE/XTRIM operations go to the same node. For a small network (2-10 instances), this is fine and actually desirable (no cross-slot coordination).

3. **Hash tags are NOT recommended here:** Using `{perseus}:instance:abc` would force ALL Perseus keys to the same slot. This defeats cluster distribution and creates a hot spot. The keys are small and operations are infrequent, so natural distribution is fine.

4. **SCAN for discovery:** Use `SCAN` with `MATCH perseus:instance:*` for listing instances. In cluster mode, ioredis Cluster automatically scans all nodes when using the `scanStream()` method.

**Confidence:** HIGH -- consistent with existing codebase patterns (`deleteKeysClusterSafe`, single-key operations).

---

## Activity Stream Entry Schema

### Entry Structure

Each stream entry uses flat field-value pairs (Redis Streams requirement):

```typescript
interface ActivityEntry {
  instanceId: string;      // Which instance
  event: string;           // Event type: REGISTERED, STATE_CHANGE, HEARTBEAT_LOST, DEREGISTERED, ERROR
  exchange: string;        // Exchange name
  exchangeId: string;      // Exchange ID
  fromState?: string;      // Previous state (for STATE_CHANGE)
  toState?: string;        // New state (for STATE_CHANGE)
  reason?: string;         // Why (for ERROR, DEREGISTERED)
  publicIp?: string;       // Instance public IP
  hostname?: string;       // Instance hostname
  ts: string;              // ISO timestamp
}
```

### Retention Strategy: XTRIM MINID for 90-Day Window

```typescript
/**
 * Trim activity stream to retain only the last 90 days.
 * Called periodically (e.g., daily via cron or setInterval).
 *
 * Uses approximate trimming (~) for efficiency -- Redis may keep
 * a few extra entries beyond the cutoff, which is acceptable.
 */
async function trimActivityStream(redis: RedisClient): Promise<number> {
  const RETENTION_DAYS = 90;
  const cutoffMs = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // MINID with approximate trimming
  const trimmed = await redis.xtrim(
    'perseus:activity',
    'MINID', '~', cutoffMs.toString()
  );

  return trimmed;
}
```

**Why MINID over MAXLEN:**
- MAXLEN caps by count (e.g., keep last 100K entries). Entry rate varies, so count-based retention doesn't map cleanly to time.
- MINID caps by time directly. "Remove entries older than 90 days" is exactly what MINID does.
- Stream IDs are timestamp-based, so MINID naturally aligns with time-based retention.

**Why approximate (`~`) over exact (`=`):**
- Redis internally stores streams in radix tree nodes. Exact trimming may need to split nodes, which is expensive.
- Approximate trimming removes whole nodes, which is O(1) per node.
- The difference is a few extra entries, which is irrelevant for a 90-day window.

**Trimming frequency:** Once per hour is sufficient. Even with 10 instances generating 4 heartbeat entries/minute each, that's ~5,760 entries/day -- tiny.

---

## Alternatives Considered and Rejected

### Redis Pub/Sub for Activity Logging -- REJECTED

| Aspect | Redis Streams | Redis Pub/Sub |
|--------|---------------|---------------|
| Persistence | Yes (stored on disk) | No (fire-and-forget) |
| Historical query | Yes (XRANGE) | No |
| Retention control | Yes (XTRIM MINID) | N/A |
| Consumer groups | Yes | No |
| Existing use in codebase | No (new) | Yes (control channels) |

Pub/Sub is already used for ephemeral command/response patterns. Streams are the correct choice for durable activity logs that need historical query and retention.

### PostgreSQL for Activity Logging -- REJECTED

PostgreSQL could store activity logs, but:
- Adds write load to the database for high-frequency events
- Redis Streams are purpose-built for append-only event logs
- Activity data is operational, not analytical -- Redis is the right tier
- Keeps the coordination plane entirely in Redis (single technology for all Perseus features)

### Redis Sorted Sets for Heartbeat -- CONSIDERED BUT NOT PRIMARY

Sorted sets (`ZADD perseus:heartbeats instanceId timestamp`) enable range queries by time. However:
- Requires manual cleanup (no auto-expiry like TTL keys)
- More complex than the simple SET + EX pattern
- The SET + EX pattern is self-cleaning -- dead instances' keys vanish automatically
- Could be added later if network-wide "who was alive at time T?" queries are needed

### External Service Discovery (Consul, etcd) -- REJECTED

Overkill for 2-10 instances. Redis is already the coordination bus. Adding another distributed system increases operational complexity without proportional benefit.

---

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| `public-ip` (npm) | ESM-only, breaks CJS builds. Overkill for one-time IP lookup. |
| `node-public-ip` (npm) | 1 weekly download, abandoned, no types. |
| XState | 47 KB for 5 states. Designed for complex UI, not server lifecycle. |
| typescript-fsm | Adequate but unnecessary dependency for ~80 lines of code. |
| Consul / etcd / ZooKeeper | External service discovery is overkill for 2-10 Redis-connected instances. |
| Redis Keyspace Notifications | Unreliable in cluster mode for key expiry events. Use periodic scanning. |
| `bull` / `bullmq` | Job queue libraries. Not needed for simple heartbeat + stream patterns. |
| `@art-of-coding/stream-utils` | Wrapper around ioredis streams. Adds abstraction over a simple API. |

---

## Implementation Checklist

### No `npm install` Required

Everything builds on:
- `ioredis` 5.4.2 (already installed, pinned in root package.json)
- `zod` 3.25.x (already installed for schema validation)
- `node:https` (Node.js built-in for public IP detection)
- `node:os` (Node.js built-in for hostname, network interfaces)
- `node:crypto` (Node.js built-in, if needed for instance ID hashing)

### New Module Location

```
packages/
  cache/
    src/
      keys.ts               # ADD: perseus:* key builders
      streams/
        activity-stream.ts   # NEW: XADD/XRANGE/XTRIM wrappers
      index.ts               # UPDATE: export new modules
```

Or, if Perseus Network is a standalone package:

```
packages/
  perseus/
    src/
      instance-id.ts         # Instance ID generation
      state-machine.ts       # Instance lifecycle FSM
      heartbeat.ts           # SET EX heartbeat loop
      activity-stream.ts     # Redis Streams wrapper
      public-ip.ts           # Public IP detection
      network-manager.ts     # Orchestrates registration, heartbeat, cleanup
      index.ts
    package.json             # deps: @livermore/cache, @livermore/schemas, @livermore/utils
```

**Recommendation:** Create `packages/perseus` as a dedicated package. It has a clear bounded context (network coordination) and shouldn't pollute the cache package with non-caching concerns.

---

## Sources

### Verified Against Installed Code
- ioredis 5.4.2 type definitions: `node_modules/.pnpm/ioredis@5.4.2/.../RedisCommander.d.ts` (lines 4542-5807)
- Existing key patterns: `packages/cache/src/keys.ts`
- Existing Redis client: `packages/cache/src/client.ts`
- Existing heartbeat pattern: `apps/api/src/services/exchange/adapter-factory.ts`

### Redis Official Documentation
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)
- [XADD Command](https://redis.io/docs/latest/commands/xadd/)
- [XTRIM Command](https://redis.io/docs/latest/commands/xtrim/)
- [XRANGE Command](https://redis.io/docs/latest/commands/xrange/)
- [XREAD Command](https://redis.io/docs/latest/commands/xread/)
- [SET Command (EX option)](https://redis.io/docs/latest/commands/set/)
- [Redis Cluster Specification (Hash Tags)](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)

### Libraries Evaluated
- [ioredis GitHub](https://github.com/redis/ioredis)
- [public-ip npm](https://www.npmjs.com/package/public-ip) -- ESM-only, rejected
- [node-public-ip npm](https://www.npmjs.com/package/node-public-ip) -- abandoned, rejected
- [typescript-fsm GitHub](https://github.com/WebLegions/typescript-fsm) -- adequate but unnecessary
- [XState](https://stately.ai/docs/xstate) -- overkill
- [ipify.org](https://www.ipify.org/) -- recommended for public IP detection

### Patterns and Best Practices
- [Redis Heartbeat-Based Session Tracking](https://medium.com/tilt-engineering/redis-powered-user-session-tracking-with-heartbeat-based-expiration-c7308420489f)
- [Redis Clustering Best Practices with Keys](https://redis.io/blog/redis-clustering-best-practices-with-keys/)
- [ioredis Streams Example (Gist)](https://gist.github.com/forkfork/c27d741650dd65631578771ab264dd2c)
- [Azure Container Apps + Redis Streams](https://techcommunity.microsoft.com/blog/appsonazureblog/custom-scaling-on-azure-container-apps-based-on-redis-streams/3723374)
