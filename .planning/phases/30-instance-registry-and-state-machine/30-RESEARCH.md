# Phase 30: Instance Registry and State Machine - Research

**Researched:** 2026-02-10
**Domain:** Distributed instance coordination, TTL-based heartbeat, finite state machine, Redis atomic operations
**Confidence:** HIGH

## Summary

Phase 30 replaces the broken prototype connection tracking in `adapter-factory.ts` with a proper `InstanceRegistryService` and `StateMachineService`. The existing prototype has three documented bugs: heartbeat is defined but never called, errors don't persist correctly, and dead instances show `idle` forever because keys have no TTL. This phase delivers exchange-scoped instance identity, TTL-based heartbeat with automatic dead instance detection, a validated 6-state machine, and one-instance-per-exchange enforcement via atomic `SET NX EX`.

The implementation requires zero new npm dependencies. Everything builds on ioredis 5.4.2 (already installed), Zod 3.25.x (already installed), and Node.js built-ins (`node:https` for public IP, `node:os` for hostname). The state machine is 6 states with ~8 valid transitions -- trivially implementable in typed code without a library. All Redis operations are single-key and cluster-safe for Azure Managed Redis with OSS Cluster mode.

The critical technical decisions are: (1) Use a single JSON key per exchange (`exchange:{id}:status`) with SET EX for atomic write+TTL, using KEEPTTL for payload-only updates between heartbeats. (2) Use `SET ... EX 45 NX` for initial exchange claim to prevent TOCTOU race. (3) 15-second heartbeat interval with 45-second TTL (3x ratio). (4) Public IP detected asynchronously with 3-second timeout and `null` fallback -- never blocks registration.

**Primary recommendation:** Build InstanceRegistryService and StateMachineService as service files under `apps/api/src/services/`, with Zod schemas in `packages/schemas/src/network/` and key builders in `packages/cache/src/keys.ts`. Wire into `server.ts` (register after pre-flight) and `control-channel.service.ts` (replace `updateConnectionState` calls with state machine transitions).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | 5.4.2 (pinned) | SET NX EX, SET KEEPTTL, EXPIRE, GET, DEL | Already installed; full TypeScript type definitions verified for all needed commands |
| Zod | 3.25.x | Schema validation for InstanceStatus payload, state transitions | Already installed; used for all schemas in codebase |
| Node.js `node:https` | Built-in | Public IP detection via ipify.org | Zero-dependency; 10-line utility function |
| Node.js `node:os` | Built-in | `os.hostname()` for instance identity | Zero-dependency; standard approach |
| TypeScript | 5.9.3 | Type-safe state machine, transition map | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino (via `@livermore/utils`) | Installed | Structured logging for state transitions | All state changes logged; heartbeats NOT logged (LOG-06) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled state machine | XState v5 (47KB) | XState is extreme overkill for 6 states; adds dependency for ~80 lines of code |
| `node:https` for IP | `public-ip` npm | ESM-only package breaks CJS builds in this monorepo |
| Single JSON key with SET EX | Redis Hash (HSET) | HSET enables field-level reads but HSET has no atomic TTL-on-write; SET EX is atomic and simpler |
| EXPIRE for heartbeat | SET EX full payload each tick | EXPIRE is lighter (TTL-only, no serialization); use SET EX only when payload changes |

**Installation:**
```bash
# No installation needed -- zero new dependencies
```

## Architecture Patterns

### Recommended Project Structure
```
packages/schemas/src/
  network/
    instance-status.schema.ts    # Zod schemas + TS types for InstanceStatus, ConnectionState

packages/cache/src/
  keys.ts                        # ADD: instanceStatusKey(exchangeId) -> 'exchange:{id}:status'

apps/api/src/
  services/
    instance-registry.service.ts # InstanceRegistryService: register, heartbeat, deregister, updateState
    state-machine.service.ts     # StateMachineService: transition validation, state management
    exchange/
      adapter-factory.ts         # REMOVE: setupConnectionTracking, setConnectionStatus, updateHeartbeat, getConnectionStatus, connectionStatusKey
    runtime-state.ts             # UPDATE: ConnectionState type updated to match new 6-state model
    types/
      service-registry.ts        # UPDATE: Add instanceRegistry and stateMachine to ServiceRegistry
```

