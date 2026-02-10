---
phase: 30-instance-registry-and-state-machine
plan: 03
subsystem: network-infrastructure
tags: [redis, state-machine, instance-registry, lifecycle, autostart, shutdown, one-instance-per-exchange]
requires:
  - 30-01 (ConnectionState, InstanceStatus, VALID_TRANSITIONS, constants, instanceStatusKey, detectPublicIp)
  - 30-02 (StateMachineService, InstanceRegistryService)
provides:
  - Full lifecycle integration of instance registry and state machine into server startup, control channel, and shutdown
  - Removal of prototype connection tracking from adapter-factory
  - ServiceRegistry extended with instanceRegistry and stateMachine fields
  - ConnectionState type expanded to union of old and new states
affects:
  - 31 (monitoring dashboard can now read exchange:{id}:status keys from Redis)
  - Control Panel UI (backward-compatible via legacy state mapping in StateMachineService)
tech-stack:
  added: []
  patterns:
    - "Placeholder registry with exchangeId=0 for idle mode, replaced on handleStart"
    - "Atomic claim before backfill to fail fast on exchange conflict"
    - "State machine transitions at lifecycle boundaries (starting/warming/active/stopping/stopped)"
key-files:
  created: []
  modified:
    - apps/api/src/services/types/service-registry.ts
    - apps/api/src/services/runtime-state.ts
    - apps/api/src/services/exchange/adapter-factory.ts
    - apps/api/src/services/exchange/index.ts
    - apps/api/src/routers/exchange-symbol.router.ts
    - apps/api/src/server.ts
    - apps/api/src/services/control-channel.service.ts
decisions:
  - id: "30-03-D1"
    decision: "Placeholder registry with exchangeId=0 created at startup for idle mode"
    reason: "ServiceRegistry requires non-optional instanceRegistry field; idle-mode instances do not know their exchange yet; replaced in handleStart when exchangeId is resolved"
  - id: "30-03-D2"
    decision: "Fresh InstanceRegistryService created in handleStart (not mutated)"
    reason: "InstanceRegistryService is immutable for exchangeId after construction; idle-mode startup creates with 0, handleStart replaces with actual ID"
  - id: "30-03-D3"
    decision: "exchange-symbol.router updated to use instanceStatusKey and InstanceStatus"
    reason: "Old connectionStatusKey and ExchangeConnectionStatus were removed from adapter-factory; router needed migration to new key format (exchange:{id}:status)"
metrics:
  duration: "5m 30s"
  completed: "2026-02-10"
---

# Phase 30 Plan 03: Integration (Wire Services into Lifecycle) Summary

**Instance registry and state machine wired into server startup (autostart and idle), control channel handleStart/handleStop, and graceful shutdown; prototype connection tracking removed from adapter-factory; exchange-symbol router migrated to new key format**

## What Was Done

### Task 1: Update types and clean up adapter-factory.ts
**Commit:** `3543caa`

**Part A: ServiceRegistry type updated**
- Added `instanceRegistry: InstanceRegistryService` and `stateMachine: StateMachineService` as required fields to the `ServiceRegistry` interface
- Added imports for both service types

**Part B: RuntimeState ConnectionState expanded**
- Changed from 5-state union (`idle | connecting | connected | disconnected | error`) to 10-state union adding `starting | warming | active | stopping | stopped`
- Old states kept for backward compatibility with ControlPanel UI

**Part C: Prototype connection tracking removed from adapter-factory**
- Removed `ExchangeConnectionStatus` interface
- Removed `connectionStatusKey()` function
- Removed `setupConnectionTracking()` private method (all 4 adapter event listeners)
- Removed `updateHeartbeat()`, `getConnectionStatus()`, `setConnectionStatus()` methods
- Removed `setConnectionStatus()` call from `create()` method
- Removed `setupConnectionTracking()` call from `createCoinbaseAdapter()`
- Removed unused `private redis: RedisClient` class member
- Updated `exchange/index.ts` to remove old exports
- Updated `exchange-symbol.router.ts` to use `instanceStatusKey` from `@livermore/cache` and `InstanceStatus` from `@livermore/schemas`

Net deletion: 130 lines of prototype code replaced by proper instance registry.

### Task 2: Wire services into server.ts and control-channel.service.ts
**Commit:** `ac2cb74`

**server.ts changes:**
- Import `InstanceRegistryService` and `StateMachineService`
- After pre-flight checks: create `InstanceRegistryService` (with exchangeId or placeholder 0) and `StateMachineService`
- Autostart path: `register()` (atomic claim, exits on failure), `transition('starting')`, then after backfill: `transition('warming')`, after all services: `transition('active')`, `setSymbolCount()`
- ServiceRegistry construction: added `instanceRegistry` and `stateMachine` fields
- Graceful shutdown: `transition('stopping')` before stopping services, `deregister()` after services stopped and before Redis quit
- `initControlChannelService()`: sets admin info on registry with clerkUserId

