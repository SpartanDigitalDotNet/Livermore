# Project Research Summary

**Project:** Livermore Trading Platform -- v6.0 "Perseus Network"
**Domain:** Distributed instance coordination, service registry, health monitoring
**Researched:** 2026-02-10
**Confidence:** HIGH

## Executive Summary

v6.0 Perseus Network transforms Livermore from isolated API instances with no mutual awareness into a coordinated distributed system with identity, health monitoring, and audit logging. The existing prototype writes an `exchange:status:{exchangeId}` key in Redis but has three documented bugs: heartbeat never updates, error never populates, and connectionState sticks on `idle` when an instance dies. Perseus replaces this broken prototype with a proper `InstanceRegistryService` backed by TTL-based heartbeat, a typed state machine, Redis Streams for activity logging, and an Admin UI "Network" page for operational visibility.

The recommended approach builds entirely on the existing stack with zero new dependencies. ioredis 5.4.2 (already installed) has full support for Redis Streams (XADD, XRANGE, XTRIM with MINID), TTL-based heartbeat (SET EX), and atomic registration (SET NX EX). The state machine is 5-6 states with 7 transitions -- trivially implementable in ~80 lines of typed code without a library. Public IP detection uses a 10-line utility function calling ipify.org via Node.js built-in `https`, avoiding ESM-only npm packages that break the CJS build. A dedicated `packages/perseus` package (or service files under `apps/api/src/services/`) provides clean bounded context for all network coordination logic.

The critical risks are: (1) heartbeat TTL timing -- too short causes false death during GC pauses or backfill, too long delays detection; mitigated by a 10-15s heartbeat interval with 45s TTL (3-4.5x ratio). (2) One-instance-per-exchange TOCTOU race -- GET-then-SET allows two instances to claim the same exchange; mitigated by atomic `SET NX EX`. (3) Redis Streams unbounded growth -- XADD without trimming consumes all Redis memory; mitigated by inline `MAXLEN ~` or `MINID ~` trimming on every write. (4) Azure Redis Cluster compatibility -- existing `redis.keys()` calls scan only one node; v6.0 must use SCAN per node or known-ID lookups from the database.

## Key Findings

### Recommended Stack

Zero new npm dependencies required. Every capability builds on ioredis 5.4.2 (already pinned), Zod 3.25.x (already installed), and Node.js built-ins. The state machine is hand-rolled (~80 lines). Public IP detection uses `node:https` to query ipify.org with a 3-5 second timeout and fallback chain (icanhazip.com, ifconfig.me, or `null`). No ESM-only packages, no external service discovery (Consul/etcd), no job queue libraries (Bull/BullMQ).

**Core technologies (all existing):**
- **ioredis 5.4.2**: Redis Streams (XADD/XRANGE/XTRIM), TTL heartbeat (SET EX/NX), atomic registration -- verified against installed type definitions
- **Redis (Azure Managed, OSS Cluster)**: Coordination bus for status keys, heartbeat TTL, activity streams -- all single-key operations, cluster-safe
- **TypeScript 5.9.3 + Zod**: Typed state machine, schema validation for stream entries and registration payloads
- **Node.js built-ins**: `node:https` for public IP, `node:os` for hostname, `setInterval` for heartbeat timer

**Explicitly rejected:**
- `public-ip` npm (ESM-only, breaks CJS builds)
- XState (47KB for 5 states -- overkill)
- Redis Keyspace Notifications (unreliable in Cluster mode)
- External service discovery (overkill for 2-10 instances)

See [STACK.md](./STACK.md) for full evaluation matrix and API reference.

### Expected Features

**Must have (table stakes) -- 26 features across 6 groups:**