### Pattern 1: Exchange-Scoped Instance Status Key
**What:** Single JSON string key per exchange with TTL, written atomically via SET EX.
**When to use:** Always for instance registration and heartbeat.
**Why:** Atomic write+TTL in one command. No window where key exists without expiry. Cluster-safe (single key).

```typescript
// Key pattern: exchange:{exchangeId}:status
// Replaces prototype: exchange:status:{exchangeId} (note: flipped order for consistency with other exchange keys)

// Initial registration (atomic claim)
const result = await redis.set(
  `exchange:${exchangeId}:status`,
  JSON.stringify(payload),
  'EX', 45,    // 45-second TTL
  'NX'         // Only if not exists
);
// result === 'OK' means we claimed it; null means another instance owns it

// Heartbeat (TTL-only renewal, no payload change)
await redis.expire(`exchange:${exchangeId}:status`, 45);

// State update (payload change, keep existing TTL)
await redis.set(
  `exchange:${exchangeId}:status`,
  JSON.stringify(updatedPayload),
  'KEEPTTL'    // Preserve remaining TTL from last heartbeat
);

// Full heartbeat with payload refresh (when payload has changed)
await redis.set(
  `exchange:${exchangeId}:status`,
  JSON.stringify(updatedPayload),
  'EX', 45,    // Reset TTL
  'XX'         // Only if exists (we already own it)
);
```

### Pattern 2: Typed State Machine with Transition Map
**What:** A record mapping each state to its valid next states. Transitions are validated before execution.
**When to use:** Every state change in the instance lifecycle.

```typescript
// Source: Codebase analysis of server.ts and control-channel.service.ts lifecycle

const VALID_TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
  idle:     ['starting'],
  starting: ['warming', 'stopping', 'idle'],   // idle on error recovery
  warming:  ['active', 'stopping', 'idle'],     // idle on error recovery
  active:   ['stopping'],
  stopping: ['stopped'],
  stopped:  ['idle'],                            // ready for restart
};

// Transition function
function transition(from: ConnectionState, to: ConnectionState): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    logger.error({ from, to }, 'Invalid state transition attempted');
    throw new Error(`Invalid transition: ${from} -> ${to}`);
  }
  // Proceed with state change
}
```

### Pattern 3: Heartbeat Strategy (Separate TTL from Payload)
**What:** Heartbeat interval only refreshes TTL via EXPIRE. Payload updates happen on state change via SET KEEPTTL.
**When to use:** Every 15-second heartbeat tick.
**Why:** Avoids re-serializing full JSON payload every 15 seconds. EXPIRE is O(1) with zero serialization cost.

```typescript
// Heartbeat tick (every 15s) -- lightweight
private async heartbeatTick(): Promise<void> {
  const key = instanceStatusKey(this.exchangeId);

  // Update lastHeartbeat in payload AND refresh TTL
  // We must update lastHeartbeat so readers know when we last checked in
  const status = await this.buildCurrentStatus();
  const result = await this.redis.set(key, JSON.stringify(status), 'EX', 45, 'XX');

  if (result === null) {
    // Key expired or was deleted -- re-register
    logger.warn('Instance key missing during heartbeat, re-registering');
    await this.register();
  }
}
```

### Pattern 4: Atomic One-Instance-Per-Exchange Claim
**What:** Use SET NX EX to atomically claim an exchange slot. If another instance already owns it, read the owner's identity for the error message.
**When to use:** During `handleStart()` in ControlChannelService, before any exchange work begins.

