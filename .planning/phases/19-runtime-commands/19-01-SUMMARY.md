---
phase: 19-runtime-commands
plan: 01
title: Service Registry & Constructor Update
subsystem: control-channel
tags: [dependency-injection, service-registry, typescript]
dependency-graph:
  requires: [18-02, 18-03]
  provides: [ServiceRegistry-interface, control-channel-service-injection]
  affects: [19-02, 19-03]
tech-stack:
  added: []
  patterns: [service-registry, constructor-injection]
key-files:
  created:
    - apps/api/src/services/types/service-registry.ts
  modified:
    - apps/api/src/services/control-channel.service.ts
decisions:
  - id: SREG-01
    title: Optional services parameter
    choice: "Constructor accepts optional ServiceRegistry for backward compatibility"
    rationale: "server.ts continues to work until Plan 02 injects services"
metrics:
  duration: 8m
  completed: 2026-01-31
---

# Phase 19 Plan 01: Service Registry & Constructor Update Summary

ServiceRegistry interface enabling typed service injection into ControlChannelService, with constructor update supporting pause/resume state tracking.

## What Was Built

### ServiceRegistry Interface

Created `apps/api/src/services/types/service-registry.ts` defining:

1. **RuntimeConfig interface** - API credentials for operations requiring Coinbase access
   - `apiKeyId: string`
   - `privateKeyPem: string`

2. **ServiceRegistry interface** - Typed access to all services:
   - `coinbaseAdapter: CoinbaseAdapter` - WebSocket for real-time data
   - `indicatorService: IndicatorCalculationService` - MACD-V calculation
   - `alertService: AlertEvaluationService` - Alert monitoring
   - `boundaryRestService: BoundaryRestService` - Higher timeframe fetching
   - `redis: Redis` - Cache operations
   - `db: Database` - Settings/query access
   - `config: RuntimeConfig` - Credentials for backfill

### ControlChannelService Updates

Modified constructor to accept optional services parameter:

```typescript
constructor(identitySub: string, services?: ServiceRegistry)
```

Added state tracking:
- `private services: ServiceRegistry | null` - Stores injected services
- `private isPaused = false` - Pause/resume state (RUN-04, RUN-05)
- `get paused(): boolean` - External state inspection
- `get hasServices(): boolean` - Check if services available

## Architecture Notes

**Backward Compatibility:** The `services` parameter is optional, so `server.ts` continues to work without changes until Plan 02 injects the actual services.

**Service Lifecycle:** Services are references, not recreated on resume. Existing `start()`/`stop()` methods are called, not new instances created.

**Type Safety:** ServiceRegistry provides compile-time type checking for all service interactions.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | ServiceRegistry interface | 2e0c8b4 |
| 2 | Constructor update with isPaused state | ee62597 |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

| Check | Status |
|-------|--------|
| service-registry.ts exists | PASS |
| TypeScript compiles | PASS |
| ServiceRegistry exports RuntimeConfig and ServiceRegistry | PASS |
| Constructor accepts optional ServiceRegistry | PASS |
| Backward compatible (server.ts unchanged) | PASS |

## Next Phase Readiness

**Ready for 19-02:** ServiceRegistry interface is available for import, and ControlChannelService constructor accepts it. Plan 02 will:
1. Update `server.ts` to build and inject ServiceRegistry
2. Implement actual command handlers in `executeCommand()`

No blockers identified.