- Instance registration with full identity (hostname, IP, admin, exchange, symbol count) via exchange-scoped status keys with TTL
- Connection state machine: `idle -> starting -> warming -> active -> stopping -> stopped` with validated transitions at each lifecycle phase
- Heartbeat with TTL (15s interval, 45s TTL) for automatic dead instance detection
- One-instance-per-exchange enforcement via atomic `SET NX EX` with clear conflict error messages
- Network activity logging via Redis Streams with 90-day retention (MINID trimming)
- Admin UI Network page with instance cards, activity feed, dead instance detection, and 5s polling
- Three tRPC endpoints: `getInstances`, `getActivityLog`, `getExchangeStatus`
- Three bug fixes: heartbeat not updating, error not populating, connectionState stuck on idle

**Should have (differentiators) -- low-hanging fruit for v6.0:**
- Instance uptime display ("Running for 4h 23m") -- trivial, high user value
- Heartbeat latency indicator with color degradation (green/yellow/red)
- Discord notifications for state changes (leverages existing Discord service)

**Defer to v6.1+:**
- Standby/passive instance registration
- Graceful handoff protocol between instances
- Remote Admin control (cross-instance commands)
- WebSocket-based real-time network view (polling is sufficient for v6.0)
- Historical uptime percentage calculations
- Prometheus/metrics integration

See [FEATURES.md](./FEATURES.md) for complete feature table with IDs and dependency graph.

### Architecture Approach

The architecture introduces three new server-side components (`InstanceRegistryService`, `StateMachineService`, `network.router.ts`) and one new Admin UI page (`Network.tsx`). These integrate with three existing systems: the API server lifecycle in `server.ts` and `ControlChannelService`, the Redis Cluster connection via ioredis, and the Admin UI's tRPC polling pattern. The existing `ExchangeAdapterFactory.setupConnectionTracking()` is removed entirely -- the state machine owns all state.

**Major components:**
1. **InstanceRegistryService** -- Owns registration, heartbeat, deregistration, and stream logging. Writes to `exchange:{id}:instance` (SET EX) and `logs:network:{name}` (XADD). Created after pre-flight checks in `server.ts`.
2. **StateMachineService** -- Validates state transitions against a typed transition map. Called by `ControlChannelService` and `server.ts` at each lifecycle phase. Replaces scattered `updateConnectionState()` calls.
3. **network.router.ts** -- tRPC endpoints for Admin UI. Reads instance keys (via known exchange IDs from database, not SCAN) and stream entries (XREVRANGE per exchange).
4. **Network.tsx + InstanceCard + ActivityFeed** -- Admin UI page with 5s polling for instances and 10s polling for activity log. Color-coded status badges. Dead instance detection via missing keys.

**Key architectural decisions:**
- Single key per instance (`exchange:{id}:instance`) with JSON payload and TTL, not separate heartbeat/status keys (simpler for v6.0; can split later if needed)
- Per-exchange activity streams (`logs:network:{name}`), read individually and merged in application code (avoids CROSSSLOT in Cluster)
- `getInstances` reads from known exchange IDs in database, not SCAN (cluster-safe, predictable)
- Backward compatibility: existing ControlPanel continues working via in-memory `getRuntimeState()`; StateMachineService updates both Redis and in-memory state

See [ARCHITECTURE.md](./ARCHITECTURE.md) for integration points, data flow diagrams, and file change inventory.

### Critical Pitfalls

**Top 5 pitfalls requiring explicit mitigation:**

1. **Heartbeat TTL timing (HIGH)** -- If TTL is too close to heartbeat interval, GC pauses, backfill operations, or Redis reconnections cause false death detection. Split-brain possible if a second instance claims the slot during false death. **Prevent:** TTL >= 3x heartbeat interval (45s TTL with 15s interval). Keep heartbeat callback to a single `SET EX` command, no heavy computation.

2. **One-instance-per-exchange TOCTOU race (HIGH)** -- GET-then-SET for exchange claim is not atomic. Two instances can both see null and both write. **Prevent:** Use `SET NX EX` for initial registration (atomic set-if-not-exists with TTL). Include instance ID in payload; verify ownership on heartbeat renewal.

