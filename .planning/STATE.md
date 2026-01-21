# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Real-time crypto trading analysis and decision support
**Current focus:** v2.0 Data Pipeline Redesign

## Current Position

**Milestone:** v2.0 Data Pipeline Redesign
**Phase:** 04-foundation (1 of 6) **COMPLETE**
**Plan:** 03 of 3 complete
**Status:** Phase 04 complete, ready for Phase 05
**Last activity:** 2026-01-21 — Completed 04-03-PLAN.md (Base Adapter Class)

**Progress:** [###-------] 3/18 plans (17%)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | In Progress | — |

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
4. REST returns 429 → falls back to cache
5. **Cache doesn't have the WebSocket-built candle** (never saved)
6. Indicator calculated on stale data (missing most recent candle)

**Evidence locations:**
- `apps/api/src/services/coinbase-websocket.service.ts` lines 127-149: `emitCandleClose()` never saves to cache
- `apps/api/src/services/indicator-calculation.service.ts` lines 455-476: fallback reads from cache that's missing the candle
- Logs show pattern: "Recent candle fetch failed for X, using cached data" — thousands of times

**Coinbase sequence number concern:**
- Docs confirm messages CAN arrive out-of-order or be dropped
- Current code has `sequence_num` in types but doesn't validate
- Not addressed by Option A, would need Option B

### Decision: Option A (Minimal Fix) → INSUFFICIENT

**What:** Add one line to save WebSocket-built candles to cache before emitting event.

**Result (2026-01-21):**
- Cache writes working ✓ (candles are fresh)
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

### Open Items

- v2.0 research completed in `.planning/research/SUMMARY.md` (on hold pending Option A results)
- Sequence number validation not addressed (Option B scope)
- node-cron reconciliation not needed if Option A works

## Session Continuity

### Last Session

**Date:** 2026-01-21
**Activity:** Executed 04-03-PLAN.md - Base Adapter Class
**Stopped At:** Completed Phase 04 (Foundation), ready for Phase 05

### Resume Context

Phase 04 (Foundation) COMPLETE. All 3 plans delivered:

1. **04-01:** UnifiedCandle schema, ExchangeAdapterEvents, IExchangeAdapter interface
2. **04-02:** candleCloseChannel() pub/sub, addCandleIfNewer() versioned writes
3. **04-03:** BaseExchangeAdapter abstract class with reconnection logic

**Key artifacts:**
- `packages/schemas/src/adapter/exchange-adapter.schema.ts` — interfaces and schemas
- `packages/cache/src/keys.ts` — candleCloseChannel function
- `packages/cache/src/strategies/candle-cache.ts` — addCandleIfNewer method
- `packages/coinbase-client/src/adapter/base-adapter.ts` — BaseExchangeAdapter class

**Phase order:**
1. Phase 04: Foundation (interfaces, base classes) **COMPLETE**
2. Phase 05: Coinbase Adapter (native candles channel)
3. Phase 06: Indicator Refactor (event-driven, cache-only)
4. Phase 07: Startup Backfill (parallel with 08)
5. Phase 08: Reconciliation (parallel with 07)
6. Phase 09: Cleanup

**Next:** Execute 05-01-PLAN.md (Coinbase Candle Adapter)

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-21 after completing 04-03-PLAN.md (Phase 04 complete)*
