---
phase: 35-smart-warmup-engine
plan: 01
subsystem: exchange-core
tags: [warmup, cache, redis, scanner, schedule-builder]
dependency-graph:
  requires: [cache-layer, exchange-core-types]
  provides: [warmup-scanner, warmup-schedule-builder, warmup-types]
  affects: []
tech-stack:
  added: []
  patterns: [redis-scan, schedule-persistence, exchange-scoped-keys]
key-files:
  created:
    - packages/exchange-core/src/warmup/types.ts
    - packages/exchange-core/src/warmup/candle-status-scanner.ts
    - packages/exchange-core/src/warmup/warmup-schedule-builder.ts
    - packages/exchange-core/src/warmup/index.ts
  modified:
    - packages/cache/src/keys.ts
    - packages/exchange-core/src/index.ts
decisions:
  - "SCAN_TIMEFRAME_ORDER: largest to smallest (1d -> 1m) per WARM-01 requirement"
  - "MIN_CANDLE_THRESHOLD: 60 candles determines sufficient vs insufficient"
  - "Schedule persisted as JSON to exchange:<id>:warm-up-schedule:symbols"
  - "Scanner returns all results; builder filters to insufficient pairs only"
metrics:
  duration: 194s
  tasks-completed: 2
  commits: 2
  files-created: 4
  files-modified: 2
  completed: 2026-02-13
---

# Phase 35 Plan 01: Exchange Candle Status Scanner & Warmup Schedule Builder Summary

Built the scan-and-plan half of smart warmup: CandleStatusScanner checks cached candle counts via Redis zcard, WarmupScheduleBuilder filters insufficient pairs and persists schedule to Redis for external observability.

## What Was Built

Created the warmup module in `@livermore/exchange-core` with scanner and schedule builder classes plus supporting types and Redis key builders.

**Core Components:**

1. **CandleStatusScanner** - Scans Redis to check cached candle counts for each symbol/timeframe pair
   - Uses `zcard` on `exchangeCandleKey` to check cached count
   - Scans largest to smallest timeframe (1d -> 1m) per WARM-01 requirement
   - Returns `CandleStatusResult[]` with cached counts and sufficient flag (>= 60 candles)
   - Logs scan start/complete with counts

2. **WarmupScheduleBuilder** - Creates and persists warmup schedule from scan results
   - Filters scan results to only insufficient pairs (< 60 candles)
   - Maps to `WarmupScheduleEntry` with target count (100)
   - Builds `WarmupSchedule` with metadata (counts, timestamp)
   - Persists to Redis at `exchange:<id>:warm-up-schedule:symbols` as JSON
   - Logs persistence with key and counts

3. **Types** - Shared types for scanner, builder, and executor (Plan 02)
   - `CandleStatusResult`: symbol, timeframe, cachedCount, sufficient flag
   - `WarmupScheduleEntry`: symbol, timeframe, cachedCount, targetCount
   - `WarmupSchedule`: exchangeId, createdAt, totalPairs, sufficientPairs, needsFetching, entries[]
   - Constants: `SCAN_TIMEFRAME_ORDER`, `MIN_CANDLE_THRESHOLD` (60), `DEFAULT_CANDLE_TARGET` (100)

4. **Redis Key Builders** - Added to `@livermore/cache`
   - `warmupScheduleKey(exchangeId)`: `exchange:<id>:warm-up-schedule:symbols`
   - `warmupStatsKey(exchangeId)`: `exchange:<id>:warm-up-schedule:stats` (for Plan 02 progress tracking)

**Export Structure:**

- `packages/exchange-core/src/warmup/index.ts` - Re-exports scanner, builder, types
- `packages/exchange-core/src/index.ts` - Re-exports warmup module
- All classes and types accessible from `@livermore/exchange-core`

## Key Decisions

1. **Scan order: Largest to smallest timeframe**
   - `SCAN_TIMEFRAME_ORDER = ['1d', '4h', '1h', '15m', '5m', '1m']`
   - Matches WARM-01 requirement: "check largest to smallest timeframe"

2. **Sufficiency threshold: 60 candles**
   - `MIN_CANDLE_THRESHOLD = 60`
   - Pairs with >= 60 cached candles marked as sufficient and skipped
   - Based on roadmap requirement that 60+ candles = skip REST fetch

3. **Target count: 100 candles**
   - `DEFAULT_CANDLE_TARGET = 100`
   - Insufficient pairs will fetch up to 100 candles (matches backfill default)

4. **Schedule persistence pattern**
   - Store as JSON at `exchange:<id>:warm-up-schedule:symbols`
   - Enables external observability (Admin UI can read schedule before execution starts)
   - Matches roadmap key pattern exactly

5. **Scanner returns all results, builder filters**
   - Scanner provides complete picture (both sufficient and insufficient)
   - Builder filters to only insufficient pairs for schedule
   - Allows caller to see full scan results if needed

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

**Verified:**
- TypeScript compilation passes for both packages
- `warmupScheduleKey(1)` returns `'exchange:1:warm-up-schedule:symbols'`
- `warmupStatsKey(1)` returns `'exchange:1:warm-up-schedule:stats'`
- `SCAN_TIMEFRAME_ORDER` is `['1d', '4h', '1h', '15m', '5m', '1m']`
- `MIN_CANDLE_THRESHOLD` is `60`
- All exports accessible from `@livermore/exchange-core`

**Manual testing (Plan 02 or later):**
- Scanner with real Redis connection and cached candles
- Schedule builder persistence and retrieval
- Admin UI reading schedule before warmup execution

## Next Steps

**Plan 02: Smart Warmup Executor**
- Read schedule from Redis
- Execute fetches in largest-to-smallest order
- Update progress stats to `exchange:<id>:warm-up-schedule:stats`
- Handle rate limiting and errors
- Integrate with existing backfill service

**Plan 03 (if needed): Admin UI integration**
- Read warmup schedule from Redis
- Display symbol/timeframe pairs needing data
- Show real-time progress during warmup execution
- Provide warmup trigger button

## Self-Check: PASSED

**Created files exist:**
```
FOUND: packages/exchange-core/src/warmup/types.ts
FOUND: packages/exchange-core/src/warmup/candle-status-scanner.ts
FOUND: packages/exchange-core/src/warmup/warmup-schedule-builder.ts
FOUND: packages/exchange-core/src/warmup/index.ts
```

**Modified files exist:**
```
FOUND: packages/cache/src/keys.ts
FOUND: packages/exchange-core/src/index.ts
```

**Commits exist:**
```
FOUND: 745ba31 (Task 1: warmup types and Redis key builders)
FOUND: 19eab9f (Task 2: CandleStatusScanner and WarmupScheduleBuilder)
```
