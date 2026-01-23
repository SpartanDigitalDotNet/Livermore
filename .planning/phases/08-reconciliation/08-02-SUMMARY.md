---
phase: 08-reconciliation
plan: 02
subsystem: data-pipeline
tags: [gap-detection, cache, redis, pure-functions]
dependency_graph:
  requires:
    - 08-01 (BoundaryRestService and boundary detection)
    - 06-01 (CandleCacheStrategy with sorted set storage)
  provides:
    - detectGaps() for identifying missing candles in cache
    - detectGapsForSymbol() convenience function
    - getTimestampsOnly() for efficient Redis score extraction
    - GapInfo type for gap metadata
  affects:
    - 08-03 (Optional gap-filling integration)
    - Future reconciliation workflows
tech_stack:
  added: []
  patterns:
    - Pure function gap detection (no side effects)
    - Set-based timestamp comparison for O(n) performance
    - Redis WITHSCORES for efficient timestamp extraction
key_files:
  created:
    - packages/coinbase-client/src/reconciliation/gap-detector.ts
  modified:
    - packages/coinbase-client/src/reconciliation/types.ts
    - packages/coinbase-client/src/reconciliation/index.ts
    - packages/coinbase-client/src/index.ts
decisions:
  - id: GAP-PURE-FUNCTIONS
    description: Gap detection as pure functions rather than service class
    reason: Enables flexible composition and easy testing
metrics:
  duration: 8m
  completed: 2026-01-23
---

# Phase 08 Plan 02: Gap Detection Summary

**One-liner:** Pure functions for detecting missing candles in cache by comparing cached timestamps against expected sequence, with efficient Redis WITHSCORES extraction.

## What Was Built

### Task 1: Add GapInfo Type

Added `GapInfo` interface to types.ts:

```typescript
interface GapInfo {
  symbol: string;
  timeframe: Timeframe;
  start: number;     // First missing candle timestamp
  end: number;       // Last missing candle timestamp
  count: number;     // Number of missing candles
}
```

### Task 2: Create Gap Detector

Created `gap-detector.ts` with three functions:

**`getTimestampsOnly(redis, key, start, end)`**
- Efficiently extracts timestamps from Redis sorted set using WITHSCORES
- Returns only scores (timestamps), not the full candle data
- Useful for gap detection without deserializing candle JSON

**`detectGaps(cachedTimestamps, expectedStart, expectedEnd, timeframe, symbol)`**
- Pure function - no side effects, no Redis calls
- Compares cached timestamps (as Set) against expected sequence
- Returns array of GapInfo for each contiguous gap
- Handles edge cases: empty arrays, single elements, trailing gaps

**`detectGapsForSymbol(redis, userId, exchangeId, symbol, timeframe, lookbackMs)`**
- Convenience function combining Redis query with gap detection
- Floors timestamps to candle boundaries automatically
- Builds cache key using candleKey() pattern

### Task 3: Update Exports

Added gap detector exports to both module and package index:
- `detectGaps`, `detectGapsForSymbol`, `getTimestampsOnly` functions
- `GapInfo` type

## Code Changes

### Files Created
- `packages/coinbase-client/src/reconciliation/gap-detector.ts` (130 lines)

### Files Modified
- `packages/coinbase-client/src/reconciliation/types.ts` (+16 lines)
- `packages/coinbase-client/src/reconciliation/index.ts` (+3 lines)
- `packages/coinbase-client/src/index.ts` (+2 lines)

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 92a05ed | feat | Add GapInfo type for gap detection |
| 24b306d | feat | Add gap detection for cached candle sequences |
| b74ce71 | feat | Export gap detector from reconciliation module |

## Deviations from Plan

**[Rule 1 - Bug] Removed unused variable**
- Found during: Task 2 verification
- Issue: Plan included `intervalMs` variable that wasn't used in `detectGapsForSymbol`
- Fix: Removed the unused variable to satisfy TypeScript noUnusedLocals
- Files modified: gap-detector.ts
- Commit: 24b306d (included in same commit)

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compiles | PASS |
| GapInfo type exported | PASS |
| detectGaps exported | PASS |
| getTimestampsOnly exported | PASS |
| No node-cron references | PASS |
| No setInterval references | PASS |

## Algorithm Notes

The gap detection algorithm:
1. Convert cached timestamps to Set for O(1) lookup
2. Iterate through expected timestamps (start to end, step by interval)
3. For each missing timestamp, either start a new gap or extend current
4. When finding a cached timestamp after a gap, record the gap
5. Handle trailing gaps that extend to end of range

Example:
```
Expected: [0, 5m, 10m, 15m, 20m, 25m]
Cached:   [0, 5m,      15m,      25m]
Gaps:     [{start: 10m, end: 10m, count: 1}, {start: 20m, end: 20m, count: 1}]
```

## Critical Constraints Satisfied

| Constraint | How Satisfied |
|------------|---------------|
| NO cron jobs | Pure functions, no scheduling |
| NO aggregation | Detection only, no data transformation |
| Gap detection for future use | Functions ready but not wired into reconciliation flow |

## Next Phase Readiness

**Ready for:** 08-03 (Final integration) or future gap-filling implementation

**Dependencies satisfied:**
- Gap detection functions exported from @livermore/coinbase-client
- Pure functions can be composed with BoundaryRestService if needed
- GapInfo type provides structured gap metadata

**Note:** Per critical constraints, gap detection is for future use - not currently integrated into the reconciliation flow. The 08-03 plan will handle final integration testing.
