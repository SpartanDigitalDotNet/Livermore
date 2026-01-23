# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Real-time crypto trading analysis and decision support
**Current focus:** v2.0 Data Pipeline Redesign

## Current Position

**Milestone:** v2.0 Data Pipeline Redesign
**Phase:** 08-reconciliation (5 of 6) **COMPLETE**
**Plan:** 3 of 3 (all complete)
**Status:** Phase 08 complete, ready for Phase 09 (Cleanup)
**Last activity:** 2026-01-23 - Completed 08-03-PLAN.md (BoundaryRestService Server Integration)

**Progress:** [############] 14/14 plans (100% of Phases 04-08)

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

### Decisions Made (Phase 08)

| ID | Decision | Reason |
|----|----------|--------|
| RECON-BOUNDARY-DETECTION | Timestamp modulo operation for boundary detection | Pure, testable, no external dependencies |
| GAP-PURE-FUNCTIONS | Gap detection as pure functions rather than service class | Enables flexible composition and easy testing |
| RECON-SUBSCRIBER-CONNECTION | redis.duplicate() for separate subscriber connection | ioredis requires separate connection for psubscribe |
| RECON-STARTUP-ORDER | BoundaryRestService starts after indicators, before WebSocket | Must be subscribed before events arrive |

### Candles Channel Research (2026-01-23)

**Method:** Empirical testing with PowerShell harness against live Coinbase WebSocket

**Critical findings:**
| Aspect | Documentation | Reality |
|--------|---------------|---------|
| Granularity | "five minutes" | 5m only, skips empty candles |
| Snapshot size | Not specified | 100 candles max |
| Higher timeframes | Not mentioned | **NOT AVAILABLE** via WebSocket |

**Test results (100 symbols):**
- 86/100 symbols received snapshots
- 72 symbols (84%) had full 100 candles
- 14 symbols (16%) had < 100 candles (low liquidity)
- Gaps exist where no trades occurred

**Implication:** Higher timeframes (15m, 1h, 4h, 1d) MUST come from REST API.

**Research files:**
- `.planning/research/CANDLES-CHANNEL-FINDINGS.md` - Full findings
- `scripts/test-candles-channel.ps1` - Test harness
- `candles-test-100-symbols.json` - Raw results

### Hard Constraints (User-Specified)

| Constraint | Reason |
|------------|--------|
| **NO cron jobs** | User explicitly rejected node-cron approach |
| **NO aggregation** | User stated "Don't suggest aggregate to me ever again" |
| **Zero 429 errors** | Core reliability requirement |

### Phase 08 Architecture Decision (2026-01-23)

**Selected:** Option A — Event-Driven REST at Timeframe Boundaries

**How it works:**
1. WebSocket provides 5m candles in real-time
2. On 5m candle close, detect if it's also a higher timeframe boundary
3. At boundaries (15m, 1h, 4h, 1d), fire REST calls for those timeframes
4. Rate limit REST calls to stay under Coinbase limits

**Why this satisfies constraints:**
- Event-driven (triggered by WebSocket), NOT cron-scheduled
- No aggregation — each timeframe fetched directly from Coinbase
- Rate limiting prevents 429 errors

**Expected REST traffic (100 symbols):**
- ~12,700 calls/day (~8.8 calls/minute average)
- Well under Coinbase's 30 req/sec limit with batching

### Open Items

- Low-volume symbol policy: Include or exclude symbols with < 100 candles?

## Session Continuity

### Last Session

**Date:** 2026-01-23
**Activity:** Executed 08-03-PLAN.md (BoundaryRestService Server Integration)
**Stopped At:** Phase 08 complete, ready for Phase 09

### Resume Context

Phase 08 (Reconciliation) is now complete. All event-driven boundary detection and higher timeframe fetching is integrated.

**Phase 08 Deliverables:**

**08-01 - Boundary Detection and REST Service:**
- BoundaryRestService with event-driven boundary detection
- detectBoundaries(), isTimeframeBoundary() functions
- Rate limiting pattern (5 req/batch, 1s delay)

**08-02 - Gap Detection:**
- Gap detection utilities with pure functions
- detectGaps, detectGapsForSymbol, getTimestampsOnly

**08-03 - Server Integration:**
- BoundaryRestService integrated into server startup
- Separate Redis subscriber connection for psubscribe
- Startup order: Backfill -> Indicators -> BoundaryRestService -> WebSocket
- Graceful shutdown handling

**Key artifacts:**
- `packages/coinbase-client/src/reconciliation/` - Full reconciliation module
- `apps/api/src/server.ts` - Server with BoundaryRestService integration
- `.planning/phases/08-reconciliation/*-SUMMARY.md` - Execution summaries

**Phase order:**
1. Phase 04: Foundation (interfaces, base classes) **COMPLETE**
2. Phase 05: Coinbase Adapter (native candles channel) **COMPLETE** (3/3)
3. Phase 06: Indicator Refactor (event-driven, cache-only) **COMPLETE** (3/3)
4. Phase 07: Startup Backfill **COMPLETE** (2/2)
5. Phase 08: Reconciliation **COMPLETE** (3/3)
6. Phase 09: Cleanup (not yet planned)

**Next:** Phase 09 planning and execution (Cleanup)

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-23 after 08-03-PLAN.md execution complete*