```typescript
// Atomic claim attempt
const key = instanceStatusKey(exchangeId);
const payload = JSON.stringify(this.buildRegistrationPayload());

const result = await this.redis.set(key, payload, 'EX', 45, 'NX');

if (result === null) {
  // Someone else owns this exchange -- read who
  const existing = await this.redis.get(key);
  if (existing) {
    const owner = JSON.parse(existing) as InstanceStatus;
    throw new Error(
      `Exchange ${exchangeId} is already claimed by ${owner.hostname} ` +
      `(${owner.ipAddress}) since ${owner.connectedAt}. ` +
      `Stop that instance first, or wait for its TTL to expire.`
    );
  }
}
```

### Pattern 5: Public IP Detection with Async Fallback
**What:** Detect public IP at startup with strict timeout, register with null IP if it fails, update asynchronously.
**When to use:** Once at instance startup.

```typescript
// Source: Node.js built-in https module + ipify.org
import https from 'node:https';

async function detectPublicIp(timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org', { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => resolve(data.trim() || null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
```

### Anti-Patterns to Avoid
- **GET-then-SET for exchange claim:** Classic TOCTOU race. Two instances both see null, both write. Use SET NX EX instead.
- **Heartbeat re-serializes full payload every tick:** Wastes CPU on JSON.stringify. Use EXPIRE for TTL-only, or track if payload has changed since last write.
- **Key without TTL for any state:** The prototype bug. Every SET must include EX or KEEPTTL. No naked SET.
- **Using `redis.keys('exchange:*:status')` to find instances:** Broken in Cluster mode. Use known exchange IDs from database.
- **TTL equal to heartbeat interval:** One missed beat = false death. TTL must be >= 3x interval.
- **Throwing on invalid state transition in heartbeat path:** Would kill the heartbeat loop. Log error but don't throw in heartbeat callbacks.
- **Blocking startup on public IP detection:** External service failure should not prevent instance registration.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State machine library | Custom event system with listeners | Simple transition map (Record<State, State[]>) | 6 states, ~8 transitions. A lookup table is clearer than an event system. |
| Public IP detection library | HTTP client wrapper with retries | 10-line `node:https` function | Single call at startup; retry logic is overkill |
| Distributed lock | Redlock algorithm | SET NX EX (single key) | One Redis instance (Azure Cluster acts as one logical instance). Redlock is for multi-master. |
| Instance ID generator | UUID or ULID library | `${hostname}:${exchangeId}:${pid}:${Date.now()}` | Human-readable, debuggable, unique enough for 2-10 instances |
| Key builder pattern | Ad-hoc string concatenation | Function in `keys.ts` following existing pattern | Existing codebase convention: `exchangeCandleKey()`, `exchangeIndicatorKey()`, etc. |

**Key insight:** This phase is fundamentally about Redis primitives (SET, GET, EXPIRE, DEL) and TypeScript types. Every "framework" decision adds complexity without proportional benefit for 6 states and 2-10 instances.

## Common Pitfalls

### Pitfall 1: Heartbeat TTL Window -- False Death During GC/Backfill
**What goes wrong:** Instance sets 45s TTL, heartbeat runs every 15s. During a heavy backfill REST call (5-10 seconds) plus a GC pause (500ms+), the heartbeat timer callback is delayed. If three consecutive heartbeats are delayed beyond 45 seconds total, the key expires and another instance could claim the exchange.
**Why it happens:** Node.js is single-threaded. Blocking operations delay setInterval callbacks.
**How to avoid:**
- 15s interval with 45s TTL (3x ratio) tolerates 2 missed beats.
- Keep heartbeat callback lightweight: single SET EX command, no logging, no computation.
- On heartbeat failure, log warning but don't crash. Attempt re-registration if key disappeared.
**Warning signs:** Instance briefly goes offline in Admin UI during backfill. Heartbeat flaps in activity log.

