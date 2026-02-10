# Pitfalls Research: v6.0 Perseus Network - Instance Registration & Health

**Researched:** 2026-02-10
**Confidence:** HIGH (codebase analysis + Redis official docs + community patterns)
**Supersedes:** v5.0 pitfalls (shipped 2026-02-08)

## Executive Summary

The Perseus Network milestone introduces distributed instance coordination on top of an existing Azure Managed Redis OSS Cluster. The current codebase has known bugs: heartbeat not updating, connectionState stuck on `idle` when an instance is dead, and no crash recovery mechanism. Building reliable distributed coordination on Redis requires careful handling of TTL-based liveness detection, atomic lock acquisition for one-instance-per-exchange enforcement, and memory-bounded activity logging via Streams.

Key risk areas in priority order:
1. **Heartbeat TTL timing** - Too short causes false deaths during GC pauses; too long delays dead instance detection
2. **One-instance-per-exchange TOCTOU** - Check-then-set without atomicity allows two instances on the same exchange
3. **Redis Streams memory growth** - Unbounded streams in production will consume all Redis memory
4. **State machine crash recovery** - Instance dies in `starting` state, key stays forever without TTL
5. **Azure Redis Cluster compatibility** - KEYS command in existing code is banned in Cluster; Streams work per-key but XREAD multi-stream does not
6. **Public IP detection** - External service failure at startup blocks instance registration entirely
7. **Admin UI stale data** - Polling shows instance as alive after TTL expiry due to client-side caching

---

## Critical Pitfalls (HIGH severity)

### Pitfall 1: Heartbeat TTL Window - Too Short Causes False Deaths

**What goes wrong:** Instance sets `exchange:1:status` with `EX 30` (30-second TTL). Heartbeat renews every 10 seconds. During a Node.js garbage collection pause (can exceed 500ms on large heaps), a long backfill REST call (can take 5-10 seconds), or a Redis reconnection (retryDelayMs up to 5000ms in current config), the heartbeat renewal misses its window. The key expires. Admin UI shows the instance as dead. If a second instance is watching and waiting, it may claim the exchange slot.

**Why it happens:** The heartbeat interval and TTL are chosen without accounting for worst-case latency. Node.js is single-threaded; any blocking operation delays the heartbeat timer callback.

**Consequences:**
- False-positive death detection triggers alerts in Admin UI
- If one-instance-per-exchange enforcement is TTL-based, a second instance could claim the slot during the false death window, leading to split-brain (two instances on one exchange)
- Instance recovers from GC pause, finds its registration expired, must re-register (causing a visible flap in the UI)

**Warning signs:**
- Heartbeat flaps visible in Redis Stream logs (registered -> expired -> registered in quick succession)
- Admin UI shows instances briefly going offline during high-load periods (backfill, warmup)
- Sequence of `expired -> claimed` events for the same exchange

**Prevention:**
1. **TTL should be at least 3x the heartbeat interval.** If heartbeat runs every 10 seconds, TTL should be 30-45 seconds minimum. This gives 2-3 missed heartbeats before expiry.
2. **Use `SET key value XX EX ttl` for renewal** (XX = only set if exists). This prevents accidentally creating a new key if the instance was already evicted.
3. **Heartbeat must not depend on the event loop being free.** Use `setInterval` with `ref()` and keep the heartbeat callback as lightweight as possible -- just a single `SET ... XX EX` command. No logging, no computation.
4. **Separate heartbeat from status updates.** Heartbeat is just TTL renewal. Status payload updates (symbolCount, connectionState) happen on a slower cadence or on state change.
5. **Monitor heartbeat health internally.** Track the delta between expected and actual heartbeat times. If the delta exceeds 50% of the interval, log a warning -- this is an early signal that the event loop is overloaded.

**Phase to address:** Phase 1 (Instance Registration & Heartbeat)

**Codebase references:**
- `packages/schemas/src/env/config.schema.ts:67-70` - `HARDCODED_CONFIG.redis` shows 5000ms command timeout, 1000ms retry delay
- `apps/api/src/services/control-channel.service.ts:508-521` - Backfill during start can take many seconds
- `packages/exchange-core/src/adapter/coinbase-adapter.ts:224` - 30-second watchdog timeout shows network pauses are expected

