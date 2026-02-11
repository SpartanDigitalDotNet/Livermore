---
phase: 30-instance-registry-and-state-machine
plan: 01
subsystem: network-infrastructure
tags: [zod, redis, state-machine, heartbeat, ip-detection]
requires: []
provides:
  - ConnectionState 6-state enum with transition map
  - InstanceStatus Zod schema (14-field identity payload)
  - instanceStatusKey cache key builder
  - detectPublicIp async utility
  - Heartbeat constants (15s interval, 45s TTL)
affects:
  - 30-02 (InstanceRegistryService imports schema, key builder, constants, IP utility)
  - 30-03 (StateMachineService imports ConnectionState, VALID_TRANSITIONS)
tech-stack:
  added: []
  patterns:
    - "Zod enum for finite state machine states"
    - "as const satisfies for typed transition maps"
    - "node:https for zero-dependency HTTP utilities"
key-files:
  created:
    - packages/schemas/src/network/instance-status.schema.ts
    - apps/api/src/utils/detect-public-ip.ts
  modified:
    - packages/schemas/src/index.ts
    - packages/cache/src/keys.ts
decisions:
  - id: "30-01-D1"
    decision: "adminEmail and adminDisplayName are nullable in InstanceStatus schema"
    reason: "At registration time (before first auth request) user identity is unavailable; updated asynchronously via SET KEEPTTL after ControlChannelService initializes"
  - id: "30-01-D2"
    decision: "Key pattern is exchange:{id}:status (not exchange:status:{id})"
    reason: "Consistent with existing exchange-scoped keys like candles:{id}:... and indicator:{id}:..."
  - id: "30-01-D3"
    decision: "HEARTBEAT_TTL_SECONDS exported separately from HEARTBEAT_TTL_MS"
    reason: "Redis SET EX takes seconds; JS setTimeout takes milliseconds; avoid conversion errors at call sites"
metrics:
  duration: "3m 44s"
  completed: "2026-02-10"
---

# Phase 30 Plan 01: Foundation Types and Utilities Summary

**Zod schema with 6-state ConnectionState enum, 14-field InstanceStatus payload, heartbeat constants, instanceStatusKey builder, and detectPublicIp utility using node:https**

## What Was Done

### Task 1: InstanceStatus Zod schema with state machine constants
**Commit:** `409f187`

Created `packages/schemas/src/network/instance-status.schema.ts` with:

- **ConnectionStateSchema** -- Zod enum with 6 values: `idle`, `starting`, `warming`, `active`, `stopping`, `stopped`
- **VALID_TRANSITIONS** -- Typed transition map (`as const satisfies Record<ConnectionState, readonly ConnectionState[]>`) defining allowed state changes including error recovery paths (starting/warming can fall back to idle)
- **Heartbeat constants** -- `HEARTBEAT_INTERVAL_MS` (15s), `HEARTBEAT_TTL_MS` (45s), `HEARTBEAT_TTL_SECONDS` (45)
- **InstanceStatusSchema** -- 14-field Zod object covering identity (exchangeId, hostname, IP, admin info), state (connectionState, symbolCount), timestamps (connectedAt, lastHeartbeat, lastStateChange, registeredAt), and error tracking (lastError, lastErrorAt)

Updated `packages/schemas/src/index.ts` to re-export all network schema symbols.

### Task 2: Cache key builder and public IP detection
**Commit:** `40a03b8`

Added `instanceStatusKey(exchangeId)` to `packages/cache/src/keys.ts`:
- Returns `exchange:{exchangeId}:status`
- Placed in new "INSTANCE REGISTRY" section before Tier 1 keys
- Follows existing JSDoc and naming conventions

Created `apps/api/src/utils/detect-public-ip.ts`:
- Uses `node:https` to call `https://api.ipify.org`
- 3-second default timeout with `req.destroy()` on timeout
- Never throws -- all error paths resolve to `null`
- Returns trimmed IP string on success

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 30-01-D1 | adminEmail/adminDisplayName are nullable | User identity unavailable at registration time; updated asynchronously after first auth |
| 30-01-D2 | Key pattern `exchange:{id}:status` | Consistent with other exchange-scoped keys in the codebase |
| 30-01-D3 | Separate HEARTBEAT_TTL_SECONDS constant | Redis SET EX takes seconds; avoids ms-to-s conversion errors |

## Requirements Addressed

| Requirement | Status | Notes |
|-------------|--------|-------|
| REG-01 (partial) | Done | Key pattern `exchange:{id}:status` defined |
| REG-02 | Done | Full 14-field identity payload schema |
| REG-03 | Done | 6-state ConnectionState with transition map |
| REG-05 | Done | Public IP detection with timeout and null fallback |
| HB-02 | Done | Heartbeat interval (15s) and TTL (45s) constants |

## Next Phase Readiness

Plan 30-02 (InstanceRegistryService) can now import:
- `ConnectionState`, `InstanceStatus`, `InstanceStatusSchema` from `@livermore/schemas`
- `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TTL_SECONDS`, `VALID_TRANSITIONS` from `@livermore/schemas`
- `instanceStatusKey` from `@livermore/cache`
- `detectPublicIp` from local `utils/detect-public-ip`

No blockers. All foundation artifacts are in place.
