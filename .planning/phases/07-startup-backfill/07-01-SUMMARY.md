---
phase: 07-startup-backfill
plan: 01
subsystem: data-pipeline
tags: [backfill, rest-api, rate-limiting, cache]

dependency-graph:
  requires: [06-indicator-refactor]
  provides: [StartupBackfillService, TIMEFRAME_PRIORITY]
  affects: [07-02, 08-reconciliation]

tech-stack:
  added: []
  patterns: [batch-rate-limiting, priority-queue]

key-files:
  created:
    - packages/coinbase-client/src/backfill/types.ts
    - packages/coinbase-client/src/backfill/startup-backfill-service.ts
    - packages/coinbase-client/src/backfill/index.ts
  modified: []

decisions:
  - id: BKFL-RATE
    description: "5 requests per batch with 1s delay (5 req/sec)"
    reason: "Conservative rate limiting - 6x safety margin under Coinbase's 30 req/sec limit"
  - id: BKFL-PRIORITY
    description: "5m, 15m, 1h, 4h, 1d priority order (no 1m)"
    reason: "5m first since WebSocket provides it, enables indicator calculations sooner"

metrics:
  duration: 3m
  completed: 2026-01-21
---

# Phase 07 Plan 01: Startup Backfill Service Summary

**One-liner:** StartupBackfillService with priority-ordered timeframes and rate-limited batch processing for historical candle backfill.

## What Was Built

### New Files

**packages/coinbase-client/src/backfill/types.ts**
- `BackfillConfig` interface with candleCount, batchSize, batchDelayMs, userId, exchangeId
- `DEFAULT_BACKFILL_CONFIG` constant with conservative defaults (5 req/batch, 1s delay)
- `TIMEFRAME_PRIORITY` array: ['5m', '15m', '1h', '4h', '1d']

**packages/coinbase-client/src/backfill/startup-backfill-service.ts**
- `StartupBackfillService` class for populating Redis cache at startup
- `backfill(symbols, timeframes)` public method - main entry point
- Priority-ordered timeframe processing (5m first per BKFL-03)
- Batched execution with Promise.allSettled for graceful error handling
- Progress logging with completion %, elapsed time, and ETA (BKFL-04)
- Uses CoinbaseRestClient.getCandles() and CandleCacheStrategy.addCandles()

**packages/coinbase-client/src/backfill/index.ts**
- Re-exports all public API from backfill module

## Key Links Verified

| From | To | Pattern |
|------|----|---------|
| startup-backfill-service.ts | CoinbaseRestClient.getCandles() | `restClient.getCandles(symbol, timeframe)` |
| startup-backfill-service.ts | CandleCacheStrategy.addCandles() | `candleCache.addCandles(userId, exchangeId, candles)` |

## Decisions Made

| ID | Decision | Reason |
|----|----------|--------|
| BKFL-RATE | 5 req/batch, 1s delay | Conservative - 6x safety margin under 30 req/sec limit |
| BKFL-PRIORITY | 5m, 15m, 1h, 4h, 1d (no 1m) | 5m first since WebSocket provides it; research specifies these timeframes |

## Deviations from Plan

None - plan executed exactly as written.

## Testing Status

- TypeScript compilation: PASS
- All files created: PASS
- Exports verified: PASS
- Key links verified: PASS

No runtime tests - service integration tested in Plan 02.

## Commits

| Hash | Description |
|------|-------------|
| 9127938 | feat(07-01): add backfill types and configuration |
| a0afc25 | feat(07-01): implement StartupBackfillService class |
| 44564f8 | feat(07-01): create backfill module index with re-exports |

## Next Phase Readiness

**Ready for Plan 02:** Server integration

**Dependencies for Plan 02:**
- StartupBackfillService exported and ready for import
- Needs to be added to packages/coinbase-client/src/index.ts (Plan 02)
- Needs server.ts integration to call backfill() at startup (Plan 02)

**No blockers identified.**
