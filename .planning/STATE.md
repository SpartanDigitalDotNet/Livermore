# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Real-time crypto trading analysis and decision support
**Current focus:** v2.0 Data Pipeline Redesign

## Current Position

**Milestone:** v2.0 Data Pipeline Redesign
**Phase:** 06-indicator-refactor (3 of 6) **COMPLETE**
**Plan:** 02 of 2 complete
**Status:** Phase complete
**Last activity:** 2026-01-21 - Corrected approach: direct cache reads instead of aggregation

**Progress:** [########----] 8/12 plans (67%)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | In Progress | - |

See `.planning/MILESTONES.md` for full history.

## Accumulated Context

### Technical Discoveries (from v1.0)

- Coinbase List Orders endpoint uses cursor-based pagination with `has_next` flag
- Fee tier info available via getTransactionSummary() (already implemented)
- Order `total_fees` field contains aggregated fees per order

### 429 Error Investigation (2026-01-20)

**Problem:** 17,309 429 errors found in logs (Jan 15-20). System appears stable but is calculating indicators on stale data when rate limited.

**Root cause confirmed:**
1. WebSocket service builds 1m candles from ticker data
2. On candle close, emits event to indicator service
3. Indicator service calls REST API to fetch candles
4. REST returns 429 -> falls back to cache
5. **Cache doesn't have the WebSocket-built candle** (never saved)
6. Indicator calculated on stale data (missing most recent candle)

**Evidence locations:**
- `apps/api/src/services/coinbase-websocket.service.ts` lines 127-149: `emitCandleClose()` never saves to cache
- `apps/api/src/services/indicator-calculation.service.ts` lines 455-476: fallback reads from cache that's missing the candle
- Logs show pattern: "Recent candle fetch failed for X, using cached data" - thousands of times

**Coinbase sequence number concern:**
- Docs confirm messages CAN arrive out-of-order or be dropped
- Current code has `sequence_num` in types but doesn't validate
- Not addressed by Option A, would need Option B

### Decision: Option A (Minimal Fix) -> INSUFFICIENT

**What:** Add one line to save WebSocket-built candles to cache before emitting event.

**Result (2026-01-21):**
- Cache writes working (candles are fresh)
- 429s still occurring at boundaries (35+ per 4h boundary)
- **Critical finding:** Massive data gaps from dropped/missing ticker messages

**Gap analysis (1m candles):**
| Symbol | Missing | % Gap |
|--------|---------|-------|
| LRDS-USD | 5924 | 93% |
| SYRUP-USD | 222 | 18% |
| BONK-USD | 141 | 12% |
| PENGU-USD | 40 | 4% |

**Root cause:** Building candles from ticker messages. No trade = no ticker = no candle.
Low-liquidity symbols have massive gaps, causing 30+ point MACD-V variance.

**Conclusion:** Option A is insufficient. Proceeding to Option B (v2.0 full redesign).

### Decisions Made (Phase 06)

| ID | Decision | Reason |
|----|----------|--------|
| IND-PATTERN | Redis psubscribe with wildcard pattern for all timeframes | Scales to any number of symbols/timeframes |
| IND-THRESHOLD | 60-candle readiness threshold | TradingView alignment (IND-03) |
| IND-NO-WARMUP | Defer warmup to Phase 07 | Clear separation of concerns |
| IND-NO-AGGREGATION | Fetch each timeframe from cache directly | User preference - REST API provides all timeframes natively |

### Open Items

- v2.0 research completed in `.planning/research/SUMMARY.md` (on hold pending Option A results)
- Sequence number validation now addressed in Phase 05 Plan 03
- node-cron reconciliation planned for Phase 08

## Session Continuity

### Last Session

**Date:** 2026-01-21
**Activity:** Corrected Phase 06 approach - removed aggregation, use direct cache reads
**Stopped At:** Phase 06 COMPLETE, ready for Phase 07

### Resume Context

Phase 06 (Indicator Refactor) COMPLETE. 2 plans delivered:

1. **06-01:** candleClosePattern helper for Redis psubscribe patterns
2. **06-02:** Event-driven IndicatorCalculationService with Redis psubscribe, cache-only reads

**Correction made:** User requested NOT to aggregate 5m candles to higher timeframes.
Instead, higher timeframes are fetched directly from REST API by Phase 07 backfill and
read from cache. Aggregation code was reverted (commit d9c2124).

**Key artifacts:**
- `apps/api/src/services/indicator-calculation.service.ts` - Refactored (406 lines)
  - Subscribes to candle:close for ALL timeframes via wildcard pattern
  - Cache-only reads for all timeframe calculations
  - 60-candle readiness gate
  - checkHigherTimeframes() reads directly from cache (no aggregation)

**Phase 06 Result:**
- Zero REST API calls in indicator hot path for any timeframe
- All timeframes read directly from cache (populated by Phase 07 backfill)
- 60-candle readiness gate applies to all calculation paths

**Phase order:**
1. Phase 04: Foundation (interfaces, base classes) **COMPLETE**
2. Phase 05: Coinbase Adapter (native candles channel) **COMPLETE** (3/3)
3. Phase 06: Indicator Refactor (event-driven, cache-only) **COMPLETE** (2/2)
4. Phase 07: Startup Backfill (parallel with 08)
5. Phase 08: Reconciliation (parallel with 07)
6. Phase 09: Cleanup

**Next:** Execute Phase 07 (Startup Backfill)

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-21 after correcting Phase 06 (no aggregation)*