### Pitfall 2: TOCTOU Race on Exchange Claim
**What goes wrong:** Instance A does `GET exchange:1:status` (null), Instance B does `GET exchange:1:status` (null), both do `SET`. Last writer wins, both instances run on the same exchange.
**Why it happens:** GET-then-SET is not atomic.
**How to avoid:** Use `SET exchange:1:status payload EX 45 NX` for initial claim. NX returns null if key exists. This is atomic.
**Warning signs:** Two instances showing the same exchangeId. Duplicate candle writes. Exchange rate limit errors.

### Pitfall 3: Heartbeat Overwrites vs. KEEPTTL
**What goes wrong:** Heartbeat does `SET key payload EX 45` every 15s. A state transition does `SET key updatedPayload` (no EX). The transition drops the TTL. Key persists forever.
**Why it happens:** Plain SET without EX removes any existing TTL.
**How to avoid:**
- ALWAYS use either `EX` or `KEEPTTL` on every SET.
- State updates use `SET key payload KEEPTTL` to preserve heartbeat's TTL.
- Heartbeat uses `SET key payload EX 45 XX` to refresh both payload and TTL.
**Warning signs:** `TTL exchange:1:status` returns -1 (no expiry) instead of a positive number.

### Pitfall 4: State Machine Crash Recovery -- Phantom "Starting" Instance
**What goes wrong:** Instance begins `starting`, writes key with TTL, crashes. For 45 seconds, Admin UI shows phantom instance in "starting" state. After expiry, no record exists.
**Why it happens:** Crash occurs during transient state. TTL is the only cleanup mechanism.
**How to avoid:**
- All states get TTL (already enforced by SET EX pattern).
- Admin UI (future phase) should show time-in-state and flag "possibly stuck" if > 60s in `starting`.
- On startup, if existing key shows this instance's hostname in a transient state, treat as crash recovery and re-claim.
**Warning signs:** Instance appears in "starting" longer than expected startup time (~30s).

### Pitfall 5: SET NX EX Semantics on Re-Registration
**What goes wrong:** Instance is running (`active` state), heartbeat refreshes TTL. Instance receives `stop` then `start` command. On re-start, `SET NX` fails because the key still exists from the previous run (same instance, same exchange).
**Why it happens:** NX means "only if not exists." The key exists because we wrote it.
**How to avoid:**
- On `stop`, delete the key (DEL) before transitioning to `stopped`/`idle`.
- On `start`, if NX fails, check if the existing key belongs to THIS instance (same hostname + PID). If so, overwrite with `SET EX XX`.
- This is a self-restart scenario, not a conflict.
**Warning signs:** Instance cannot restart after stop without waiting for TTL expiry.

### Pitfall 6: Public IP Blocks Startup
**What goes wrong:** `detectPublicIp()` calls ipify.org. Service is down or blocked by firewall. Without timeout, startup hangs indefinitely.
**Why it happens:** External HTTP dependency at startup.
**How to avoid:**
- 3-second timeout on the HTTP request.
- Register immediately with `ipAddress: null`.
- Detect IP asynchronously and update payload via `SET KEEPTTL` after resolution.
- IP is informational, not functional. Missing IP should never prevent registration.
**Warning signs:** Startup takes > 5 seconds. Timeout errors in logs referencing ipify.

### Pitfall 7: Existing Prototype Code Conflicts
**What goes wrong:** `adapter-factory.ts` still writes to `exchange:status:{exchangeId}` (note: different key format). If not removed, both old and new code write status, creating confusion about which key is authoritative.
**Why it happens:** Partial migration where old code isn't fully removed.
**How to avoid:**
- Remove `setupConnectionTracking()`, `setConnectionStatus()`, `updateHeartbeat()`, `getConnectionStatus()`, and `connectionStatusKey()` from `adapter-factory.ts`.
- Remove `ExchangeConnectionStatus` interface (replaced by new Zod schema).
- The adapter factory should only create adapters, not track connection state.
- Clean up old `exchange:status:*` keys from Redis (one-time cleanup in startup or script).
**Warning signs:** Two different key patterns for the same exchange in Redis.

