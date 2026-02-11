---
phase: 31
plan: 01
subsystem: network
tags: [redis-streams, zod, logging, activity-log]
dependency-graph:
  requires: [30-01, 30-02]
  provides: [activity-log-schemas, network-activity-logger-service, network-stream-key-builder]
  affects: [31-02]
tech-stack:
  added: []
  patterns: [redis-streams-xadd, minid-trimming, fire-and-forget-logging, discriminated-union-schemas]
key-files:
  created:
    - packages/schemas/src/network/activity-log.schema.ts
    - apps/api/src/services/network-activity-logger.ts
  modified:
    - packages/schemas/src/index.ts
    - packages/cache/src/keys.ts
decisions:
  - id: 31-01-D1
    decision: "networkActivityStreamKey uses exchange name (not ID) with lowercase normalization"
    reason: "LOG-01 spec requires logs:network:{exchange_name} pattern; lowercase ensures consistency"
  - id: 31-01-D2
    decision: "BaseLogEntrySchema is internal-only (not exported)"
    reason: "Consumers should use the specific StateTransitionEntry or ErrorEntry types"
  - id: 31-01-D3
    decision: "Empty string defaults for ip and adminEmail in logger constructor"
    reason: "Redis Streams cannot store null/undefined; empty string is the safe sentinel"
metrics:
  duration: 3m 35s
  completed: 2026-02-10
---

# Phase 31 Plan 01: Activity Log Schemas and Logger Service Summary

**One-liner:** Zod discriminated-union schemas for state transition and error log entries, plus NetworkActivityLogger service writing to Redis Streams with 90-day MINID trimming.

## What Was Built

### Activity Log Schemas (`packages/schemas/src/network/activity-log.schema.ts`)

- **BaseLogEntrySchema** (internal): Shared fields -- timestamp, exchangeId, exchangeName, hostname, ip
- **StateTransitionEntrySchema** (LOG-02): Extends base with event='state_transition', fromState, toState, adminEmail
- **ErrorEntrySchema** (LOG-03): Extends base with event='error', error message, current state
- **NetworkActivityEntrySchema** (LOG-05): Discriminated union on 'event' field combining both entry types
- All types exported via barrel in `packages/schemas/src/index.ts`

### Key Builder (`packages/cache/src/keys.ts`)

- **networkActivityStreamKey(exchangeName)**: Returns `logs:network:{name_lowercase}` (LOG-01)
- Placed in INSTANCE REGISTRY section alongside `instanceStatusKey`

### NetworkActivityLogger Service (`apps/api/src/services/network-activity-logger.ts`)

- **Constructor**: Accepts redis, exchangeId, exchangeName, hostname, optional ip/adminEmail
- **logTransition(from, to)**: XADD with MINID ~ trimming, all string field values (LOG-02, LOG-04, LOG-05)
- **logError(error, currentState)**: Same XADD pattern for error events (LOG-03, LOG-04, LOG-05)
- **setIp(ip)**: Deferred IP update after async detection
- **setAdminEmail(email)**: Deferred admin identity update
- Both log methods catch all errors internally -- fire-and-forget, never throw (LOG-06 by exclusion: no heartbeat methods)

## Verification Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` packages/schemas | Pass |
| `tsc --noEmit` packages/cache | Pass |
| `tsc --noEmit` apps/api | Pass |
| StateTransitionEntrySchema has LOG-02 fields | Verified |
| ErrorEntrySchema has LOG-03 fields | Verified |
| NetworkActivityEntrySchema is discriminated union | Verified |
| networkActivityStreamKey follows LOG-01 | Verified |
| Both XADD calls use MINID ~ | Verified |
| All stream values are strings | Verified |
| Both methods have try/catch | Verified |
| No heartbeat methods in logger | Verified (LOG-06) |

## Success Criteria

- [x] LOG-01: Stream key `logs:network:{exchange_name}` via networkActivityStreamKey
- [x] LOG-02: StateTransitionEntry schema + logTransition method
- [x] LOG-03: ErrorEntry schema + logError method
- [x] LOG-04: XADD with MINID ~ and 90-day threshold on both methods
- [x] LOG-05: Consistent field names via shared BaseLogEntrySchema
- [x] LOG-06: No heartbeat logging in NetworkActivityLogger

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cache package dist was stale after adding networkActivityStreamKey**

- **Found during:** Task 2 verification
- **Issue:** `tsc --noEmit -p apps/api/tsconfig.json` reported `networkActivityStreamKey` not found in `@livermore/cache` because the package points to built `dist/` output
- **Fix:** Ran `turbo build --filter=@livermore/cache` to regenerate dist with the new export
- **Files modified:** packages/cache/dist/ (build artifacts, not committed)
- **Impact:** None -- standard workflow for monorepo packages with tsup builds

## Commits

| Hash | Message |
|------|---------|
| 5359f11 | feat(31-01): add activity log schemas and key builder |
| bb12f4a | feat(31-01): add NetworkActivityLogger service |

## Next Phase Readiness

Plan 31-02 can proceed immediately. It needs:
- `NetworkActivityLogger` class from this plan (done)
- `networkActivityStreamKey` from cache package (done)
- All schema types available via `@livermore/schemas` (done)

The logger is a standalone service ready to be wired into StateMachineService transitions and error paths.