**Recommended values:**
```
Heartbeat interval: 10 seconds
TTL: 45 seconds (4.5x interval)
Rationale: Tolerates 3 missed beats + network jitter. 45 seconds is still
fast enough to detect actual dead instances within ~1 minute.
```

---

### Pitfall 2: One-Instance-Per-Exchange TOCTOU Race

**What goes wrong:** Instance A checks if `exchange:1:status` exists (GET returns null), decides it can claim the exchange, then writes `SET exchange:1:status <payload> EX 45`. Between the GET and SET, Instance B performs the same check and also sees null. Both instances write. Last writer wins; first writer's registration is silently overwritten. Two instances now serve Coinbase, causing duplicate candle writes, duplicate pub/sub publishes, and duplicate alert triggers.

**Why it happens:** GET-then-SET is a classic TOCTOU (time-of-check-time-of-use) race. Even though Redis is single-threaded, the two commands from different clients are not atomic.

**Consequences:**
- Duplicate candle data in cache (same candle written twice with slight timing differences)
- Duplicate alerts fired to Discord
- Doubled WebSocket connections to exchange, potentially hitting connection limits
- Doubled REST API calls for backfill, potentially hitting rate limits

**Warning signs:**
- Two instances show the same exchangeId in Redis Stream logs
- Duplicate alert notifications
- Exchange rate limit errors despite single instance expectation

**Prevention:**
1. **Use `SET exchange:<id>:status <payload> NX EX 45` for initial registration.** NX = only set if not exists. This is atomic. If it returns null/nil, another instance already claimed the slot.
2. **Include a unique instance ID in the value.** On heartbeat renewal, use a Lua script that checks the instance ID before renewing:
   ```lua
   -- Atomic heartbeat renewal: only renew if we own the key
   if redis.call('GET', KEYS[1]) then
     local current = cjson.decode(redis.call('GET', KEYS[1]))
     if current.instanceId == ARGV[1] then
       redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
       return 1
     end
   end
   return 0
   ```
3. **On failed NX, read the existing owner and decide:** Log who owns it, report to Admin UI, and enter standby or fail gracefully. Do NOT retry in a loop.
4. **Handle the "zombie instance" scenario:** If Instance A dies without clean shutdown, its key expires after TTL. Instance B can then claim with NX. The TTL is the protection against permanent lock-out.

**Phase to address:** Phase 1 (Instance Registration & Heartbeat)

**Critical note for Azure Redis Cluster:** The status key `exchange:1:status` is a single key, so NX works fine in Cluster mode. No cross-slot concern here.

---

### Pitfall 3: Redis Streams Unbounded Memory Growth

**What goes wrong:** Network activity logs use Redis Streams (`logs:network:coinbase`). Each state transition and error adds an entry via XADD. Over 90 days (the stated retention target), a busy instance producing one entry per minute accumulates ~130,000 entries. During error storms (Redis reconnection loops, exchange API outages), entries could be produced every second, reaching millions of entries. Redis Streams store entries in a radix tree with listpack nodes, and without trimming, this consumes significant memory on the Azure Redis instance.

**Why it happens:** XADD without MAXLEN or MINID creates entries forever. Unlike keys with TTL, individual stream entries do not auto-expire. The only way to remove old entries is explicit trimming.

**Consequences:**
- Azure Redis memory usage grows linearly until hitting the instance limit
- Redis starts evicting other keys (candles, indicators) if maxmemory-policy is noeviction=error, or silently drops data if allkeys-lru
- Performance degrades as streams grow large (XRANGE scans become slower)

**Warning signs:**
- Redis `INFO memory` shows steadily increasing used_memory with no plateau
- `XLEN logs:network:coinbase` returns unexpectedly large numbers
- XRANGE queries for recent entries become slow

**Prevention:**
1. **Always use XADD with MAXLEN or MINID trimming.** Recommended: `XADD logs:network:coinbase MAXLEN ~ 50000 * ...` (approximate trim to 50K entries, which covers ~35 days at 1 entry/minute).
2. **Prefer MINID for time-based retention.** Calculate MINID as `(Date.now() - 90 * 24 * 60 * 60 * 1000)` and pass it: `XADD key MINID ~ <minid> * field value`. This naturally trims entries older than 90 days.
3. **Use approximate (~) trimming, not exact.** Exact trimming examines every entry; approximate trimming is O(1) amortized because it only trims at radix tree node boundaries.
4. **Add a LIMIT clause for safety.** `XADD key MAXLEN ~ 50000 LIMIT 100 * ...` ensures each XADD trims at most 100 old entries, preventing a single XADD from blocking if the stream is severely overgrown.
5. **Monitor XLEN periodically.** Add a simple check: if XLEN exceeds 2x the expected max, log a warning and force a manual XTRIM.
6. **During error storms, throttle XADD.** If the same error repeats, batch it: "Connection error (x47 in last 60s)" instead of 47 individual entries.

