# Architecture Research: v6.0 Perseus Network

**Researched:** 2026-02-10
**Confidence:** HIGH (based on codebase analysis + Redis documentation)
**Mode:** Integration research for distributed instance coordination

## Executive Summary

The v6.0 Perseus Network adds instance identity, heartbeat liveness, network activity logging, and an Admin "Network" view to the existing Livermore architecture. The key architectural challenge is that these features must integrate with three existing systems: (1) the API server lifecycle in `server.ts` and `ControlChannelService`, (2) the Redis Cluster connection via ioredis, and (3) the Admin UI's tRPC polling pattern.

The research answers six specific integration questions and recommends a component structure that maps cleanly onto the existing codebase with minimal refactoring.

**Central finding:** The existing `ExchangeAdapterFactory.setConnectionStatus()` in `adapter-factory.ts` already writes to `exchange:status:{exchangeId}` but has three documented bugs: heartbeat never updates, error never populates, and connectionState sticks on `idle` when instance is down. v6.0 replaces this prototype with a proper `InstanceRegistryService` that owns the full lifecycle.

## Current Architecture (v5.0)

### Relevant Components

```
apps/api/src/
  server.ts                              -- Startup orchestration
  services/
    control-channel.service.ts           -- Redis pub/sub command handling
    runtime-state.ts                     -- In-memory state (not persisted)
    exchange/
      adapter-factory.ts                 -- Creates adapters, writes exchange:status:{id}

packages/cache/src/
  client.ts                              -- ioredis Cluster singleton
  keys.ts                                -- Key builder functions

apps/admin/src/
  pages/ControlPanel.tsx                 -- Polls control.getStatus (tRPC)
  components/control/RuntimeStatus.tsx   -- Renders status badge
```

### Current Status Tracking (Broken)

The existing `ExchangeConnectionStatus` in `adapter-factory.ts` (lines 12-19):

```typescript
interface ExchangeConnectionStatus {
  exchangeId: number;
  exchangeName: string;
  connectionState: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  connectedAt: string | null;
  lastHeartbeat: string | null;
  error: string | null;
}
```

**Bugs documented in PROJECT.md:**
1. `updateHeartbeat()` is defined on `ExchangeAdapterFactory` (line 231) but **never called** from any adapter or service.
2. `error` field only populated in the `adapter.on('error')` handler, but adapter errors are transient and the field is never cleared or updated correctly.
3. `connectionState` stuck on `idle` when instance dies because the key has **no TTL** -- it persists forever in Redis with stale data.

### Current Startup Lifecycle

```
start()
  |
  +-- parseCliArgs()
  +-- validateEnv()
  +-- Fastify.register(cors, websocket, clerkPlugin, tRPC)
  +-- Pre-flight: getDbClient(), getRedisClient(), subscriber.duplicate()
  +-- if --autostart:
  |     fetchSymbols -> backfill -> indicatorService.start() -> warmup
  |     -> boundaryRestService.start() -> coinbaseAdapter.connect() -> alertService.start()
  |     -> initRuntimeState({ connectionState: 'connected' })
  +-- else:
  |     initRuntimeState({ connectionState: 'idle' })
  +-- Build ServiceRegistry (globalServiceRegistry)
  +-- ControlChannelService initialized lazily on first authenticated request
  +-- Fastify.listen()
```

**Key observation:** There is no "registration" step. The instance starts, optionally connects to an exchange, and the only external evidence of its existence is the `exchange:status:{id}` key written by `setupConnectionTracking()` in the adapter factory.

### Current Admin UI Data Flow

```
Admin UI (ControlPanel.tsx)
  |
  +-- useQuery(trpc.control.getStatus) -- polls every 5s (1s during startup)
  |     Returns: { isPaused, mode, uptime, exchangeConnected, connectionState, startup }
  |     Source: getRuntimeState() -- in-memory, single-instance only
  |
  +-- useMutation(trpc.control.executeCommand)
        Publishes command via Redis pub/sub to ControlChannelService
```

**Problem for v6.0:** `getRuntimeState()` is in-memory. The Admin UI only sees the instance it's directly connected to via HTTP. To see multiple instances (Perseus Network view), we need Redis-persisted state that any Admin can query.

## Proposed Architecture (v6.0)

### Component Diagram

