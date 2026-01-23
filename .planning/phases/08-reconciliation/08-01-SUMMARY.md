---
phase: 08-reconciliation
plan: 01
subsystem: data-pipeline
tags: [websocket, rest-api, rate-limiting, event-driven, boundary-detection]
dependency_graph:
  requires:
    - 07-02 (Startup orchestration with backfill step)
    - 05-01 (CoinbaseAdapter with WebSocket candle:close events)
    - 06-01 (CandleCacheStrategy with addCandleIfNewer)
  provides:
    - BoundaryRestService for higher timeframe candle fetching
    - detectBoundaries() for timeframe boundary alignment
    - Event-driven reconciliation pattern (no cron)
  affects:
    - 08-02 (Integration of BoundaryRestService into server startup)
    - 08-03 (Reconciliation integration tests)
tech_stack:
  added: []
  patterns:
    - Event-driven boundary detection via WebSocket candle close
    - Rate-limited REST batching (5 req/batch, 1s delay)
    - Redis psubscribe pattern for multi-symbol events
key_files:
  created:
    - packages/coinbase-client/src/reconciliation/types.ts
    - packages/coinbase-client/src/reconciliation/boundary-detector.ts
    - packages/coinbase-client/src/reconciliation/boundary-rest-service.ts
    - packages/coinbase-client/src/reconciliation/index.ts
  modified:
    - packages/coinbase-client/src/index.ts
decisions:
  - id: RECON-BOUNDARY-DETECTION
    description: Use timestamp modulo operation for boundary detection
    reason: Pure, testable, no external dependencies
metrics:
  duration: 5m
  completed: 2026-01-23
---

# Phase 08 Plan 01: Boundary Detection and REST Service Summary

**One-liner:** Event-driven BoundaryRestService that subscribes to 5m candle:close events and fires rate-limited REST calls at higher timeframe boundaries (15m, 1h, 4h, 1d).

## What Was Built

### Task 1: Reconciliation Types and Boundary Detector

Created the foundation for event-driven boundary detection:

**`types.ts`:**
- `BoundaryRestConfig` interface with rate limiting settings (batchSize, batchDelayMs)
- `DEFAULT_BOUNDARY_CONFIG` matching StartupBackfillService pattern (5 req/batch, 1s delay)
- `TimeframeBoundary` interface for detection results

**`boundary-detector.ts`:**
- `isTimeframeBoundary(timestamp, timeframe)` - checks if timestamp aligns with timeframe boundary using modulo operation
- `detectBoundaries(timestamp, timeframes)` - returns array of TimeframeBoundary with triggered flags

Boundary alignment logic (all times UTC):
- 15m: 00, 15, 30, 45 minutes
- 1h: 00 minutes
- 4h: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00
- 1d: 00:00

### Task 2: BoundaryRestService

Created the main service that orchestrates boundary-triggered REST fetching:

**Key features:**
- Subscribes to 5m `candle:close` events using Redis psubscribe pattern
- Detects boundary alignment when 5m candle closes
- Fires rate-limited REST calls for ALL symbols at triggered timeframes
- Caches results using `addCandleIfNewer()` for versioned writes

**Rate limiting pattern (same as StartupBackfillService):**
- 5 requests per batch
- 1 second delay between batches
- Well under Coinbase's 30 req/sec limit

**Expected traffic for 100 symbols:**
- ~12,700 REST calls/day (~8.8 calls/minute average)

## Code Changes

### Files Created
- `packages/coinbase-client/src/reconciliation/types.ts` - Config interfaces and defaults
- `packages/coinbase-client/src/reconciliation/boundary-detector.ts` - Pure detection functions
- `packages/coinbase-client/src/reconciliation/boundary-rest-service.ts` - Main service class
- `packages/coinbase-client/src/reconciliation/index.ts` - Module exports

### Files Modified
- `packages/coinbase-client/src/index.ts` - Added reconciliation module exports

## Commits

| Hash | Type | Description |
|------|------|-------------|
| a748668 | feat | Add reconciliation types and boundary detector |
| 105a985 | feat | Add BoundaryRestService for event-driven higher timeframe fetching |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compiles | PASS |
| detectBoundaries exported | PASS |
| isTimeframeBoundary exported | PASS |
| BoundaryRestService uses psubscribe | PASS |
| No node-cron references | PASS |
| No setInterval references | PASS |

## Architecture Alignment

This implementation satisfies all hard constraints:

| Constraint | How Satisfied |
|------------|---------------|
| NO cron jobs | Event-driven via WebSocket candle close |
| NO aggregation | Each timeframe fetched directly from Coinbase REST |
| Zero 429 errors | Rate limiting: 5 req/batch, 1s delay |

## Next Phase Readiness

**Ready for:** 08-02 (Integration into server startup)

**Dependencies satisfied:**
- BoundaryRestService class exported from @livermore/coinbase-client
- detectBoundaries() available for testing
- Rate limiting pattern proven in StartupBackfillService

**No blockers identified.**