## Code Examples

Verified patterns from ioredis 5.4.2 type definitions and codebase analysis:

### InstanceStatus Zod Schema
```typescript
// packages/schemas/src/network/instance-status.schema.ts
import { z } from 'zod';

export const ConnectionStateSchema = z.enum([
  'idle',
  'starting',
  'warming',
  'active',
  'stopping',
  'stopped',
]);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

export const InstanceStatusSchema = z.object({
  // Identity
  exchangeId: z.number(),
  exchangeName: z.string(),
  hostname: z.string(),
  ipAddress: z.string().nullable(),
  adminEmail: z.string(),
  adminDisplayName: z.string(),

  // State
  connectionState: ConnectionStateSchema,
  symbolCount: z.number(),

  // Timestamps
  connectedAt: z.string().nullable(),      // ISO string, set when entering 'active'
  lastHeartbeat: z.string(),                // ISO string, updated every heartbeat
  lastStateChange: z.string(),              // ISO string, updated on every transition
  registeredAt: z.string(),                 // ISO string, set once at registration

  // Error tracking
  lastError: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
});

export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;
```

### Key Builder Function
```typescript
// packages/cache/src/keys.ts (ADD to existing file)

/**
 * Build Redis key for exchange instance status.
 * Phase 30: Exchange-scoped instance registration with TTL.
 *
 * @example instanceStatusKey(1) // 'exchange:1:status'
 */
export function instanceStatusKey(exchangeId: number): string {
  return `exchange:${exchangeId}:status`;
}
```

### SET NX EX for Atomic Claim (ioredis 5.4.2 verified)
```typescript
// Verified: RedisCommander.d.ts line 3569
// set(key, value, "EX", seconds, "NX") -> Result<"OK" | null>

const result = await redis.set(
  instanceStatusKey(exchangeId),
  JSON.stringify(status),
  'EX', 45,
  'NX'
);
// result === 'OK' -> claimed successfully
// result === null -> another instance owns this exchange
```

### SET KEEPTTL for Payload Update (ioredis 5.4.2 verified)
```typescript
// Verified: RedisCommander.d.ts line 3602
// set(key, value, "KEEPTTL") -> Result<"OK">

await redis.set(
  instanceStatusKey(exchangeId),
  JSON.stringify(updatedStatus),
  'KEEPTTL'
);
// Updates payload without changing remaining TTL
```

### SET XX EX for Heartbeat with Payload (ioredis 5.4.2 verified)
```typescript
// Verified: RedisCommander.d.ts line 3575
// set(key, value, "EX", seconds, "XX") -> Result<"OK" | null>

const result = await redis.set(
  instanceStatusKey(exchangeId),
  JSON.stringify(status),
  'EX', 45,
  'XX'           // Only set if exists (we already own it)
);
// result === null -> key expired, need to re-register
```

### EXPIRE for TTL-Only Heartbeat (ioredis 5.4.2 verified)
```typescript
// Verified: RedisCommander.d.ts line 1743
// expire(key, seconds) -> Result<number>

const result = await redis.expire(instanceStatusKey(exchangeId), 45);
// result === 1 -> TTL set successfully
// result === 0 -> key does not exist (need to re-register)
```