**control-channel.service.ts changes:**
- Import `InstanceRegistryService` and `StateMachineService`
- `handleStart()`: after exchange resolved from user_exchanges, creates fresh `InstanceRegistryService` with correct exchangeId, creates new `StateMachineService`, calls `register()` (atomic claim with conflict detection), `transition('starting')`, then after backfill: `transition('warming')`, after services: `transition('active')` and `setSymbolCount()`
- `handleStart()` error handler: calls `recordError()` on registry and `resetToIdle()` on state machine
- `handleStop()`: `transition('stopping')` before service shutdown, `transition('stopped')` after, `deregister()`, `resetToIdle()`
- Removed `updateConnectionState()` private method (replaced by state machine)
- Removed `setIdleState()` public method (no longer needed)
- Removed `ConnectionState` import from runtime-state (no longer used)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] exchange-symbol.router.ts and exchange/index.ts import old exports**
- **Found during:** Task 1
- **Issue:** `exchange-symbol.router.ts` imported `connectionStatusKey` and `ExchangeConnectionStatus` from adapter-factory, and `exchange/index.ts` re-exported them. Both would break after removal.
- **Fix:** Updated router to import `instanceStatusKey` from `@livermore/cache` and `InstanceStatus` from `@livermore/schemas`. Updated `exchange/index.ts` to remove old exports. The `isBusy` check (`status.connectionState !== 'idle'`) works identically with InstanceStatus.
- **Files modified:** `apps/api/src/routers/exchange-symbol.router.ts`, `apps/api/src/services/exchange/index.ts`
- **Commit:** `3543caa`

**2. [Rule 3 - Blocking] Unused redis class member in adapter-factory**
- **Found during:** Task 2 (tsc verification)
- **Issue:** After removing all Redis-dependent methods, the `private redis: RedisClient` class member was unused (TS6133 error). The config still references `this.config.redis` for CoinbaseAdapter creation.
- **Fix:** Removed the class member and its constructor assignment.
- **Files modified:** `apps/api/src/services/exchange/adapter-factory.ts`
- **Commit:** `ac2cb74`

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 30-03-D1 | Placeholder registry with exchangeId=0 for idle mode | ServiceRegistry requires non-optional instanceRegistry; idle mode does not know exchange yet |
| 30-03-D2 | Fresh InstanceRegistryService in handleStart | Service is immutable for exchangeId; idle-mode start needs actual ID from user_exchanges |
| 30-03-D3 | Migrated exchange-symbol.router to new key format | Old connectionStatusKey/ExchangeConnectionStatus removed; router now reads exchange:{id}:status |

## Requirements Addressed (Phase 30 Complete)

All 17 Phase 30 requirements delivered across plans 01, 02, and 03:

| Requirement | Status | Delivered In |
|-------------|--------|-------------|
| REG-01 | Done | 30-02 + 30-03 (register() creates key, server.ts/handleStart calls it) |
| REG-02 | Done | 30-02 (14-field InstanceStatus payload) |
| REG-03 | Done | 30-02 (6-state machine with validated transitions) |
| REG-04 | Done | 30-03 (transitions at starting/warming/active/stopping/stopped) |
| REG-05 | Done | 30-02 (async IP detection on register) |
| REG-06 | Done | 30-02 (os.hostname() in payload) |
| HB-01 | Done | 30-02 (SET EX XX heartbeat refresh) |
| HB-02 | Done | 30-01 + 30-02 (15s interval, 45s TTL constants) |
| HB-03 | Done | 30-02 (lastHeartbeat updated every tick) |
| HB-04 | Done | 30-03 (graceful shutdown: transition stopping, deregister) |
| LOCK-01 | Done | 30-02 (NX failure = key exists) |
| LOCK-02 | Done | 30-02 (SET NX EX atomic operation) |
| LOCK-03 | Done | 30-02 (expired key = exchange available) |
| LOCK-04 | Done | 30-02 (conflict error with hostname, IP, connectedAt, TTL) |
| FIX-01 | Done | 30-02 (heartbeat via setInterval, started on register) |
| FIX-02 | Done | 30-02 (recordError from in-memory state) |
| FIX-03 | Done | 30-02 (TTL on every SET call) |

## Verification Results

- `npx tsc --noEmit -p apps/api/tsconfig.json` -- passes with zero errors
- Zero references to `connectionStatusKey` in apps/api/src
- Zero references to `setupConnectionTracking` in apps/api/src
- Zero references to `ExchangeConnectionStatus` in apps/api/src
- `getRuntimeState()` unchanged -- ControlPanel backward compat preserved
- State machine `mapToLegacyState()` maps new states to old for RuntimeState

## Next Phase Readiness

Phase 30 (Instance Registry and State Machine) is complete. The system now:
- Self-registers to Redis on startup with full identity payload and 45s TTL
- Enforces one-instance-per-exchange via atomic SET NX EX
- Tracks lifecycle state through validated transitions (idle -> starting -> warming -> active -> stopping -> stopped)
- Heartbeats every 15s to keep the key alive
- Deregisters cleanly on graceful shutdown
- Resets to idle on stop command for re-start capability

Phase 31 can now read `exchange:{id}:status` keys from Redis to build monitoring dashboards.