**Phase to address:** Phase 2 (Network Activity Logging via Streams)

**Codebase reference:**
- No existing Streams usage in the codebase -- this is net-new code
- `packages/cache/src/client.ts:178-187` - `deleteKeysClusterSafe` shows the pattern of per-key operations for Cluster compatibility

---

### Pitfall 4: State Machine Crash Recovery - Stuck in Transient States

**What goes wrong:** The v6.0 state machine has states: `idle -> starting -> warming -> active -> stopping -> stopped`. Instance begins `starting`, writes `connectionState: "starting"` to Redis. Heartbeat TTL is set. Instance crashes (OOM, power loss, uncaught exception). The key has a 45-second TTL, so it expires -- but during those 45 seconds, Admin UI shows an instance permanently stuck in "starting." After expiry, the key disappears entirely. No record exists that the instance was ever there, and no error is logged.

**Why it happens:** Transient states (`starting`, `warming`, `stopping`) are entered before the operation completes. If the operation never completes (crash), the state persists until TTL expiry. There is no external health check -- the system relies entirely on heartbeat TTL.

**Consequences:**
- Admin UI shows phantom instances in "starting" state for up to 45 seconds after crash
- No crash event in the activity log (instance died before it could log)
- If TTL is too long, the phantom persists for minutes, confusing operators
- After TTL expiry, no forensic evidence remains (key deleted, no stream entry)

**Warning signs:**
- Instance appears in "starting" for longer than the expected startup time (currently ~30 seconds based on backfill + warmup in `control-channel.service.ts:508-571`)
- Instance disappears from Admin UI without a "stopped" or "error" state transition
- Redis Stream has a "starting" entry but no subsequent "active" or "error" entry

**Prevention:**
1. **Transient states should have a shorter TTL than the heartbeat TTL.** The status key written during `starting` should have `EX 60` (startup timeout), while the heartbeat-renewed `active` state uses `EX 45`. If startup takes longer than 60 seconds, the key expires and the instance must re-register.
2. **Write to the activity Stream BEFORE entering a transient state.** `XADD logs:network:coinbase * event state_change from idle to starting instanceId abc123`. This creates a forensic trail even if the instance crashes during the transition.
3. **Admin UI should show time-in-state.** If `connectionState: "starting"` and `lastHeartbeat` is more than 60 seconds ago, UI should show "STARTING (possibly stuck)" with a visual warning.
4. **On startup, check for orphaned registrations.** Before claiming `exchange:1:status`, check if there is an existing key in a transient state with no recent heartbeat. If so, the previous instance likely crashed. Log this finding to the Stream and proceed with claim.
5. **Add graceful shutdown hooks.** `process.on('SIGTERM')` and `process.on('SIGINT')` should transition state to `stopping -> stopped` and delete the registration key before exit.

**Phase to address:** Phase 1 (State Machine) and Phase 2 (Activity Logging)

**Codebase references:**
- `apps/api/src/services/runtime-state.ts:14` - Current `ConnectionState` type is `'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'` -- needs expansion to v6.0 states
- `apps/api/src/services/control-channel.service.ts:648-658` - `updateConnectionState()` only updates in-memory state, does NOT write to Redis

---

### Pitfall 5: Azure Redis Cluster - KEYS Command and Multi-Key Operations

**What goes wrong:** The existing codebase uses `redis.keys(pattern)` in 7 places within `control-channel.service.ts` (lines 840-881). In Azure Managed Redis with OSS Cluster mode, `KEYS` scans only the connected node's slots, not the entire cluster. This means `KEYS candles:1:*` may return an incomplete set of keys. Additionally, any future code that uses multi-key XREAD across streams on different slots will fail with CROSSSLOT errors.

**Why it happens:** OSS Cluster mode distributes keys across shards based on hash slots. Single-key commands (GET, SET, XADD) are routed correctly by ioredis Cluster. Multi-key commands and pattern scans require all keys to hash to the same slot.