### State Transition Integration Points
```typescript
// server.ts: After pre-flight checks
// stateMachine starts in 'idle' state, registry writes key with TTL
await instanceRegistry.register(); // SET ... EX 45 NX

// server.ts: Autostart path
await stateMachine.transition('starting');  // idle -> starting
// ... backfill ...
await stateMachine.transition('warming');   // starting -> warming
// ... indicator warmup ...
await stateMachine.transition('active');    // warming -> active

// control-channel.service.ts: handleStart()
await stateMachine.transition('starting');  // idle -> starting
// ... backfill, warmup ...
await stateMachine.transition('warming');   // starting -> warming
// ... services start ...
await stateMachine.transition('active');    // warming -> active

// control-channel.service.ts: handleStop()
await stateMachine.transition('stopping');  // active -> stopping
// ... stop services ...
await stateMachine.transition('stopped');   // stopping -> stopped
await instanceRegistry.deregister();        // DEL key
await stateMachine.transition('idle');       // stopped -> idle (ready for restart)

// server.ts: Graceful shutdown
await stateMachine.transition('stopping');  // any -> stopping
// ... stop services ...
await instanceRegistry.deregister();        // DEL key
```

## State of the Art

| Old Approach (Prototype) | Current Approach (Phase 30) | Why Change | Impact |
|--------------------------|----------------------------|------------|--------|
| `SET key payload` (no TTL) | `SET key payload EX 45 NX` | Dead instances persist forever with no TTL | FIX-03: Dead instances auto-expire |
| `updateHeartbeat()` never called | `setInterval` with 15s tick | Heartbeat was defined but had no callers | FIX-01: Heartbeat actually updates |
| Error handler reads null status | Error handler always has current status | `getConnectionStatus()` returns null when key missing | FIX-02: Errors persist correctly |
| `exchange:status:{id}` key pattern | `exchange:{id}:status` key pattern | Consistency with other exchange-scoped keys (`candles:{id}:...`) | Cleaner key namespace |
| 5 states: idle/connecting/connected/disconnected/error | 6 states: idle/starting/warming/active/stopping/stopped | Better lifecycle granularity; `warming` is new (indicator warmup phase); `stopped` distinguishes clean shutdown | REG-03: Full lifecycle visibility |
| In-memory only (`RuntimeState`) | Redis-persisted + in-memory (dual write) | Multi-instance visibility requires Redis state | REG-01: Any Admin can read any instance's status |
| No state validation | Transition map enforcement | Invalid transitions silently corrupt state | REG-04: Invalid transitions rejected |
| No one-instance-per-exchange check | SET NX EX atomic claim | Two instances on same exchange cause data corruption | LOCK-01 through LOCK-04 |

**Deprecated/outdated:**
- `ExchangeConnectionStatus` interface in `adapter-factory.ts`: Replaced by `InstanceStatus` Zod schema
- `connectionStatusKey()` in `adapter-factory.ts`: Replaced by `instanceStatusKey()` in `keys.ts`
- `setupConnectionTracking()` in `adapter-factory.ts`: State machine owns all connection state
- `updateHeartbeat()` in `adapter-factory.ts`: InstanceRegistryService owns heartbeat
- `getConnectionStatus()` / `setConnectionStatus()` in `adapter-factory.ts`: Replaced by registry methods
- Old `ConnectionState` type in `runtime-state.ts` (`'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'`): Replaced by new 6-state `ConnectionState`

## Redis Command Reference

All commands verified in ioredis 5.4.2 `RedisCommander.d.ts`. All are single-key, cluster-safe.

| Operation | Command | ioredis Type Def Line | Cluster Safe |
|-----------|---------|----------------------|--------------|
| Initial claim | `SET key val EX 45 NX` | 3569 | Yes |
| Heartbeat (payload+TTL) | `SET key val EX 45 XX` | 3575 | Yes |
| Heartbeat (TTL-only) | `EXPIRE key 45` | 1743 | Yes |
| State update | `SET key val KEEPTTL` | 3602 | Yes |
| Read status | `GET key` | N/A (basic) | Yes |
| Check TTL | `TTL key` | N/A (basic) | Yes |
| Delete on shutdown | `DEL key` | N/A (basic) | Yes |
| Check exists | `EXISTS key` | N/A (basic) | Yes |

## Heartbeat Strategy Decision

**Recommended: Full payload write every heartbeat tick (SET EX XX)**

Two strategies were evaluated:

| Strategy | Command | Pros | Cons |
|----------|---------|------|------|
| **A: Full write** | `SET key JSON(status) EX 45 XX` | Simple; payload always fresh; single command | Re-serializes JSON every 15s |
| **B: Split** | `EXPIRE key 45` + `SET key JSON EX 45 KEEPTTL` on change | Lighter heartbeat; less serialization | Two code paths; EXPIRE doesn't update lastHeartbeat |

**Choose Strategy A (full write)** because:
1. The payload is small (~300 bytes JSON). Serialization cost is negligible at 15s intervals.
2. `lastHeartbeat` timestamp MUST update every tick (HB-03 requirement). This requires writing the payload anyway.
3. `XX` flag ensures we only write if key exists (we own it). If key expired, result is null -- triggering re-registration.
4. Single code path is simpler and less error-prone than split heartbeat/status updates.

Strategy B would only make sense if the payload were large (KB+) or the heartbeat interval were sub-second. Neither applies here.

## Integration Points

### Files to Create (4 files)
| File | Purpose |
|------|---------|
| `packages/schemas/src/network/instance-status.schema.ts` | Zod schemas: `ConnectionState`, `InstanceStatus`, types |
| `apps/api/src/services/instance-registry.service.ts` | `InstanceRegistryService`: register, heartbeat, deregister, updateState |
| `apps/api/src/services/state-machine.service.ts` | `StateMachineService`: transition validation, current state, transition history |
| `apps/api/src/utils/detect-public-ip.ts` | `detectPublicIp()`: HTTP call to ipify.org with timeout and fallback |

### Files to Modify (7 files)
| File | Change |
|------|--------|
| `packages/cache/src/keys.ts` | Add `instanceStatusKey(exchangeId)` function |
| `packages/cache/src/index.ts` | Ensure new key function is exported (already exports `*` from keys) |
| `packages/schemas/src/index.ts` | Add `export * from './network/instance-status.schema'` |
| `apps/api/src/server.ts` | Wire registry.register() after pre-flight; state transitions in autostart; deregister in shutdown |
| `apps/api/src/services/control-channel.service.ts` | Replace `updateConnectionState()` calls with `stateMachine.transition()`; add one-instance check in handleStart() |
| `apps/api/src/services/runtime-state.ts` | Update `ConnectionState` type to match new 6-state model; state machine updates in-memory state for backward compat |
| `apps/api/src/services/types/service-registry.ts` | Add `instanceRegistry` and `stateMachine` to ServiceRegistry interface |

### Files to Clean Up (1 file)
| File | Change |
|------|--------|
| `apps/api/src/services/exchange/adapter-factory.ts` | Remove: `ExchangeConnectionStatus` interface, `connectionStatusKey()`, `setupConnectionTracking()`, `updateHeartbeat()`, `getConnectionStatus()`, `setConnectionStatus()`. Keep: `create()`, `createAdapterByType()`, `createCoinbaseAdapter()` (without connection tracking wiring) |

### Backward Compatibility
- `getRuntimeState()` must continue working for existing `control.getStatus` endpoint and ControlPanel UI.
- `StateMachineService.transition()` updates BOTH Redis key AND in-memory `RuntimeState` via `updateRuntimeState()`.
- The in-memory `ConnectionState` type must be updated from 5 states to 6 states (add `warming`; rename `connecting`->`starting`, `connected`->`active`, `disconnected`->`stopped`).
- Existing ControlPanel polling continues via `control.getStatus` reading from `getRuntimeState()`.

## Open Questions

Things that couldn't be fully resolved:

1. **KEEPTTL availability on Azure Managed Redis**
   - What we know: KEEPTTL requires Redis 6.0+. Azure Managed Redis defaults to Redis 7.2+. ioredis 5.4.2 has KEEPTTL type definitions (verified line 3602).
   - What's unclear: Not tested against the actual Azure instance.
   - Recommendation: Use KEEPTTL in the implementation. If it fails at runtime (unlikely), fall back to reading TTL + SET EX with remaining TTL. LOW risk.