```
                        ┌──────────────────────────────────┐
                        |          Admin UI                 |
                        |  ┌────────────────────────────┐  |
                        |  | Network Page (NEW)         |  |
                        |  | - Instance cards           |  |
                        |  | - Activity feed            |  |
                        |  └────────────────────────────┘  |
                        └───────────┬──────────────────────┘
                                    | tRPC queries
                                    v
┌───────────────────────────────────────────────────────────────────────┐
|                     API Server (any instance)                         |
|  ┌─────────────────────────────────────────────────────────────────┐ |
|  | network.router.ts (NEW)                                         | |
|  | - getInstances: reads exchange:*:instance from Redis            | |
|  | - getNetworkLog: reads logs:network:* Redis Streams             | |
|  └─────────────────────────────────────────────────────────────────┘ |
|  ┌─────────────────────────────────────────────────────────────────┐ |
|  | InstanceRegistryService (NEW)                                   | |
|  | - register(): writes instance key with full identity + TTL      | |
|  | - heartbeat(): refreshes TTL every 15s via setInterval          | |
|  | - deregister(): deletes key on graceful shutdown                 | |
|  | - logEvent(): XADD to Redis Stream                              | |
|  └─────────────────────────────────────────────────────────────────┘ |
|  ┌─────────────────────────────────────────────────────────────────┐ |
|  | StateMachineService (NEW)                                       | |
|  | - Manages: idle -> starting -> warming -> active -> stopping    | |
|  | - Fires: registry.updateState() + registry.logEvent()           | |
|  | - Integrates with: ControlChannelService, server.ts             | |
|  └─────────────────────────────────────────────────────────────────┘ |
└───────────────────────────────────────────────────────────────────────┘
                         |                          |
                         v                          v
                 ┌───────────────┐          ┌───────────────────┐
                 | Redis Cluster  |          | Redis Cluster      |
                 | (Status Keys)  |          | (Stream Keys)      |
                 |                |          |                    |
                 | exchange:1:    |          | logs:network:      |
                 |   instance     |          |   coinbase         |
                 | (TTL: 60s)    |          | (MAXLEN ~10000)    |
                 |                |          |                    |
                 | exchange:2:    |          | logs:network:      |
                 |   instance     |          |   binance          |
                 | (TTL: 60s)    |          | (MAXLEN ~10000)    |
                 └───────────────┘          └───────────────────┘
```

### New Redis Key Patterns

**Instance Status Key:**
```
exchange:{exchange_id}:instance
```

This replaces the existing `exchange:status:{exchangeId}` pattern. The rename from `status` to `instance` is deliberate -- `status` is the prototype name and carries stale semantics. The new key holds the full identity payload.

**Hash tag consideration for Redis Cluster:** Each instance key is a single key operating on a single hash slot, so there are no cross-slot concerns. `exchange:1:instance` and `exchange:2:instance` hash to different slots, which is fine because we never operate on them atomically together. The `network.router` reads them individually.

**Activity Log Streams:**
```
logs:network:{exchange_name}
```

For example: `logs:network:coinbase`, `logs:network:binance`.

Each is a separate Redis Stream. No cross-slot issue because XADD/XRANGE/XLEN are single-key operations.

**Retention:** Use `XADD ... MAXLEN ~ 10000` (approximate trimming with `~` for performance). At ~50 events/day (state transitions + periodic snapshots), this gives approximately 200 days of history. The `~` prefix tells Redis to trim efficiently without guaranteed exact count.

**Why MAXLEN instead of MINID:** MINID requires computing a 90-day-old timestamp on every write, adding complexity. MAXLEN ~ 10000 achieves the same goal (bounded retention) with simpler code. If exact 90-day retention becomes important later, switch to MINID.

### Instance Status Payload

```typescript
interface InstanceStatus {
  // Identity
  exchangeId: number;
  exchangeName: string;
  hostname: string;          // os.hostname()
  ipAddress: string;         // Public IP via external service
  adminEmail: string;        // From user_exchanges or env
  adminDisplayName: string;  // From users table

  // State
  connectionState: InstanceState;
  symbolCount: number;
  monitoredSymbols: string[];

  // Timestamps
  registeredAt: string;      // ISO string, set once at registration
  connectedAt: string | null;
  lastHeartbeat: string;     // ISO string, updated every heartbeat
  lastError: string | null;

  // Metadata
  version: string;           // package.json version
  uptime: number;            // seconds since process start
}

type InstanceState = 'idle' | 'starting' | 'warming' | 'active' | 'stopping' | 'stopped';
```

### State Machine

```
idle ──► starting ──► warming ──► active ──► stopping ──► stopped
  ▲                                  │                       │
  └──────────────────────────────────┘                       │
  └──────────────────────────────────────────────────────────┘
         (via 'start' command)            (graceful shutdown
                                           or 'stop' command)

  error can occur during: starting, warming, active
  on error: state stays the same, lastError populated, logEvent fired
```