**Consequences:**
- `clear-cache` command misses keys on other shards (partial cache clear, corruption)
- Multi-stream XREAD for reading logs from multiple exchanges fails with CROSSSLOT
- `SCAN` (the recommended alternative to KEYS) also only scans the connected node in Cluster mode

**Warning signs:**
- `clear-cache` reports fewer deleted keys than expected
- CROSSSLOT errors in logs when reading multiple streams
- Cache inconsistency after clear-cache (some symbols still have old data)

**Prevention:**
1. **For key scanning, use ioredis Cluster's `scanStream()` method or iterate all nodes.** ioredis Cluster provides `cluster.nodes('master')` to get all master nodes, then scan each one:
   ```typescript
   const masters = cluster.nodes('master');
   for (const node of masters) {
     // SCAN on each individual node
   }
   ```
2. **For Streams, each exchange gets its own stream key.** `logs:network:coinbase` and `logs:network:binance` are separate keys. Read them individually with separate XREAD/XRANGE calls, NOT multi-key XREAD. This is already the planned design and avoids CROSSSLOT.
3. **Hash tags are NOT recommended for status keys.** Using `{exchange}:1:status` forces all exchange status keys to the same slot, creating a hot shard. Since we only read one key at a time, hash tags provide no benefit and create imbalance.
4. **Replace existing KEYS usage.** The 7 `redis.keys()` calls in `control-channel.service.ts` should use SCAN or a key registry pattern. This is existing tech debt that will bite harder as key count grows.
5. **Test with Azure Redis, not local Redis.** Local Redis (Docker `Hermes` on port 6400) is single-node. All Cluster behaviors are invisible locally. Test critical paths against Azure Sandbox.

**Phase to address:** Phase 1 (any Redis operations) and Phase 2 (Streams)

**Codebase references:**
- `apps/api/src/services/control-channel.service.ts:840-881` - 7 `redis.keys()` calls
- `packages/cache/src/client.ts:38-63` - ioredis Cluster configuration with `maxRedirections: 16`
- `packages/cache/src/client.ts:178-187` - `deleteKeysClusterSafe` already uses per-key DEL pattern

---

## Moderate Pitfalls (MEDIUM severity)

### Pitfall 6: Heartbeat Renewal Overwrites Status Payload

**What goes wrong:** Heartbeat runs on a timer: `SET exchange:1:status <full_payload_json> EX 45`. The payload includes `symbolCount`, `connectionState`, `lastError`, etc. But the heartbeat timer captures the payload at creation time or must regenerate it each tick. If the payload is stale (symbolCount changed but heartbeat still sends old value), the status in Redis diverges from reality. Worse, if a status update and heartbeat fire concurrently, they race on the same key -- one overwrites the other.

**Why it happens:** Using a single key for both liveness (TTL) and status (payload) creates coupling. Every heartbeat must serialize the full status, and every status change must also reset the TTL.

**Consequences:**
- Admin UI shows stale symbolCount, wrong connectionState
- Error message from 10 minutes ago persists in status because heartbeat keeps re-writing it
- Status update sets new connectionState but loses the TTL refresh (if using plain SET without EX)

**Prevention:**
1. **Separate heartbeat from status.** Two approaches:
   - **Option A (recommended):** Single key, but heartbeat uses `EXPIRE exchange:1:status 45` to refresh TTL without touching the value. Status updates use `SET exchange:1:status <payload> KEEPTTL` (Redis 6.0+) to update payload without changing TTL.
   - **Option B:** Two keys: `exchange:1:heartbeat` (just instanceId, with TTL) and `exchange:1:status` (full payload, no TTL, deleted on clean shutdown). Admin UI checks both: if heartbeat exists, instance is alive; read status for details.
2. **If using single key with full payload on each heartbeat,** build the payload fresh each tick from the runtime state module. Never cache the payload.
3. **Use `KEEPTTL` flag** (available since Redis 6.0) when updating status payload outside the heartbeat cycle. This prevents accidentally dropping the TTL.

**Phase to address:** Phase 1 (Instance Registration & Heartbeat)

**Verification needed:** Confirm Azure Managed Redis supports KEEPTTL (Redis 6.0+ feature). Azure Managed Redis uses Redis 7.2+ by default, so this should be available. [MEDIUM confidence -- verify against Azure docs]

---

### Pitfall 7: Public IP Detection Blocks Startup

