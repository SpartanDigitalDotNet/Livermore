---
phase: 34-ticker-key-migration
plan: 01
subsystem: cache
tags: [redis, cache-keys, ticker, exchange-scoped, refactor]

# Dependency graph
requires:
  - phase: 20-exchange-scoped-data
    provides: "Exchange-scoped key pattern (candles/indicators migrated in v5.0)"
provides:
  - "Exchange-scoped tickerKey() and tickerChannel() functions"
  - "TickerCacheStrategy with exchange-scoped method signatures"
  - "Impact assessment documenting all ticker key consumers"
affects: [34-02, binance-adapter, smart-warmup]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Exchange-scoped ticker keys: ticker:{exchangeId}:{symbol}"]

key-files:
  created:
    - ".planning/phases/34-ticker-key-migration/TICK-01-IMPACT-ASSESSMENT.md"
  modified:
    - "packages/cache/src/keys.ts"
    - "packages/cache/src/strategies/ticker-cache.ts"

key-decisions:
  - "Moved tickerKey/tickerChannel to TIER 1 section (exchange-scoped) from LEGACY"
  - "Exchange-scoped ticker pattern aligns with inline strings already in server.ts and control-channel.service.ts"

patterns-established:
  - "All cache keys now follow exchange-scoped pattern: {type}:{exchangeId}:{symbol}"

# Metrics
duration: 2min
completed: 2026-02-13
---

# Phase 34 Plan 01: Ticker Key Migration - Impact Assessment & Cache Layer Summary

**Exchange-scoped ticker keys and channels in cache package, removing userId from tickerKey/tickerChannel and all 6 TickerCacheStrategy methods**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T12:32:58Z
- **Completed:** 2026-02-13T12:35:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created comprehensive impact assessment documenting all 9 files that read/write ticker keys or subscribe to ticker channels
- Migrated tickerKey() from `ticker:{userId}:{exchangeId}:{symbol}` to `ticker:{exchangeId}:{symbol}`
- Migrated tickerChannel() from `channel:ticker:{userId}:{exchangeId}:{symbol}` to `channel:ticker:{exchangeId}:{symbol}`
- Removed userId parameter from all 6 TickerCacheStrategy methods (setTicker, getTicker, getTickers, publishUpdate, deleteTicker, hasTicker)
- Moved tickerKey/tickerChannel from LEGACY section to TIER 1 (exchange-scoped) in keys.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create TICK-01 Impact Assessment** - `cc8be34` (docs)
2. **Task 2: Migrate tickerKey, tickerChannel, TickerCacheStrategy to exchange-scoped** - `ad0367d` (feat)

## Files Created/Modified
- `.planning/phases/34-ticker-key-migration/TICK-01-IMPACT-ASSESSMENT.md` - Impact assessment cataloging all 9 affected files
- `packages/cache/src/keys.ts` - tickerKey() and tickerChannel() now exchange-scoped in TIER 1 section
- `packages/cache/src/strategies/ticker-cache.ts` - All 6 methods no longer require userId parameter

## Decisions Made
- Moved tickerKey/tickerChannel to TIER 1 section rather than keeping in LEGACY -- these are now the canonical exchange-scoped functions, not deprecated
- Exchange-scoped ticker pattern matches what server.ts and control-channel.service.ts already use inline, confirming correctness

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Cache package compiles cleanly with new signatures
- Full project will NOT compile until Plan 02 updates the 5 consumer call sites (coinbase-adapter, coinbase-websocket.service, indicator.router, position-sync.service, alert-evaluation.service)
- Plan 02 (34-02-PLAN.md) is ready to execute immediately

## Self-Check: PASSED

- All 4 files verified present on disk
- Commit cc8be34 (Task 1) verified in git log
- Commit ad0367d (Task 2) verified in git log

---
*Phase: 34-ticker-key-migration*
*Completed: 2026-02-13*