**State transitions and where they fire from:**

| Transition | Trigger | Source File |
|------------|---------|-------------|
| `idle` (initial) | Server starts without `--autostart` | `server.ts` line ~414 |
| `idle -> starting` | `start` command received | `control-channel.service.ts` handleStart() line ~437 |
| `starting -> warming` | Backfill complete, indicators starting | `control-channel.service.ts` handleStart() line ~527 |
| `warming -> active` | All services started, WebSocket connected | `control-channel.service.ts` handleStart() line ~571 |
| `active -> stopping` | `stop` command received or SIGINT/SIGTERM | `control-channel.service.ts` handleStop() or `server.ts` shutdown() |
| `stopping -> stopped` | All services stopped | `control-channel.service.ts` handleStop() line ~636 |
| `stopping -> idle` | Stop complete, instance remains running | `control-channel.service.ts` handleStop() |
| `idle -> starting -> warming -> active` | `--autostart` flag | `server.ts` autostart path line ~257-410 |

**Note:** The existing `ConnectionState` type in `runtime-state.ts` uses `'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'`. The v6.0 state machine uses `'idle' | 'starting' | 'warming' | 'active' | 'stopping' | 'stopped'` for the persisted instance state. The in-memory `ConnectionState` can map to the persisted state or be replaced entirely. Recommend replacing the in-memory state with the persisted state to avoid dual state tracking.

## Integration Points (Answers to Specific Questions)

### 1. Where Does Instance Registration Happen?

**Answer: Early in `start()`, after pre-flight checks pass, before any exchange connection.**

```
start()
  validateEnv()
  Fastify.register(...)
  Pre-flight: DB + Redis checks
  >>> InstanceRegistryService.register() <<<    <-- HERE
  >>> heartbeat interval starts <<<              <-- HERE
  if --autostart: ...
  else: idle mode
  ...
  Fastify.listen()
```

**Rationale:** Registration should happen as soon as Redis is available. The instance announces "I exist, I'm idle" immediately. State transitions to `starting`, `warming`, `active` happen later as the exchange connects.

**Specific code change:** In `server.ts`, after line 239 (`logger.info('Pre-flight checks passed')`), create `InstanceRegistryService` and call `register()`.

**For autostart path:** The state transitions are:
1. `register()` -> state `idle` (immediately after pre-flight)
2. Before backfill -> state `starting`
3. After backfill, during warmup -> state `warming`
4. After all services started -> state `active`

**For idle path:** The instance registers with state `idle` and stays there until a `start` command arrives.

### 2. How Does Heartbeat Interact with Redis Connection?

**Answer: `SET ... EX` on the instance key, using the existing main Redis client (not the subscriber), refreshing TTL every 15 seconds.**

```typescript
// In InstanceRegistryService
private heartbeatInterval: NodeJS.Timeout | null = null;

async startHeartbeat(): Promise<void> {
  this.heartbeatInterval = setInterval(async () => {
    try {
      const key = instanceKey(this.exchangeId);
      const status = await this.buildStatus();
      // SET with EX atomically writes and sets TTL
      await this.redis.set(key, JSON.stringify(status), 'EX', 60);
    } catch (err) {
      logger.error({ err }, 'Heartbeat failed');
    }
  }, 15_000); // 15 second interval
}
```

**Why SET EX instead of separate SET + EXPIRE:**
- Atomic operation -- no window where key exists without TTL
- Single round-trip to Redis
- Works identically on regular Redis and ioredis Cluster mode
- `SET` is a single-key operation, no cross-slot concerns

**TTL design: 60s TTL with 15s heartbeat interval.**
- If instance misses 3 consecutive heartbeats (45s of failure), key expires at 60s.
- This is a standard "dead man's switch" pattern.
- On graceful shutdown, key is explicitly deleted (no need to wait for TTL).

**Redis connection:** Uses the **main** Redis client (`getRedisClient()`), not the subscriber. The subscriber is in pub/sub mode and cannot execute regular commands. The main client handles `SET`, `GET`, `DEL`, `XADD` alongside its other duties. ioredis Cluster mode handles routing to the correct shard transparently.

**Important:** The existing code already creates a `subscriberRedis = redis.duplicate()` for pub/sub (server.ts line 233). The heartbeat uses the main `redis` client, which is not in pub/sub mode and can execute any command.

### 3. Where Do State Transitions Fire From?

