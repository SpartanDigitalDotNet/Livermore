# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Real-time crypto trading analysis and decision support
**Current focus:** v2.0 Data Pipeline Redesign

## Current Position

**Milestone:** v2.0 Data Pipeline Redesign
**Phase:** 07-startup-backfill (4 of 6) **COMPLETE**
**Plan:** 02 of 2 complete
**Status:** Phase complete
**Last activity:** 2026-01-21 - Completed 07-02-PLAN.md (Server Integration)

**Progress:** [##########--] 10/12 plans (83%)

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

### Decisions Made (Phase 07)

| ID | Decision | Reason |
|----|----------|--------|
| BKFL-RATE | 5 requests per batch with 1s delay (5 req/sec) | Conservative rate limiting - 6x safety margin under Coinbase's 30 req/sec limit |
| BKFL-PRIORITY | 5m, 15m, 1h, 4h, 1d priority order (no 1m) | 5m first since WebSocket provides it, enables indicator calculations sooner |
| STARTUP-ORDER | Backfill -> Indicators -> WebSocket startup ordering | Ensures indicators have 60+ candles in cache before processing candle:close events |

### Open Items

- v2.0 research completed in `.planning/research/SUMMARY.md` (on hold pending Option A results)
- Sequence number validation now addressed in Phase 05 Plan 03
- node-cron reconciliation planned for Phase 08

## Session Continuity

### Last Session

**Date:** 2026-01-21
**Activity:** Completed Phase 07 Plan 02 - Server Integration
**Stopped At:** Phase 07 COMPLETE, ready for Phase 08

### Resume Context

Phase 07 (Startup Backfill) COMPLETE. 2 of 2 plans delivered:

1. **07-01:** StartupBackfillService with priority-ordered timeframes and rate-limited batch processing
2. **07-02:** Server integration with correct startup ordering (backfill -> indicators -> WebSocket)

**Key artifacts:**
- `packages/coinbase-client/src/backfill/` - BackfillConfig, StartupBackfillService, TIMEFRAME_PRIORITY
- `packages/coinbase-client/src/index.ts` - Exports StartupBackfillService
- `apps/api/src/server.ts` - Startup orchestration with backfill step

**Phase 07 Result:**
- Server startup runs backfill BEFORE starting indicator service
- All symbols have 60+ candles in cache before indicators start
- Backfill uses 5m, 15m, 1h, 4h, 1d timeframes (no 1m since WebSocket provides it)
- Rate limiting: 5 requests/batch, 1s delay between batches
- Progress logging with completion %, elapsed time, ETA

**Phase order:**
1. Phase 04: Foundation (interfaces, base classes) **COMPLETE**
2. Phase 05: Coinbase Adapter (native candles channel) **COMPLETE** (3/3)
3. Phase 06: Indicator Refactor (event-driven, cache-only) **COMPLETE** (2/2)
4. Phase 07: Startup Backfill **COMPLETE** (2/2)
5. Phase 08: Reconciliation (parallel with 07)
6. Phase 09: Cleanup

**Next:** Execute Phase 08 (Reconciliation)

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-21 after completing Phase 07 Plan 02*