**What goes wrong:** Instance registration requires the public IP address (stated in v6.0 requirements). At startup, the code calls `https://api.ipify.org` or similar service. If the external service is down, rate-limiting, or the network blocks outbound HTTP, the call hangs or fails. If startup waits for this call, the entire instance registration is blocked.

**Why it happens:** External HTTP dependencies at startup create a hard dependency on third-party availability.

**Consequences:**
- Instance fails to register, appears offline in Admin UI
- If the IP fetch has no timeout, the startup hangs indefinitely
- Startup retry logic may cause repeated calls to a rate-limited IP service

**Warning signs:**
- Startup takes >10 seconds (normal startup is ~5 seconds before backfill)
- Timeout errors referencing ipify/ipinfo in logs
- Instance shows `starting` state but never reaches `active`

**Prevention:**
1. **Set a strict timeout (3 seconds) on the IP fetch.** If it fails, use `"unknown"` as the IP address and log a warning. Do NOT block startup.
2. **Cache the public IP.** IPs change rarely. Cache in memory for the lifetime of the process. Re-fetch only on reconnection or every 6 hours.
3. **Use multiple fallback services:**
   ```typescript
   const IP_SERVICES = [
     'https://api.ipify.org?format=json',
     'https://ifconfig.me/ip',
     'https://icanhazip.com',
   ];
   // Try each with 2-second timeout, first success wins
   ```