**Answer: From `ControlChannelService` handlers (for command-driven transitions) and `server.ts` (for startup/shutdown transitions). The `StateMachineService` centralizes the transition logic.**

**Current state management is scattered:**
- `server.ts` calls `initRuntimeState()` at lines 403 and 414
- `ControlChannelService.updateConnectionState()` at line 648 calls `updateRuntimeState()`
- `ExchangeAdapterFactory.setupConnectionTracking()` at line 177 writes to Redis directly

**v6.0 consolidation:**

```typescript
class StateMachineService {
  constructor(
    private registry: InstanceRegistryService,
    private validTransitions: Map<InstanceState, InstanceState[]>
  ) {}

  async transition(newState: InstanceState, metadata?: { error?: string }): Promise<void> {
    const current = this.currentState;
    if (!this.validTransitions.get(current)?.includes(newState)) {
      throw new Error(`Invalid transition: ${current} -> ${newState}`);
    }
    this.currentState = newState;
    await this.registry.updateState(newState, metadata);
    await this.registry.logEvent('state_change', { from: current, to: newState });
  }
}
```

**Integration with existing code:**

| Location | Current Code | v6.0 Change |
|----------|-------------|-------------|
| `server.ts` line 403 | `initRuntimeState({ connectionState: 'connected' })` | `stateMachine.transition('active')` |
| `server.ts` line 414 | `initRuntimeState({ connectionState: 'idle' })` | `stateMachine.transition('idle')` |
| `control-channel.service.ts` line 437 | `this.updateConnectionState('connecting')` | `stateMachine.transition('starting')` |
| `control-channel.service.ts` line 571 | `this.updateConnectionState('connected')` | `stateMachine.transition('active')` |
| `control-channel.service.ts` line 635 | `this.updateConnectionState('idle')` | `stateMachine.transition('idle')` |
| `server.ts` shutdown handler line 485 | No state tracking | `stateMachine.transition('stopping')` then `registry.deregister()` |
| `adapter-factory.ts` line 177-226 | `setupConnectionTracking()` writes to Redis | **Remove.** State machine owns all state. Adapter events feed into state machine, not directly to Redis. |

**The warmup state is new.** Currently, `handleStart()` goes from `connecting` straight to `connected`. In v6.0, the warmup phase (indicator warmup, line 532-546 in control-channel.service.ts) is explicitly surfaced as `warming` state.

### 4. How Does the Admin UI Read Instance Status and Stream Logs?

**Answer: tRPC polling via a new `network.router.ts`, same pattern as the existing `control.getStatus`. No WebSocket or Redis subscription needed for the initial implementation.**

**Why polling, not WebSocket or Redis subscription:**

1. **Existing pattern:** The Admin UI already polls `control.getStatus` every 5s. Adding another polling endpoint is consistent and requires zero infrastructure changes.
2. **Any instance can serve the data:** Since instance status is in Redis, any API instance the Admin connects to can read all instances' status. There's no need for the Admin to connect to each instance directly.
3. **WebSocket adds complexity for marginal benefit:** Instance status changes every 15s (heartbeat). Polling every 5s is sufficient. Real-time WebSocket would save a few seconds of latency but adds WebSocket connection management for the Network page.
4. **SSE (tRPC subscriptions) are promising for v6.1:** tRPC v11 supports SSE subscriptions natively. For v6.0, polling is simpler and proven. For v6.1, consider migrating the activity feed to SSE for true real-time.

**New tRPC Router:**

```typescript
// apps/api/src/routers/network.router.ts

export const networkRouter = router({
  // Get all registered instances
  getInstances: protectedProcedure.query(async ({ ctx }) => {
    // Scan for exchange:*:instance keys
    // Read each key's JSON value
    // Return array of InstanceStatus
  }),

  // Get network activity log (paginated)
  getNetworkLog: protectedProcedure
    .input(z.object({
      exchange: z.string().optional(),  // Filter by exchange
      limit: z.number().default(50),
      cursor: z.string().optional(),    // Redis Stream ID for pagination
    }))
    .query(async ({ input }) => {
      // XREVRANGE on logs:network:{exchange} or all streams
      // Return entries with cursor for next page
    }),
});
```

**Admin UI pattern:**

```typescript
// apps/admin/src/pages/Network.tsx
const { data: instances } = useQuery({
  ...trpc.network.getInstances.queryOptions(),
  refetchInterval: 5000, // 5s polling, same as ControlPanel
});

const { data: activityLog } = useQuery({
  ...trpc.network.getNetworkLog.queryOptions({ limit: 50 }),
  refetchInterval: 10000, // 10s for activity log (less urgent)
});
```