3. **Redis Streams unbounded memory (HIGH)** -- XADD without trimming grows forever. Error storms can produce millions of entries. **Prevent:** Always trim inline: `XADD key MAXLEN ~ 50000 *` or `XADD key MINID ~ <90-day-ms> *`. Throttle repeated errors to batched entries.

4. **State machine crash recovery (HIGH)** -- Instance crashes in `starting` state. Key persists for TTL duration showing phantom "starting" instance. No crash event logged. **Prevent:** Write to activity stream BEFORE entering transient states. Admin UI shows time-in-state with "possibly stuck" warning. On startup, check for orphaned registrations.

5. **Azure Redis Cluster KEYS command (HIGH)** -- Existing 7 `redis.keys()` calls in `control-channel.service.ts` scan only one node in Cluster. v6.0 must not introduce more. **Prevent:** Use known exchange IDs from database for lookups. Replace existing KEYS with SCAN-per-node or key registry pattern.

See [PITFALLS.md](./PITFALLS.md) for all 14 pitfalls with severity levels, warning signs, and prevention strategies.

## Implications for Roadmap

Based on combined research, the milestone decomposes into 4 phases with clear dependency ordering. All four research files converge on this structure independently. The phases map to the feature dependency graph from FEATURES.md, the build order from ARCHITECTURE.md, and the phase warnings from PITFALLS.md.

### Phase 1: Instance Registry and State Machine

**Rationale:** Everything depends on having a proper instance key with identity, TTL heartbeat, and validated state transitions. This is the foundation that replaces the broken prototype. Must be built first because Phases 2-4 all read from or write to the instance key.

**Delivers:** InstanceRegistryService (register, heartbeat, deregister), StateMachineService (typed transitions), public IP detection, exchange-scoped status keys with TTL, one-instance-per-exchange enforcement via SET NX EX.

**Features addressed:** REG-01 through REG-06, HB-01 through HB-04, LOCK-01 through LOCK-04, REG-03 (state machine), FIX-01 through FIX-03

**Pitfalls to avoid:**
- Heartbeat TTL timing (Pitfall 1): Use 15s interval with 45s TTL
- TOCTOU race (Pitfall 2): Use SET NX EX for atomic claim
- Crash recovery (Pitfall 4): TTL on all states, stream logging before transitions
- Public IP blocking startup (Pitfall 7): 3s timeout, register with null IP, update async
- Heartbeat overwrites payload (Pitfall 6): Consider EXPIRE for TTL-only renewal, KEEPTTL for payload updates
- State machine validation (Pitfall 9): Enforce transition map, log invalid attempts

**Files created:** `instance-registry.service.ts`, `state-machine.service.ts`, Zod schemas in `packages/schemas`, key builders in `packages/cache/src/keys.ts`

**Files modified:** `server.ts` (register after pre-flight, shutdown deregister), `control-channel.service.ts` (replace updateConnectionState with stateMachine.transition), `adapter-factory.ts` (remove setupConnectionTracking)

### Phase 2: Network Activity Logging

**Rationale:** Depends on Phase 1 (needs state transitions to log and heartbeat events to detect). Redis Streams are a new primitive for the codebase. Isolating stream work makes it testable before the UI consumes it.

**Delivers:** Activity stream per exchange (`logs:network:{name}`), structured event logging for state changes and errors, 90-day retention via MINID or MAXLEN trimming, XADD/XRANGE/XTRIM wrappers.

**Features addressed:** LOG-01 through LOG-05

**Pitfalls to avoid:**
- Unbounded memory growth (Pitfall 3): Inline MAXLEN ~ 50000 on every XADD
- CROSSSLOT on multi-stream XREAD (Pitfall 10): Read streams individually, merge in application code
- Error storm flooding (Pitfall 3 addendum): Throttle repeated errors, batch as "error x47 in last 60s"

**Key decision:** MAXLEN ~ 50000 (simpler) vs MINID ~ 90-day (time-precise). Either works; MAXLEN is recommended for v6.0 simplicity (50K entries covers ~35 days at 1 entry/minute, much longer in practice). Can switch to MINID later if exact time-based retention matters.