4. **Make IP optional in the registration payload.** The instance should register immediately with `ipAddress: null`, then update the key once IP is resolved. This decouples registration from IP detection.
5. **Consider privacy implications.** The public IP is visible to all Admin UI users. For Mike and Kaia this is fine (they're partners), but document this as a potential concern for future multi-tenant scenarios.

**Phase to address:** Phase 1 (Instance Registration)

**Codebase note:** v5.0 PITFALLS.md (Pitfall 4) already identified geo-restriction detection via IP. The public IP detection here serves double duty -- both for instance identity and future geo-checking.

---

### Pitfall 8: Admin UI Polling Shows Stale Instance Status

**What goes wrong:** Admin UI polls `control.getNetworkStatus` every 5 seconds. Instance dies at T=0. TTL expires at T=45 seconds. But the Admin UI's last successful poll was at T=-2 seconds, showing the instance as "active." The next poll at T=3 still returns stale data from ioredis's local cache (if connection pooling is involved) or from tRPC's response cache. User sees "active" for up to 50 seconds after death.

**Why it happens:** Multiple caching layers compound staleness: Redis TTL, ioredis connection pooling, tRPC response caching, HTTP caching, React query caching, and the polling interval itself.

**Consequences:**
- Operators trust the Admin UI and don't investigate until much later
- If the UI shows "active" when the instance is dead, manual intervention is delayed
- During the stale window, the exchange has no active instance but the UI says otherwise

**Warning signs:**
- Admin UI shows "active" but Redis key already expired (check with `TTL exchange:1:status`)
- Discrepancy between Redis state and UI state
- "Last heartbeat" timestamp in UI is significantly in the past

**Prevention:**
1. **Display `lastHeartbeat` timestamp prominently.** Even if the status says "active," showing "Last heartbeat: 47 seconds ago" immediately signals something is wrong. Color-code: green (<15s), yellow (15-30s), red (>30s).
2. **Client-side freshness check.** After fetching status, compare `lastHeartbeat` against `Date.now()`. If the gap exceeds the TTL, override the displayed state with "POSSIBLY DEAD" regardless of what the server returned.
3. **Use WebSocket/SSE instead of polling for real-time status.** The existing Redis pub/sub infrastructure could publish status changes. Admin UI subscribes via WebSocket (already exists for alerts).
4. **Disable tRPC response caching for status endpoints.** Set `staleTime: 0` and `cacheTime: 0` on the React Query config for network status queries.
5. **On key expiry, publish an event.** Redis Keyspace Notifications can notify when `exchange:1:status` expires (`SUBSCRIBE __keyevent@0__:expired`). The API server (or a lightweight watcher) can then publish a "instance died" event to the Admin UI's WebSocket.

**Phase to address:** Phase 3 (Admin UI Network View)

**Codebase references:**
- `apps/admin/src/` - Admin UI (React + tRPC client)
- Existing WebSocket alert infrastructure in Admin UI could be extended for status events

---

### Pitfall 9: State Machine Missing Transition Validation

**What goes wrong:** The v6.0 state machine defines valid transitions: `idle -> starting -> warming -> active -> stopping -> stopped`. But nothing prevents invalid transitions like `active -> starting` (instance tries to re-start while already active) or `stopped -> active` (skipping the starting/warming phases). If `updateConnectionState()` accepts any state without validation, bugs in the control flow can put the instance in an impossible state.

**Why it happens:** The current `updateConnectionState()` in `runtime-state.ts` does not validate transitions. It simply overwrites the state with whatever is passed.

**Consequences:**
- Instance shows "active" but internal services are not actually running
- Admin UI displays impossible state transitions in the activity log
- Debugging becomes harder because the state history doesn't make sense

**Warning signs:**
- State transitions in the log that skip intermediate states
- Instance shows "active" immediately after "idle" without "starting" -> "warming"
- Multiple "starting" events without a "stopped" event in between

**Prevention:**
1. **Define a transition map and enforce it:**
   ```typescript
   const VALID_TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
     idle: ['starting'],
     starting: ['warming', 'error', 'stopping'],
     warming: ['active', 'error', 'stopping'],
     active: ['stopping', 'error'],
     stopping: ['stopped', 'error'],
     stopped: ['idle'],
     error: ['idle', 'starting'], // Can retry from error
   };
   ```
2. **Log invalid transition attempts** as errors, but still allow them with a warning. Do NOT throw -- a crash during an invalid transition makes things worse.
3. **Include `previousState` in the status payload.** This makes debugging easier: `{ connectionState: "active", previousState: "warming", stateChangedAt: 1234567890 }`.
4. **Every state transition writes to the Redis Stream** as an audit trail, including `from` and `to` states.

**Phase to address:** Phase 1 (State Machine)

**Codebase reference:**
- `apps/api/src/services/runtime-state.ts:14` - Current ConnectionState type needs expansion
- `apps/api/src/services/runtime-state.ts:77-79` - `updateRuntimeState` does no validation

---

### Pitfall 10: Redis Stream Key Naming in Cluster Mode

**What goes wrong:** The planned stream keys use exchange names: `logs:network:coinbase`, `logs:network:binance`. These hash to different slots (expected and correct -- each stream is independent). But if future code tries to read from both streams in a single XREAD call, it fails with CROSSSLOT. More subtly, if the Admin UI's "Network" view endpoint does `XREAD COUNT 50 STREAMS logs:network:coinbase logs:network:binance 0-0 0-0`, this fails in Cluster.

**Why it happens:** XREAD with multiple stream keys is a multi-key operation. In Cluster mode, all keys in a multi-key command must hash to the same slot.

**Consequences:**
- CROSSSLOT error when Admin UI tries to fetch activity logs from multiple exchanges
- If hash tags are naively added (`{logs:network}:coinbase`), all streams land on one shard, creating a hot shard

**Prevention:**
1. **Read each stream individually.** The API endpoint for network activity should make separate XRANGE calls per exchange and merge results in application code:
   ```typescript
   const coinbaseLogs = await redis.xrange('logs:network:coinbase', '-', '+', 'COUNT', 50);
   const binanceLogs = await redis.xrange('logs:network:binance', '-', '+', 'COUNT', 50);
   const merged = [...coinbaseLogs, ...binanceLogs].sort(byTimestamp);
   ```
2. **Do NOT use hash tags on stream keys.** The streams are independent and should be distributed across shards for even load.
3. **Consider a single unified stream** if cross-exchange chronological ordering is important: `logs:network:all`. Each entry includes an `exchange` field. This avoids multi-key reads entirely. Trade-off: single stream means single shard for all logs, but at the expected volume (few entries per minute) this is fine.
4. **Document the pattern** so future developers don't accidentally introduce multi-stream XREAD.

**Phase to address:** Phase 2 (Network Activity Logging)

---

## Minor Pitfalls (LOW severity)

### Pitfall 11: Heartbeat Timer Drift on Long-Running Processes

**What goes wrong:** `setInterval(heartbeat, 10000)` in Node.js is not guaranteed to fire at exactly 10-second intervals. Over hours of uptime, timer drift accumulates. More critically, if the event loop is blocked by a synchronous operation (JSON.stringify of a large candle set, for example), the heartbeat callback is delayed until the event loop is free.

**Prevention:**
- Use `setInterval` (not `setTimeout` chains) to minimize drift
- Keep heartbeat callback to a single Redis command (no async chains)
- Monitor the actual interval between heartbeats via a timestamp comparison
- Accept that 100-200ms of drift is normal and does not matter with a 45-second TTL

**Phase to address:** Phase 1

---

### Pitfall 12: Registration Payload Serialization Overhead

**What goes wrong:** Status payload includes hostname, IP, admin info, symbol list, connection state, errors, and timestamps. If serialized as JSON on every heartbeat (every 10 seconds), and the payload is large (20+ symbols with metadata), the serialization cost is non-trivial at high frequency.

**Prevention:**
- Keep the payload lean. Store symbolCount (number) instead of the full symbol list
- Separate heartbeat (TTL renewal only) from payload updates (on change only)
- Use `KEEPTTL` for payload-only updates and `EXPIRE` for heartbeat-only renewals

**Phase to address:** Phase 1

---

### Pitfall 13: SIGTERM/SIGKILL Graceful Shutdown Gap

**What goes wrong:** `process.on('SIGTERM')` allows graceful shutdown: transition to `stopping -> stopped`, delete the registration key, log the shutdown to Streams. But `SIGKILL` (or OOM killer on Linux, Task Manager End Process on Windows) gives no opportunity for cleanup. The key remains with its TTL. On Windows (Livermore's platform), `Ctrl+C` sends `SIGINT` which Node.js handles, but closing the terminal window or killing via Task Manager is equivalent to SIGKILL.

**Prevention:**
- Handle `SIGTERM`, `SIGINT`, and `beforeExit` for graceful cleanup
- Accept that hard kills will leave orphaned keys until TTL expiry -- this is by design, and TTL is the safety net
- Do NOT try to make the system bulletproof against SIGKILL. The TTL expiry mechanism IS the crash recovery
- Log the graceful shutdown to the Stream so operators can distinguish clean shutdowns from crashes (clean shutdown has a "stopped" entry; crash has no final entry)

**Phase to address:** Phase 1

---

### Pitfall 14: Redis Connection Loss During Heartbeat

**What goes wrong:** The ioredis Cluster client loses connection to Redis (Azure restart, network blip). During reconnection (up to 5 seconds based on `retryDelayMs: 1000` and `maxRetries: 3`), heartbeat SET commands fail silently or throw. If the heartbeat interval passes during reconnection without successful renewal, the key may expire on the Redis server even though the instance is healthy.

**Prevention:**
- ioredis buffers commands during reconnection by default (good -- heartbeat will be sent once reconnected)
- Verify that `enableOfflineQueue: true` (default in ioredis) is active for the Cluster client
- After reconnection, immediately re-register if the key expired during the outage
- On reconnection, check `EXISTS exchange:1:status`: if the key is gone, re-register with NX

**Phase to address:** Phase 1

**Codebase reference:**
- `packages/cache/src/client.ts:50-58` - Cluster retry strategy already handles reconnection

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|---|---|---|---|
| Instance Registration | TOCTOU race on claim | HIGH | Use SET NX EX atomically |
| Instance Registration | Public IP blocks startup | MEDIUM | Timeout + fallback, register without IP |
| Heartbeat | False death during GC/backfill | HIGH | TTL >= 3x interval, lightweight callback |
| Heartbeat | Overwrites status payload | MEDIUM | Use EXPIRE for TTL, KEEPTTL for payload |
| State Machine | Stuck in transient state after crash | HIGH | TTL on transient states, Stream audit trail |
| State Machine | Invalid transitions | MEDIUM | Transition map enforcement |
| Redis Streams | Unbounded memory growth | HIGH | XADD with MAXLEN ~ or MINID ~ |
| Redis Streams | CROSSSLOT on multi-stream XREAD | MEDIUM | Read streams individually, merge in app |
| Redis Streams | Error storm floods stream | MEDIUM | Throttle/batch repeated errors |
| Admin UI | Stale status display | MEDIUM | Show lastHeartbeat, client-side freshness check |
| Admin UI | Polling overhead | LOW | Consider WebSocket/SSE for real-time |
| Azure Redis Cluster | KEYS command incomplete results | HIGH | Use SCAN per node or key registry |
| Graceful Shutdown | SIGKILL leaves orphaned key | LOW | TTL is the safety net by design |

## Anti-Patterns to Avoid

| Anti-Pattern | Why It Seems Right | Why It Fails |
|---|---|---|
| Using `KEYS` for discovery | Simple, one command | Scans only one node in Cluster, blocks Redis |
| Single key for heartbeat + status | Fewer keys to manage | Coupling causes overwrites and TTL races |
| Exact MAXLEN trimming on XADD | Predictable stream size | O(N) cost per trim, blocks Redis |
| Hash tags on all instance keys | Forces same slot, enables multi-key | Creates hot shard, no benefit for single-key ops |
| Polling at 1-second intervals | "Real-time" feel in UI | Wastes bandwidth, increases Redis load |
| TTL == heartbeat interval | "Detect death instantly" | One missed beat = false death |
| Retry loop on failed NX claim | "Keep trying until I get it" | Fights with legitimate owner, wastes resources |
| `process.exit()` in heartbeat failure | "If I can't heartbeat, I'm broken" | Prevents graceful shutdown, loses in-flight data |

## Redis Command Reference for v6.0

Quick reference for the specific Redis commands needed, all Cluster-safe:

| Operation | Command | Cluster Safe? | Notes |
|---|---|---|---|
| Initial registration | `SET key value NX EX 45` | Yes (single key) | Atomic claim |
| Heartbeat renewal | `EXPIRE key 45` | Yes (single key) | TTL-only, no payload change |
| Status update | `SET key value KEEPTTL` | Yes (single key) | Payload update, keeps existing TTL |
| Heartbeat + status | `SET key value XX EX 45` | Yes (single key) | Full overwrite, XX=only if exists |
| Activity log write | `XADD key MAXLEN ~ 50000 * field value` | Yes (single key) | Auto-trim |
| Activity log read | `XRANGE key - + COUNT 50` | Yes (single key) | Per-stream |
| Activity log trim | `XTRIM key MINID ~ <90-day-id>` | Yes (single key) | Time-based retention |
| Check registration | `GET key` | Yes (single key) | Read status |
| Clean shutdown | `DEL key` | Yes (single key) | Remove registration |

## Sources

**Redis Official Documentation:**
- [Redis SET Command (NX, EX, KEEPTTL)](https://redis.io/docs/latest/commands/set/)
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)
- [XADD Command](https://redis.io/docs/latest/commands/xadd/)
- [XTRIM Command](https://redis.io/docs/latest/commands/xtrim/)
- [XREAD Command](https://redis.io/docs/latest/commands/xread/)
- [Distributed Locks with Redis](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [Redis Cluster Specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Redis Anti-Patterns](https://redis.io/learn/howtos/antipatterns)

**Redis Race Conditions & Locking:**
- [Redis Race Condition Glossary](https://redis.io/glossary/redis-race-condition/)
- [Distributed Locks with Heartbeats](https://compileandrun.com/redis-distrubuted-locks-with-heartbeats/)
- [Redis Lock Patterns](https://redis.io/glossary/redis-lock/)
- [Implementing Distributed Locks (Leapcell)](https://leapcell.io/blog/implementing-distributed-locks-with-redis-delving-into-setnx-redlock-and-their-controversies)

**Redis Cluster & CROSSSLOT:**
- [Resolving CROSSSLOT Errors (HackerNoon)](https://hackernoon.com/resolving-the-crossslot-keys-error-with-redis-cluster-mode-enabled)
- [AWS CROSSSLOT Resolution](https://repost.aws/knowledge-center/elasticache-crossslot-keys-error-redis)
- [ioredis Cluster CROSSSLOT Issue #101](https://github.com/redis/ioredis/issues/101)
- [ioredis XREAD in Cluster Issue #1270](https://github.com/redis/ioredis/issues/1270)

**Azure Managed Redis:**
- [Azure Managed Redis Architecture](https://learn.microsoft.com/en-us/azure/redis/architecture)
- [Azure Managed Redis Overview](https://learn.microsoft.com/en-us/azure/redis/overview)

**Public IP Detection:**
- [ipify API](https://www.ipify.org/)

**Redis Streams Memory Management:**
- [Redis Streams XTRIM Approximate Trimming Issue #9469](https://github.com/redis/redis/issues/9469)
- [Redis Streams Consumer Groups Memory Issue #8635](https://github.com/redis/redis/issues/8635)
- [Managing Redis Streams (Medium)](https://medium.com/@sydcanem/managing-a-redis-stream-b8c912e06fa9)
