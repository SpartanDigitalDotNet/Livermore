---
phase: 08-reconciliation
plan: 03
subsystem: data-pipeline
tags: [server-integration, redis, startup-sequence, event-driven, graceful-shutdown]
dependency_graph:
  requires:
    - 08-01 (BoundaryRestService and boundary detection)
    - 07-02 (Startup orchestration with backfill step)
    - 06-01 (IndicatorCalculationService)
  provides:
    - BoundaryRestService integrated into server startup
    - Separate Redis subscriber connection for psubscribe
    - Graceful shutdown sequence
  affects:
    - Runtime behavior (higher timeframe fetching at boundaries)
tech_stack:
  added: []
  patterns:
    - Separate Redis connection for pub/sub (required by ioredis)
    - Startup ordering for event-driven services
key_files:
  created: []
  modified:
    - apps/api/src/server.ts
decisions:
  - id: RECON-SUBSCRIBER-CONNECTION
    description: Use redis.duplicate() for separate subscriber connection
    reason: ioredis requires separate connection for psubscribe; cannot share with main client
  - id: RECON-STARTUP-ORDER
    description: BoundaryRestService starts after indicators, before WebSocket
    reason: Must be subscribed to 5m candle:close before events start arriving
metrics:
  duration: 3m
  completed: 2026-01-23
---

# Phase 08 Plan 03: BoundaryRestService Server Integration Summary

**One-liner:** BoundaryRestService integrated into server startup sequence with separate Redis subscriber connection and graceful shutdown handling.

## What Was Built

### Task 1: Export reconciliation module from coinbase-client

**Status:** Already complete from 08-01

The reconciliation module exports were already added to `@livermore/coinbase-client` during plan 08-01:
- `BoundaryRestService` class
- `DEFAULT_BOUNDARY_CONFIG` constant
- `detectBoundaries`, `isTimeframeBoundary` functions
- `BoundaryRestConfig`, `TimeframeBoundary` types

No additional work needed.

### Task 2: Integrate BoundaryRestService into server.ts

Integrated the event-driven boundary REST service into the server startup:

**Changes made:**

1. **Import statement** (line 9):
   ```typescript
   import { BoundaryRestService, DEFAULT_BOUNDARY_CONFIG } from '@livermore/coinbase-client';
   ```

2. **Separate Redis subscriber connection** (line 169):
   ```typescript
   const subscriberRedis = redis.duplicate();
   ```
   Required because ioredis cannot mix regular commands with psubscribe on the same connection.

3. **BoundaryRestService instantiation and startup** (lines 247-261):
   ```typescript
   const boundaryRestService = new BoundaryRestService(
     config.Coinbase_ApiKeyId,
     config.Coinbase_EcPrivateKeyPem,
     redis,
     subscriberRedis,
     {
       userId: DEFAULT_BOUNDARY_CONFIG.userId,
       exchangeId: DEFAULT_BOUNDARY_CONFIG.exchangeId,
       higherTimeframes: ['15m', '1h', '4h', '1d'],
     }
   );
   await boundaryRestService.start(monitoredSymbols);
   ```

4. **Updated startup sequence:**
   - Step 1: Backfill (populate cache)
   - Step 2: Indicators (start listening for candle:close)
   - Step 3: BoundaryRestService (start listening for 5m boundaries)
   - Step 4: WebSocket (start producing candle:close events)

5. **Graceful shutdown** (lines 300-307):
   ```typescript
   coinbaseWsService.stop();
   await boundaryRestService.stop();
   await indicatorService.stop();
   await subscriberRedis.quit();
   ```
   Services stopped in reverse startup order.

## Code Changes

### Files Modified
- `apps/api/src/server.ts` - BoundaryRestService integration

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 2f41db1 | feat | Integrate BoundaryRestService into server startup |

## Deviations from Plan

### Plan Discrepancy: Non-existent Exports

**Task 1 discrepancy:** Plan referenced exports that don't exist (`detectGaps`, `detectGapsForSymbol`, `getTimestampsOnly`, `GapInfo`). These appear to be from a future or alternate plan.

**Resolution:** Task 1 was already complete from 08-01 with the actual existing exports. No changes needed.

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compiles (coinbase-client) | PASS |
| TypeScript compiles (apps/api) | PASS |
| BoundaryRestService importable | PASS |
| boundaryRestService.start() called | PASS (line 260) |
| Separate Redis subscriber connection | PASS (line 169) |
| boundaryRestService.stop() in shutdown | PASS (line 303) |
| No node-cron references | PASS |
| No setInterval references | PASS |

## Architecture Alignment

This integration satisfies all hard constraints:

| Constraint | How Satisfied |
|------------|---------------|
| NO cron jobs | Event-driven via WebSocket candle close |
| NO aggregation | Each timeframe fetched directly from Coinbase REST |
| BoundaryRestService starts after backfill and indicators | Startup order: Backfill -> Indicators -> BoundaryRestService -> WebSocket |

## Startup Sequence Diagram

```
Server Start
    |
    v
[Step 1: Backfill] --> Cache populated with 60+ candles per symbol/timeframe
    |
    v
[Step 2: Indicators] --> Subscribed to candle:close events
    |
    v
[Step 3: BoundaryRestService] --> Subscribed to 5m candle:close via separate Redis connection
    |
    v
[Step 4: WebSocket] --> Starts producing candle:close events
    |
    v
Server Running
```

## Next Phase Readiness

**Ready for:** Phase 08 complete (3/3 plans)

**Phase 08 deliverables:**
1. 08-01: Boundary detection and BoundaryRestService
2. 08-02: Gap detection utilities (for debugging/monitoring)
3. 08-03: Server integration (this plan)

**No blockers identified.**