**Reading instance keys in Redis Cluster:**

The `getInstances` query needs to find all `exchange:*:instance` keys. In Redis Cluster, `KEYS` is problematic (scans a single node). Options:

1. **Known exchange IDs from database:** Query the `exchanges` table for active exchanges, then `GET exchange:{id}:instance` for each. This is the correct approach -- we know exactly which exchanges exist from the DB.
2. **SCAN with pattern:** Works but requires scanning all nodes in Cluster. Unnecessary complexity when we know the exchange IDs.

**Recommendation:** Option 1. Query `exchanges` table, then `GET` each instance key. An exchange with no key (TTL expired) is a dead instance.

### 5. How to Enforce One-Instance-Per-Exchange?

**Answer: Check-before-start pattern with advisory TTL, not a distributed lock.**

**The constraint:** "One instance per exchange" means only one Livermore API should actively serve `exchangeId=1` (Coinbase) at any time. If Mike starts a second Coinbase instance while one is already running, it should be rejected.

**Implementation:**

```typescript
// In handleStart() of ControlChannelService, before any exchange work:

async enforceOneInstance(exchangeId: number): Promise<void> {
  const key = instanceKey(exchangeId);
  const existing = await this.redis.get(key);

  if (existing) {
    const status = JSON.parse(existing) as InstanceStatus;
    // Check if the existing instance is this instance (re-start scenario)
    if (status.hostname === os.hostname() && status.registeredAt === this.registeredAt) {
      return; // Same instance, allow re-start
    }
    // Another instance is active
    throw new Error(
      `Exchange ${exchangeId} is already served by ${status.hostname} ` +
      `(${status.adminDisplayName}). Stop that instance first.`
    );
  }
}
```

**Why check-before-start, not a distributed lock:**

1. **Simplicity:** A Redis `SET NX` check is one command. A distributed lock (Redlock) requires multiple Redis nodes, lock renewal, and failure handling.
2. **TTL handles crashes:** If instance A crashes, its key expires in 60s. Instance B can then start. No lock cleanup needed.
3. **No race condition concern:** Starting an exchange takes 30-60 seconds (backfill, warmup). The check happens at the beginning. Even if two instances race, the key's TTL ensures the loser's heartbeat will see the winner's key and can self-terminate.
4. **Matches the constraint semantics:** The requirement says "one instance per exchange," not "exclusive lock." The check is advisory -- it prevents accidental double-start, not malicious contention.

**Edge case -- stale key from crash:** If instance A crashes and instance B starts within 60s (before TTL expires), the check will reject B. This is acceptable -- wait 60s for the dead instance's TTL to expire, then start. If faster recovery is needed, add a `force-start` command that deletes the stale key.

### 6. Redis Key Patterns for Azure Managed Redis with Cluster Mode

**Answer: All v6.0 keys are single-key operations. No cross-slot concerns.**

**Key patterns:**

| Key | Operation | Cross-Slot? |
|-----|-----------|-------------|
| `exchange:{id}:instance` | SET, GET, DEL | No (single key) |
| `logs:network:{exchange_name}` | XADD, XREVRANGE, XLEN | No (single key) |
| `livermore:commands:{sub}` | PUBLISH, SUBSCRIBE | No (single key) |
| `livermore:responses:{sub}` | PUBLISH, SUBSCRIBE | No (single key) |

**The `getInstances` query reads multiple keys but does so sequentially (one GET per known exchange ID), not in a single multi-key command. No CROSSSLOT risk.**

**Hash tag consideration:** Not needed. Hash tags (`{tag}`) are only useful when you need multi-key atomic operations (MGET, transactions). Since all v6.0 operations are single-key, natural hashing is fine.

**Azure Managed Redis specifics:**
- OSS Cluster mode distributes keys across shards automatically
- ioredis Cluster handles `MOVED` and `ASK` redirections transparently
- `SET ... EX` (heartbeat) works identically to standalone Redis
- `XADD` (stream writes) works identically to standalone Redis
- `XREVRANGE` (stream reads) works identically to standalone Redis

**Existing precedent in codebase:** The `deleteKeysClusterSafe()` function in `client.ts` (line 178) already handles cross-slot concerns by deleting keys one at a time. The v6.0 keys don't need this because they're never bulk-operated.

## Component Boundaries

### What Talks to What