### Phase 3: tRPC Network Router

**Rationale:** Depends on Phase 1 (instance keys to read) and Phase 2 (stream entries to query). Creates the API surface the Admin UI will consume. Also the enforcement point for one-instance-per-exchange in the start command flow.

**Delivers:** `network.router.ts` with `getInstances`, `getNetworkLog`, `getExchangeStatus` endpoints. One-instance check in `handleStart()`. Optional `force-start` command for overriding stale instances.

**Features addressed:** RPC-01 through RPC-03

**Pitfalls to avoid:**
- Azure Cluster KEYS command (Pitfall 5): Query exchanges table for known IDs, then GET each instance key. No SCAN or KEYS.
- Stale data in response (Pitfall 8): Include `lastHeartbeat` in response so UI can calculate freshness client-side.

### Phase 4: Admin UI Network View

**Rationale:** Consumes all three backend phases. Build last so all data sources are available and tested. Follows existing Admin UI patterns (tRPC polling, hash routing, component-per-card).

**Delivers:** Network page in Admin nav, instance cards with color-coded status badges, dead instance detection, scrollable activity feed, 5s/10s polling.

**Features addressed:** UI-01 through UI-05, DIFF-01 (uptime display), DIFF-02 (heartbeat latency indicator)

**Pitfalls to avoid:**
- Stale status display (Pitfall 8): Display `lastHeartbeat` prominently with color degradation. Client-side freshness check overrides status to "POSSIBLY DEAD" if heartbeat gap exceeds TTL.
- Set `staleTime: 0` on React Query config for network status queries.

### Phase Ordering Rationale

- **Phase 1 before all others:** The instance key with TTL is the single source of truth. Streams (Phase 2) log transitions from the state machine. The router (Phase 3) reads instance keys. The UI (Phase 4) displays router data. Everything flows from the registry.
- **Phase 2 before Phase 3:** The network router's `getNetworkLog` endpoint reads from streams. Streams must exist and be populated before the router can serve them. Building streams as a separate phase also allows thorough testing of retention/trimming before the UI adds read pressure.
- **Phase 3 before Phase 4:** The Admin UI is purely a consumer. Building the tRPC endpoints first means the UI can be developed against a known, tested API contract. This also allows testing endpoints via curl/Postman before building React components.
- **Pitfall avoidance by ordering:** Phase 1 addresses the 4 highest-severity pitfalls (heartbeat timing, TOCTOU, crash recovery, public IP). By front-loading these, the riskiest engineering is resolved before building dependent features that would amplify any defects.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 1 (Instance Registry):** Needs careful design of the heartbeat/status key strategy (single key with KEEPTTL vs. separate heartbeat and status keys). The research surfaced two valid approaches -- the phase plan should make a definitive choice based on testing.
- **Phase 2 (Streams):** First use of Redis Streams in the codebase. While the API is well-documented, integration testing against Azure Redis Cluster should validate XADD/XRANGE/XTRIM behavior. Verify MINID support on the specific Azure Redis tier.

**Phases with standard, well-documented patterns (skip deep research):**
- **Phase 3 (tRPC Router):** Follows existing `control.router.ts` pattern exactly. Straightforward queries over Redis data. No novel patterns.
- **Phase 4 (Admin UI):** Follows existing `ControlPanel.tsx` polling pattern. React Query + tRPC + polling interval. Component structure mirrors existing pages.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All APIs verified against installed ioredis 5.4.2 type definitions. Redis Streams commands confirmed in RedisCommander.d.ts. |
| Features | HIGH | Feature set derived from PROJECT.md requirements and codebase analysis. Existing bugs documented with line references. Dependency graph validated. |
| Architecture | HIGH | Integration points identified with specific file paths and line numbers. Data flow diagrams account for existing ControlPanel backward compatibility. |
| Pitfalls | HIGH | 14 pitfalls identified across 3 severity levels. Critical pitfalls (TOCTOU, TTL timing, Streams growth) have concrete prevention strategies verified against Redis documentation. |

