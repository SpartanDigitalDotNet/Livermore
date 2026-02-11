---
phase: 31
plan: 02
subsystem: network
tags: [redis-streams, activity-logging, state-machine, fire-and-forget]
dependency-graph:
  requires: [31-01]
  provides: [activity-logging-wiring, state-transition-logging, error-event-logging]
  affects: [31-03]
tech-stack:
  added: []
  patterns: [optional-dependency-injection, fire-and-forget-catch, async-ip-detection]
key-files:
  created: []
  modified:
    - apps/api/src/services/types/service-registry.ts
    - apps/api/src/services/state-machine.service.ts
    - apps/api/src/services/control-channel.service.ts
    - apps/api/src/server.ts
decisions: []
metrics:
  duration: 4m 14s
  completed: 2026-02-10
---

# Phase 31 Plan 02: Wire Activity Logger into State Machine and Error Paths Summary

**One-liner:** NetworkActivityLogger wired into StateMachineService transitions and ControlChannelService error paths with fire-and-forget semantics, async IP detection, and admin email propagation.

## What Was Built

### ServiceRegistry Update (`apps/api/src/services/types/service-registry.ts`)

- Added optional `activityLogger?: NetworkActivityLogger` field to ServiceRegistry interface
- Import added for `NetworkActivityLogger` type

### StateMachineService Wiring (`apps/api/src/services/state-machine.service.ts`)

- Added optional `NetworkActivityLogger` parameter to constructor (backward compatible)
- `transition()` method now calls `logTransition(from, to)` fire-and-forget after successful state update
- The log call is placed AFTER all state updates succeed (Redis, RuntimeState, logger.info) to ensure only completed transitions are logged
- `.catch(() => {})` swallows promise rejections as safety net (logger already catches internally)
- `resetToIdle()` and heartbeat paths have NO logging calls (LOG-06)

### ControlChannelService Error Logging (`apps/api/src/services/control-channel.service.ts`)

- Added imports: `hostname` from `node:os`, `NetworkActivityLogger`, `detectPublicIp`
- In `handleStart()`: Creates `NetworkActivityLogger` with exchange context, admin email, and hostname
- Assigns logger to `this.services.activityLogger` before creating StateMachineService
- Passes logger to `new StateMachineService(registry, activityLogger)`
- Calls `detectPublicIp().then()` for async IP update on the logger
- In `handleStart()` catch block: Calls `logError(errorMessage, currentState)` fire-and-forget with `.catch(() => {})`

### Server Lifecycle Wiring (`apps/api/src/server.ts`)

- Added imports: `hostname` from `node:os`, `NetworkActivityLogger`, `detectPublicIp`
- Creates `NetworkActivityLogger` after `InstanceRegistryService` with exchangeId, exchangeName, hostname
- Passes logger to `new StateMachineService(instanceRegistry, activityLogger)`
- Calls `detectPublicIp().then()` for async IP update
- In `initControlChannelService`: Calls `activityLogger.setAdminEmail(clerkUserId)` when user authenticates
- Added `activityLogger` to ServiceRegistry object construction

## Verification Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` apps/api | Pass |
| logTransition in StateMachineService.transition() | Verified |
| logError in handleStart catch block | Verified |
| activityLogger in ServiceRegistry interface | Verified |
| NetworkActivityLogger created in server.ts | Verified |
| NetworkActivityLogger created in handleStart | Verified |
| setAdminEmail called in initControlChannelService | Verified |
| detectPublicIp called in both server.ts and control-channel | Verified |
| instance-registry.service.ts NOT modified | Verified (LOG-06) |
| All logTransition/logError have .catch(() => {}) | Verified |

## Success Criteria

- [x] LOG-01: Stream key `logs:network:{exchange_name}` used via networkActivityStreamKey (from Plan 01)
- [x] LOG-02: State transitions logged by StateMachineService.transition() -> logTransition()
- [x] LOG-03: Errors logged by handleStart catch -> logError() with current state
- [x] LOG-04: MINID trimming on every XADD (from Plan 01 logger)
- [x] LOG-05: Consistent field names (from Plan 01 schemas)
- [x] LOG-06: Heartbeat NEVER logged -- instance-registry.service.ts is not modified, no logging in heartbeatTick or resetToIdle

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 89e155c | feat(31-02): add activityLogger to ServiceRegistry and StateMachineService |
| cdfdc13 | feat(31-02): wire NetworkActivityLogger into error paths and server lifecycle |

## Next Phase Readiness

Phase 31 is now complete. All activity logging infrastructure is in place:
- Plan 01 delivered schemas, key builder, and logger service
- Plan 02 wired the logger into state transitions and error paths

The system now records all state transitions and errors to Redis Streams for every exchange instance. Future phases can query these streams for observability dashboards or audit trails.
