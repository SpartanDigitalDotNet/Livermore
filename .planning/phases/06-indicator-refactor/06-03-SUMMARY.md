---
phase: 06-indicator-refactor
plan: 03
subsystem: indicator-calculation
tags: [candle-aggregation, higher-timeframe, cache-only, no-rest]

dependency-graph:
  requires: [06-01, 06-02]
  provides: [higher-timeframe-aggregation, unified-cache-source]
  affects: [07-startup-backfill]

tech-stack:
  added: []
  patterns: [5m-to-higher-aggregation, cache-only-indicators, aggregation-factors]

key-files:
  created: []
  modified:
    - apps/api/src/services/indicator-calculation.service.ts

decisions:
  - id: IND-AGG-FACTORS
    choice: "AGGREGATION_FACTORS constant with Partial<Record<Timeframe, number>>"
    reason: "TypeScript type safety while only defining used timeframes"
  - id: IND-AGG-OVERFETCH
    choice: "Fetch (requiredCount + 1) * factor 5m candles"
    reason: "Ensures enough complete periods after aggregation filtering"

metrics:
  duration: "5m"
  completed: 2026-01-21
---

# Phase 06 Plan 03: Higher Timeframe Integration Summary

Higher timeframe indicators (15m, 1h, 4h, 1d) now calculated from aggregated 5m candles via in-memory aggregation, eliminating all REST API calls for candle data.

## What Was Delivered

### Task 1: Aggregation Import and Methods (505f2eb)

**Added:**
- Import `aggregateCandles` from `@livermore/utils`
- `AGGREGATION_FACTORS` constant: `{ '5m': 1, '15m': 3, '1h': 12, '4h': 48, '1d': 288 }`
- `getAggregatedCandles()` method: Reads 5m candles from cache, aggregates to target timeframe
- `recalculateFromAggregated()` method: Higher timeframe calculation path with readiness gate

**Changed:**
- `checkHigherTimeframes()` now calls `recalculateFromAggregated()` instead of `recalculateFromCache()`

### Task 2: Higher Timeframe Flow (Included in Task 1)

The higher timeframe calculation flow is now:
1. 5m candle close event triggers `handleCandleCloseEvent()`
2. `recalculateFromCache()` handles 5m directly (cache read)
3. `checkHigherTimeframes()` detects boundary crossings for 15m/1h/4h/1d
4. `recalculateFromAggregated()` builds candles from cached 5m data via `aggregateCandles()`
5. `calculateIndicators()` receives aggregated candles with correct timeframe metadata

### Task 3: Integration Logging (6637567)

**Added:**
- Updated class JSDoc with v2.0 architecture documentation
- `indicator_calculation_start` log event with `source` field
- `source` field added to `indicator_cached` log event
- Values: `"cache_direct"` (5m) or `"aggregated_5m"` (higher timeframes)

## Key Implementation Details

### Aggregation Method

```typescript
private async getAggregatedCandles(
  symbol: string,
  targetTimeframe: Timeframe,
  requiredCount: number
): Promise<Candle[]> {
  // For 5m, just read directly from cache
  if (targetTimeframe === '5m') {
    return this.candleCache.getRecentCandles(...);
  }

  const factor = this.AGGREGATION_FACTORS[targetTimeframe] || 1;
  const sourceCount = (requiredCount + 1) * factor;

  const sourceCandles = await this.candleCache.getRecentCandles(
    this.TEST_USER_ID, this.TEST_EXCHANGE_ID, symbol, '5m', sourceCount
  );

  return aggregateCandles(sourceCandles, '5m', targetTimeframe);
}
```

### Source Logging

```typescript
const isAggregated = timeframe !== '5m';
logger.debug({
  event: 'indicator_calculation_start',
  symbol,
  timeframe,
  candleCount: candles.length,
  source: isAggregated ? 'aggregated_5m' : 'cache_direct',
}, `Calculating ${symbol} ${timeframe} from ${isAggregated ? 'aggregated' : 'cached'} candles`);
```

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `apps/api/src/services/indicator-calculation.service.ts` | 513 (+102) | Added aggregation integration |

## Verification Results

- Full workspace build: PASS
- No REST calls in indicator hot path: PASS (0 occurrences of restClient/fetch*)
- Higher timeframes from aggregated 5m: PASS
- Source logging present: PASS (2 locations)
- 60-candle readiness gate: PASS (applies to both paths)

## Deviations from Plan

### Task 2 Merged into Task 1

**Reason:** The `checkHigherTimeframes()` update to call `recalculateFromAggregated()` was logically part of Task 1's scope since all the new methods were added together. No separate commit was needed.

**Impact:** 2 commits instead of 3. No functional difference.

## Phase 06 Complete

With Plan 03 complete, Phase 06 (Indicator Refactor) delivers:

| Plan | Deliverable |
|------|-------------|
| 06-01 | `aggregateCandles()` utility in @livermore/utils |
| 06-02 | Event-driven IndicatorCalculationService with Redis psubscribe |
| 06-03 | Higher timeframe integration via 5m aggregation |

**Result:** Indicator service now operates completely from cache. Zero REST API calls in the hot path for any timeframe.

## Next Phase Readiness

Phase 07 (Startup Backfill) can now:
1. Use REST API to fetch historical 5m candles at startup
2. Populate cache with sufficient candles (60+ per timeframe boundary)
3. Indicator service will automatically calculate when cache has enough data

**Dependencies satisfied:**
- CACHE-03: Zero REST calls for candle data in normal operation
- IND-04: Higher timeframes from aggregated 5m cache data
- IND-03: 60-candle readiness gate for all timeframes

---
*Phase: 06-indicator-refactor*
*Completed: 2026-01-21*