2. **Admin email and display name source for registration payload**
   - What we know: REG-02 requires `adminEmail` and `adminDisplayName` in the payload. The `users` table has email/name. The `user_exchanges` table links users to exchanges.
   - What's unclear: At registration time (before first authenticated request), we may not have the user identity yet. ControlChannelService is initialized lazily on first auth request.
   - Recommendation: Register initially with `adminEmail: null`, `adminDisplayName: null`. Update payload (via SET KEEPTTL) once the ControlChannelService initializes with the authenticated user's identity. This parallels the async IP detection pattern.

3. **Existing `exchange:status:{id}` keys in Redis**
   - What we know: The prototype writes to `exchange:status:{exchangeId}`. Phase 30 uses `exchange:{exchangeId}:status`. Old keys have no TTL and will persist.
   - What's unclear: Whether to clean up old keys as part of this phase or defer.
   - Recommendation: Add a one-time cleanup in `register()` that deletes `exchange:status:${exchangeId}` if it exists. One extra DEL command per registration, zero ongoing cost.

4. **Handling `stopped` -> `idle` transition timing**
   - What we know: After `handleStop()`, the state goes `active -> stopping -> stopped`. The key should be deleted (deregister). Then state goes `stopped -> idle` for restart readiness.
   - What's unclear: Should deregister happen at `stopping` (before services stop) or `stopped` (after)?
   - Recommendation: Deregister (DEL key) at `stopped` state. During `stopping`, key still exists with TTL showing the instance is shutting down. After services stop, delete key and transition to `idle`. This gives the Admin UI visibility into the shutdown process.

## Sources

### Primary (HIGH confidence)
- ioredis 5.4.2 `RedisCommander.d.ts` -- SET NX EX (line 3569), SET KEEPTTL (line 3602), SET XX EX (line 3575), EXPIRE (line 1743)
- Livermore codebase analysis -- `server.ts` (startup lifecycle, shutdown handler), `control-channel.service.ts` (handleStart/handleStop, updateConnectionState), `adapter-factory.ts` (broken prototype), `runtime-state.ts` (in-memory state), `keys.ts` (key builder pattern), `service-registry.ts` (dependency injection pattern)
- [Redis SET Command](https://redis.io/docs/latest/commands/set/) -- NX, EX, KEEPTTL, XX flags
- [Redis EXPIRE Command](https://redis.io/docs/latest/commands/expire/) -- TTL renewal

### Secondary (MEDIUM confidence)
- [Redis Heartbeat-Based Session Tracking](https://medium.com/tilt-engineering/redis-powered-user-session-tracking-with-heartbeat-based-expiration-c7308420489f) -- TTL refresh pattern validation
- [Distributed Locks with Heartbeats](https://compileandrun.com/redis-distrubuted-locks-with-heartbeats/) -- SET NX EX for atomic claims
- [ipify.org](https://www.ipify.org/) -- Public IP detection service (free, no API key)

### Tertiary (LOW confidence)
- KEEPTTL on Azure Managed Redis: Expected to work (Redis 7.2+ default), but not verified against actual instance

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zero new dependencies. All Redis commands verified against installed ioredis 5.4.2 type definitions.
- Architecture: HIGH -- Integration points identified with specific file paths and line numbers. Existing patterns (key builders, service registry, Zod schemas) followed exactly.
- State machine: HIGH -- 6 states and transition map derived from actual `server.ts` and `control-channel.service.ts` lifecycle analysis.
- Pitfalls: HIGH -- 7 pitfalls catalogued from codebase bugs (prototype analysis), Redis documentation, and distributed systems patterns.
- Heartbeat strategy: HIGH -- Both strategies evaluated. Full-write chosen based on payload size analysis and HB-03 requirement.

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days -- stable domain, no fast-moving dependencies)
