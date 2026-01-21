# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Real-time crypto trading analysis and decision support
**Current focus:** Testing Option A fix for 429/stale data issue

## Current Position

**Milestone:** v2.0 Data Pipeline Redesign (planning paused)
**Status:** Testing minimal fix before full redesign
**Last activity:** 2026-01-20 — Implemented Option A fix

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Planning paused | — |

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

### Decision: Option A (Minimal Fix)

**What:** Add one line to save WebSocket-built candles to cache before emitting event.

**Why:** Low risk, quick test. If 429s still cause stale data issues, we proceed to Option B (full redesign).

**Change made:**
- `apps/api/src/services/coinbase-websocket.service.ts`: Save candle to cache in `emitCandleClose()`

**Next steps:**
1. Restart server
2. Monitor logs for 24 hours (especially at timeframe boundaries)
3. Check if 429 fallbacks now have fresh data
4. If still problematic → proceed to Option B (v2.0 full redesign)

### Open Items

- v2.0 research completed in `.planning/research/SUMMARY.md` (on hold pending Option A results)
- Sequence number validation not addressed (Option B scope)
- node-cron reconciliation not needed if Option A works

## Session Continuity

### Last Session

**Date:** 2026-01-20
**Activity:** Investigated 429/stale data issue, implemented Option A fix
**Stopped At:** Fix committed, ready to restart server and monitor

### Resume Context

**If Option A works (fewer stale data issues in logs):**
- May not need full v2.0 redesign
- Consider smaller improvements (sequence validation, heartbeat subscription)

**If Option A fails (still seeing stale indicators):**
- Proceed to v2.0 full redesign
- Research already complete in `.planning/research/`
- Key change: Subscribe to native WebSocket `candles` channel, remove REST from hot path
- Run `/gsd:new-milestone` to create requirements and roadmap

**Key files to check:**
- `logs/indicators/indicators-2026-01-21.log` — look for "recent_fetch_failed" entries
- Compare indicator values after 429 vs after successful fetch

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-20 after Option A fix implemented*