```
┌─────────────────────────────────────────────────────────────────────────┐
|                         New Components (v6.0)                            |
|                                                                          |
|  InstanceRegistryService                                                |
|    - Writes to: exchange:{id}:instance (SET EX)                         |
|    - Writes to: logs:network:{name} (XADD)                             |
|    - Reads from: exchange:{id}:instance (GET, for self-check)           |
|    - Depends on: Redis client, os module, public-ip fetch               |
|                                                                          |
|  StateMachineService                                                    |
|    - Calls: InstanceRegistryService.updateState()                       |
|    - Calls: InstanceRegistryService.logEvent()                          |
|    - Called by: ControlChannelService, server.ts                        |
|    - Replaces: runtime-state.ts updateRuntimeState() for state machine  |
|                                                                          |
|  network.router.ts                                                      |
|    - Reads from: exchanges table (DB), exchange:{id}:instance (Redis)   |
|    - Reads from: logs:network:{name} (Redis Streams XREVRANGE)          |
|    - Called by: Admin UI (tRPC polling)                                  |
|                                                                          |
|  Network.tsx (Admin page)                                               |
|    - Calls: trpc.network.getInstances                                   |
|    - Calls: trpc.network.getNetworkLog                                  |
|    - Displays: Instance cards, activity feed                            |
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Status Read

```
Admin UI (Network page)
  |
  +-- useQuery(trpc.network.getInstances) -- polls every 5s
  |     |
  |     +-- network.router.getInstances
  |           |
  |           +-- SELECT id, name FROM exchanges WHERE is_active = true
  |           +-- For each exchange:
  |                 GET exchange:{id}:instance
  |                 Parse JSON -> InstanceStatus
  |                 If key missing -> instance is dead (TTL expired)
  |           +-- Return InstanceStatus[]
  |
  +-- useQuery(trpc.network.getNetworkLog) -- polls every 10s
        |
        +-- network.router.getNetworkLog
              |
              +-- XREVRANGE logs:network:{exchange} + - COUNT 50
              +-- Return entries[]
```

### Data Flow: State Transition

```
ControlChannelService.handleStart()
  |
  +-- stateMachine.transition('starting')
  |     |
  |     +-- registry.updateState('starting')
  |     |     |
  |     |     +-- SET exchange:{id}:instance <json> EX 60
  |     |
  |     +-- registry.logEvent('state_change', { from: 'idle', to: 'starting' })
  |           |
  |           +-- XADD logs:network:{name} MAXLEN ~ 10000 * event state_change ...
  |
  +-- ... backfill ...
  |
  +-- stateMachine.transition('warming')
  +-- ... warmup ...
  +-- stateMachine.transition('active')
```

### Data Flow: Heartbeat

```
setInterval (every 15s)
  |
  +-- registry.heartbeat()
        |
        +-- Build current InstanceStatus (state, symbolCount, uptime, etc.)
        +-- SET exchange:{id}:instance <json> EX 60
```

### Data Flow: Graceful Shutdown

```
process.on('SIGINT' / 'SIGTERM')
  |
  +-- stateMachine.transition('stopping')
  +-- ... stop services in reverse order ...
  +-- registry.deregister()
  |     |
  |     +-- DEL exchange:{id}:instance
  |     +-- XADD logs:network:{name} ... event deregistered
  +-- clearInterval(heartbeatInterval)
  +-- redis.quit()
```

## Files That Need Changes

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/services/instance-registry.service.ts` | Instance registration, heartbeat, deregistration, logging |
| `apps/api/src/services/state-machine.service.ts` | State transition validation and orchestration |
| `apps/api/src/routers/network.router.ts` | tRPC endpoints for Network view |
| `packages/cache/src/keys.ts` | New key functions: `instanceKey()`, `networkLogKey()` |
| `packages/schemas/src/network/instance.schema.ts` | Zod schemas for InstanceStatus, NetworkLogEntry |
| `apps/admin/src/pages/Network.tsx` | Network view page |
| `apps/admin/src/components/network/InstanceCard.tsx` | Instance status card component |
| `apps/admin/src/components/network/ActivityFeed.tsx` | Activity log feed component |

### Modified Files