**Overall confidence: HIGH**

All four research files cross-reference each other and the codebase consistently. The stack research verified API availability against installed type definitions. The architecture research identified specific files and line numbers for integration. The pitfalls research references concrete codebase patterns and Redis documentation. The feature research maps cleanly to the architecture components.

### Gaps to Address

- **KEEPTTL on Azure Managed Redis:** Pitfalls research recommends KEEPTTL (Redis 6.0+) for separating heartbeat from status updates. Azure Managed Redis should support this (7.2+ default), but this has not been verified against the actual Azure instance. Validate during Phase 1 implementation.
- **MINID behavior with ioredis Cluster:** Stack research verified XTRIM MINID type signatures exist in ioredis 5.4.2. Actual behavior against Azure Redis Cluster has not been tested. Validate during Phase 2 implementation.
- **Heartbeat interval tuning:** Research recommends 10-15s interval with 45s TTL. Optimal values depend on real-world event loop latency during backfill and warmup. Start with 15s/45s and tune based on observed heartbeat jitter in production.
- **MAXLEN vs MINID for stream retention:** Architecture research favors MAXLEN ~ 50000 (simpler). Stack research favors MINID ~ 90-day (time-precise). Both work. Pick one during Phase 2 planning based on whether exact time-based retention matters for audit compliance.
- **Single unified stream vs per-exchange streams:** Architecture research uses per-exchange streams (`logs:network:coinbase`). Pitfalls research notes that a single unified stream (`logs:network:all`) avoids multi-key read complexity. For 2-3 exchanges, a single stream is simpler. For 6+ exchanges, per-exchange is better. Decide during Phase 2 based on current exchange count trajectory.

## Sources

### Primary (HIGH confidence)
- ioredis 5.4.2 installed type definitions (`RedisCommander.d.ts`) -- XADD, XRANGE, XTRIM, SET NX EX signatures
- Livermore codebase analysis -- `server.ts`, `control-channel.service.ts`, `adapter-factory.ts`, `runtime-state.ts`, `client.ts`, `keys.ts`, `ControlPanel.tsx`
- [Redis Streams Documentation](https://redis.io/docs/latest/develop/data-types/streams/)
- [Redis SET Command (NX, EX, KEEPTTL)](https://redis.io/docs/latest/commands/set/)
- [Redis XADD Command](https://redis.io/docs/latest/commands/xadd/)
- [Redis XTRIM Command](https://redis.io/docs/latest/commands/xtrim/)
- [Redis Cluster Specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Redis Distributed Locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)

### Secondary (MEDIUM confidence)
- [Redis Heartbeat-Based Session Tracking](https://medium.com/tilt-engineering/redis-powered-user-session-tracking-with-heartbeat-based-expiration-c7308420489f) -- TTL refresh patterns
- [Distributed Locks with Heartbeats](https://compileandrun.com/redis-distrubuted-locks-with-heartbeats/) -- SET NX EX for atomic claims
- [Resolving CROSSSLOT Errors](https://hackernoon.com/resolving-the-crossslot-keys-error-with-redis-cluster-mode-enabled) -- Hash tags and multi-key operations
- [Azure Managed Redis Architecture](https://learn.microsoft.com/en-us/azure/redis/architecture) -- OSS Cluster compatibility
- [ipify.org](https://www.ipify.org/) -- Public IP detection service
- [Health Check API Pattern](https://microservices.io/patterns/observability/health-check-api.html) -- Microservices health monitoring

### Tertiary (LOW confidence)
- [Redis Streams XTRIM Approximate Trimming Issue #9469](https://github.com/redis/redis/issues/9469) -- Edge cases in approximate trimming
- [ioredis XREAD in Cluster Issue #1270](https://github.com/redis/ioredis/issues/1270) -- CROSSSLOT behavior for multi-stream XREAD

---
*Research completed: 2026-02-10*
*Ready for roadmap: yes*
