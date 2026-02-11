---
phase: 30-instance-registry-and-state-machine
plan: 02
subsystem: network-infrastructure
tags: [redis, state-machine, heartbeat, instance-registry, atomic-lock, ttl]
requires:
  - 30-01 (ConnectionState, InstanceStatus, VALID_TRANSITIONS, constants, instanceStatusKey, detectPublicIp)
provides:
  - StateMachineService class (transition validation, history, legacy state mapping)
  - InstanceRegistryService class (atomic claim, heartbeat, status updates, error recording)
affects:
  - 30-03 (wires these services into adapter-factory startup/shutdown lifecycle)
tech-stack:
  added: []
  patterns:
    - "SET NX EX for atomic distributed lock with TTL"
    - "SET EX XX for heartbeat refresh (only if key exists)"
    - "KEEPTTL for mid-lifecycle status updates without resetting expiration"
    - "In-memory state as source of truth with periodic Redis sync via heartbeat"
    - "Exhaustive switch with never type for compile-time state mapping safety"
key-files:
  created:
    - apps/api/src/services/state-machine.service.ts
    - apps/api/src/services/instance-registry.service.ts
  modified: []
decisions:
  - id: "30-02-D1"
    decision: "Self-restart detection uses hostname match (not full instanceId)"
    reason: "On restart, PID and timestamp change but hostname stays the same; same-host reclaim is safe because only one process per exchange per host is expected"
  - id: "30-02-D2"
    decision: "setAdminInfo and setSymbolCount defer Redis write to next heartbeat"
    reason: "Reduces Redis round-trips; these values are not time-critical and will be persisted within 15 seconds"
  - id: "30-02-D3"
    decision: "Register retry on NX fail + GET null (race window)"
    reason: "Key can expire between the failed NX and the subsequent GET; a single retry handles this rare but possible race"
metrics:
  duration: "4m 40s"
  completed: "2026-02-10"
---

# Phase 30 Plan 02: Core Services (StateMachine + InstanceRegistry) Summary

**StateMachineService validates 6-state transitions against shared VALID_TRANSITIONS map; InstanceRegistryService manages Redis key lifecycle with SET NX EX atomic claims, 15s heartbeat with 45s TTL, KEEPTTL status updates, and self-restart detection**

## What Was Done

### Task 1: Create StateMachineService
**Commit:** `af1479f`

Created `apps/api/src/services/state-machine.service.ts` with:

- **transition(to)** -- Validates against `VALID_TRANSITIONS[currentState]`, throws on invalid. On valid: records in capped history (50 entries), updates Redis payload via `registry.updateStatus()`, and updates in-memory RuntimeState for backward compat with ControlPanel UI.
- **mapToLegacyState()** -- Exhaustive switch mapping new 6-state model to old 5-state model (idle->idle, starting/warming->connecting, active->connected, stopping/stopped->disconnected). Uses `never` type for compile-time exhaustiveness.
- **getCurrentState()** -- Returns current ConnectionState.
- **getTransitionHistory()** -- Returns defensive copy of transition history array.
- **resetToIdle()** -- Force-resets to idle without validation for crash recovery. Logs warning, updates RuntimeState.

Constructor accepts an `InstanceRegistryService` instance for dependency injection (wired in Plan 03).

### Task 2: Create InstanceRegistryService
**Commit:** `67f254c`

Created `apps/api/src/services/instance-registry.service.ts` with:

- **register()** -- Builds 14-field InstanceStatus payload, attempts `SET key value EX 45 NX` for atomic claim. On success: logs, cleans up old prototype key, starts async IP detection, starts heartbeat. On NX failure: reads existing key, checks hostname for self-restart detection (reclaims with `SET EX XX`), or throws conflict error with hostname/IP/connectedAt/TTL of holder.
- **startHeartbeat()** -- `setInterval` at 15s with `unref()` so timer does not prevent Node exit.
- **heartbeatTick()** -- Updates lastHeartbeat timestamp, writes full payload with `SET EX 45 XX`. If key missing (expired), logs warning and calls `register()` to re-claim. Wrapped in try/catch -- NEVER throws.
- **stopHeartbeat()** -- Clears interval, nulls reference.
- **deregister()** -- Stops heartbeat, deletes Redis key.
- **updateStatus(updates)** -- Merges into in-memory state, writes with `KEEPTTL`.
- **getStatus()** -- Reads and parses from Redis, returns null if missing.
- **recordError(error)** -- Updates lastError/lastErrorAt via updateStatus (FIX-02: works without reading key first).
- **setAdminInfo(email, displayName)** -- Sets in-memory, deferred to next heartbeat.
- **setSymbolCount(count)** -- Sets in-memory, deferred to next heartbeat.

All 5 `redis.set()` calls verified to include either `'EX', HEARTBEAT_TTL_SECONDS` or `'KEEPTTL'` (FIX-03).

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 30-02-D1 | Self-restart detection uses hostname match | PID/timestamp change on restart but hostname stays; one process per exchange per host is expected |
| 30-02-D2 | setAdminInfo/setSymbolCount defer write to heartbeat | Reduces Redis round-trips; values persist within 15s |
| 30-02-D3 | Register retries on NX fail + GET null race | Key can expire between failed NX and subsequent GET |

## Requirements Addressed

| Requirement | Status | Notes |
|-------------|--------|-------|
| REG-01 | Done | Exchange-scoped status key created via register() |
| REG-02 | Done | Full 14-field identity payload in every write |
| REG-03 | Done | 6-state machine with validated transitions |
| REG-04 | Done | StateMachineService.transition() drives all state changes |
| REG-05 | Done | Public IP detected async, written via KEEPTTL |
| REG-06 | Done | Hostname from os.hostname() in payload |
| HB-01 | Done | Heartbeat refreshes TTL via SET EX XX |
| HB-02 | Done | 15s interval, 45s TTL from shared constants |
| HB-03 | Done | lastHeartbeat ISO timestamp updated every tick |
| LOCK-01 | Done | NX failure indicates key exists with valid TTL |
| LOCK-02 | Done | Atomic SET NX EX prevents race condition |
| LOCK-03 | Done | Stale lock auto-detected (key expired = exchange available) |
| LOCK-04 | Done | Conflict error includes hostname, IP, connectedAt, TTL remaining |
| FIX-01 | Done | Heartbeat runs via setInterval (prototype never called it) |
| FIX-02 | Done | recordError writes from in-memory state, no null check needed |
| FIX-03 | Done | TTL on every SET call (EX or KEEPTTL) |

## Next Phase Readiness

Plan 30-03 (Integration) can now:
- Import `StateMachineService` from `./state-machine.service`
- Import `InstanceRegistryService` from `./instance-registry.service`
- Wire both into adapter-factory startup/shutdown lifecycle
- Call `registry.register()` on connect, `stateMachine.transition()` through lifecycle phases, `registry.deregister()` on disconnect

No blockers. Both services compile cleanly and are ready for integration.