| File | Change |
|------|--------|
| `apps/api/src/server.ts` | Add registry.register() after pre-flight, wire state transitions, add shutdown deregister |
| `apps/api/src/services/control-channel.service.ts` | Replace updateConnectionState() calls with stateMachine.transition() |
| `apps/api/src/services/runtime-state.ts` | Add state machine fields OR replace entirely with persisted state |
| `apps/api/src/services/exchange/adapter-factory.ts` | Remove setupConnectionTracking() and setConnectionStatus() -- state machine owns this now |
| `apps/api/src/services/types/service-registry.ts` | Add registry and stateMachine to ServiceRegistry |
| `apps/api/src/routers/index.ts` | Add networkRouter to appRouter |
| `apps/api/src/routers/control.router.ts` | getStatus reads from registry instead of in-memory state (or alongside) |
| `apps/admin/src/App.tsx` | Add Network nav link and route |
| `packages/schemas/src/index.ts` | Export new network schemas |
| `packages/cache/src/index.ts` | Export new key functions |

### Removed/Deprecated Code

| Code | Reason |
|------|--------|
| `ExchangeConnectionStatus` interface in `adapter-factory.ts` | Replaced by `InstanceStatus` |
| `connectionStatusKey()` in `adapter-factory.ts` | Replaced by `instanceKey()` in `keys.ts` |
| `setupConnectionTracking()` in `adapter-factory.ts` | State machine handles all state |
| `updateHeartbeat()` in `adapter-factory.ts` | Replaced by `InstanceRegistryService.heartbeat()` |
| `getConnectionStatus()` in `adapter-factory.ts` | Replaced by `network.router.getInstances` |
| `setConnectionStatus()` in `adapter-factory.ts` | Replaced by `InstanceRegistryService.updateState()` |

## Suggested Build Order

Based on dependency analysis, the recommended phase structure:

### Phase 1: Instance Registry Foundation

**Dependencies:** None (uses existing Redis client)
**Creates:** The core service that all other phases depend on

1. Add `instanceKey()` and `networkLogKey()` to `packages/cache/src/keys.ts`
2. Create `InstanceStatus` Zod schema in `packages/schemas/src/network/`
3. Create `InstanceRegistryService` in `apps/api/src/services/`
   - `register()`: Detect hostname, fetch public IP, write to Redis with TTL
   - `heartbeat()`: SET EX refresh on interval
   - `deregister()`: DEL key, stop interval
   - `logEvent()`: XADD to stream with MAXLEN trimming
   - `updateState()`: Update state field and re-write key
4. Wire into `server.ts`: register after pre-flight, deregister in shutdown handler
5. Start heartbeat interval

**Verification:** Start API, check Redis for `exchange:1:instance` key with TTL. Stop API, verify key deleted. Wait 60s after kill -9, verify key expired.

### Phase 2: State Machine

**Dependencies:** Phase 1 (needs registry for state persistence)
**Creates:** Validated state transitions, replaces scattered updateRuntimeState calls

1. Create `StateMachineService` with valid transition map
2. Integrate with `ControlChannelService.handleStart()` -- replace `updateConnectionState()` calls
3. Integrate with `ControlChannelService.handleStop()`
4. Integrate with `server.ts` autostart path
5. Integrate with `server.ts` shutdown handler
6. Remove `setupConnectionTracking()` from `adapter-factory.ts`
7. Preserve backward compatibility: `getRuntimeState()` still works for existing `control.getStatus`

**Verification:** Start with `--autostart`, observe state transitions: idle -> starting -> warming -> active. Send `stop` command, observe: active -> stopping -> idle. Check Redis Stream for logged events.

### Phase 3: Network Router + One-Instance Enforcement

**Dependencies:** Phase 1 (reads instance keys), Phase 2 (reads state)
**Creates:** API endpoints for Admin UI to consume, instance uniqueness check

1. Create `network.router.ts` with `getInstances` and `getNetworkLog` endpoints
2. Register in `apps/api/src/routers/index.ts`
3. Add one-instance-per-exchange check in `handleStart()` (before exchange connection)
4. Add `force-start` command variant that overrides stale instance check

**Verification:** Query `trpc.network.getInstances` via curl/Postman. Verify response includes running instance. Try to start second instance for same exchange, verify rejection.

### Phase 4: Admin UI Network View

**Dependencies:** Phase 3 (network router endpoints)
**Creates:** Visual Network page in Admin UI

1. Create `Network.tsx` page with instance cards and activity feed
2. Create `InstanceCard.tsx` component (shows identity, state, heartbeat freshness)
3. Create `ActivityFeed.tsx` component (reverse-chronological event log)
4. Add "Network" link to nav bar in `App.tsx`
5. Implement 5s polling for instances, 10s polling for activity log
6. Handle dead instances (key expired) -- show as "Offline" with last known info

**Verification:** Open Admin UI Network page. See own instance as active. Kill instance, wait 60s, see it disappear or show as Offline.

### Phase 5: Bug Fixes and Cleanup

**Dependencies:** All previous phases
**Creates:** Clean state, removes prototype code

1. Delete `ExchangeConnectionStatus` and related methods from `adapter-factory.ts`
2. Clean up old `exchange:status:*` keys from Redis (one-time script)
3. Ensure `control.getStatus` still works (backward compat with existing ControlPanel)
4. Update `ControlPanel.tsx` to optionally show instance identity info
5. Update health check endpoint to include instance state

**Verification:** Existing ControlPanel page still works. Network page shows accurate data. No orphaned Redis keys.

## Public IP Detection

The instance status includes `ipAddress` for identifying where instances run. Options:

**Recommendation: Simple HTTP fetch to `https://api.ipify.org` at startup.**

```typescript
async function getPublicIp(): Promise<string> {
  try {
    const response = await fetch('https://api.ipify.org?format=text');
    return response.text();
  } catch {
    return 'unknown';
  }
}
```

**Why not a library:**
- `public-ip` npm package adds a dependency for a single HTTP call
- Node.js 20+ has native `fetch`
- Fallback to `'unknown'` if offline or behind firewall

**When:** Once at startup, cached for the process lifetime. IP doesn't change during a single server run.

## Compatibility with Existing ControlPanel

The existing `ControlPanel.tsx` polls `control.getStatus` which reads from `getRuntimeState()` (in-memory). This must continue to work during and after v6.0.

**Strategy:**
1. `StateMachineService` updates both the Redis instance key AND the in-memory `RuntimeState`
2. `control.getStatus` continues to return in-memory state (fast, no Redis round-trip)
3. `network.getInstances` reads from Redis (cross-instance visibility)
4. Over time, `control.getStatus` can delegate to Redis if needed, but no urgency

This means the ControlPanel page works exactly as before. The Network page is additive.

## Sources

**Codebase files analyzed (HIGH confidence):**
- `apps/api/src/server.ts` -- Startup lifecycle, shutdown handler
- `apps/api/src/services/control-channel.service.ts` -- Command handling, state transitions
- `apps/api/src/services/runtime-state.ts` -- In-memory state types
- `apps/api/src/services/exchange/adapter-factory.ts` -- Existing (broken) status tracking
- `apps/api/src/services/types/service-registry.ts` -- Service dependency injection
- `apps/api/src/routers/control.router.ts` -- tRPC polling pattern
- `apps/admin/src/pages/ControlPanel.tsx` -- Admin polling pattern
- `apps/admin/src/components/control/RuntimeStatus.tsx` -- Status display pattern
- `apps/admin/src/App.tsx` -- Hash routing pattern
- `apps/admin/src/lib/trpc.ts` -- tRPC client setup
- `packages/cache/src/client.ts` -- ioredis Cluster configuration
- `packages/cache/src/keys.ts` -- Key builder patterns
- `packages/schemas/src/adapter/exchange-adapter.schema.ts` -- Adapter event types
- `packages/schemas/src/control/command.schema.ts` -- Command schema patterns
- `packages/exchange-core/src/adapter/coinbase-adapter.ts` -- Adapter implementation
- `packages/exchange-core/src/adapter/base-adapter.ts` -- Base adapter
- `packages/database/src/schema/exchanges.ts` -- Exchange table schema
- `.planning/PROJECT.md` -- v6.0 requirements
- `.planning/MILESTONES.md` -- Historical context
- `.planning/codebase/ARCHITECTURE.md` -- System architecture

**Redis documentation (HIGH confidence):**
- [SET command](https://redis.io/docs/latest/commands/set/) -- SET ... EX for atomic write+TTL
- [XADD command](https://redis.io/docs/latest/commands/xadd/) -- MAXLEN ~ for approximate trimming
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/) -- Stream data type
- [Azure Managed Redis Architecture](https://learn.microsoft.com/en-us/azure/redis/architecture) -- OSS Cluster compatibility

**Community patterns (MEDIUM confidence):**
- [Heartbeat TTL pattern](https://medium.com/tilt-engineering/redis-powered-user-session-tracking-with-heartbeat-based-expiration-c7308420489f) -- Dead man's switch via TTL
- [CROSSSLOT resolution](https://hackernoon.com/resolving-the-crossslot-keys-error-with-redis-cluster-mode-enabled) -- Hash tags for multi-key ops
- [tRPC Subscriptions](https://trpc.io/docs/server/subscriptions) -- SSE as future option

---

*Architecture research: 2026-02-10 -- v6.0 Perseus Network instance coordination*
