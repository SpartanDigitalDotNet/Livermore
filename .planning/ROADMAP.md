# Roadmap: v2.0 Data Pipeline Redesign

**Created:** 2026-01-21
**Milestone:** v2.0
**Goal:** Eliminate 429 errors and data gaps through cache-first, event-driven architecture

## Overview

Transform from REST-heavy, request-driven architecture to cache-first, event-driven system using native WebSocket candles channel.

```
[Coinbase WebSocket] → [Exchange Adapter] → [Redis Cache] → [Indicator Service] → [Alerts]
                              ↓                    ↑
                        candle:close         [BoundaryRestService]
                           events          (event-driven higher TF)
```

## Phases

### Phase 04: Foundation
**Goal:** Define interfaces and base classes for exchange adapter pattern

**Requirements:**
- ADPT-01: Exchange adapter interface
- CACHE-01: Candle cache writing
- CACHE-02: Timestamp-based versioning

**Deliverables:**
- `IExchangeAdapter` interface
- `UnifiedCandle` schema
- `ExchangeAdapterEvents` type definitions
- `candleCloseChannel()` Redis pub/sub key pattern
- Base adapter abstract class
- Versioned cache write operations

**Plans:** 3 plans
- [x] 04-01-PLAN.md — Schema definitions (UnifiedCandle, ExchangeAdapterEvents, IExchangeAdapter)
- [x] 04-02-PLAN.md — Cache enhancements (candleCloseChannel, versioned writes)
- [x] 04-03-PLAN.md — Base adapter abstract class

**Success Criteria:**
- [x] Adapter interface defined with connect/disconnect/subscribe methods
- [x] UnifiedCandle schema validates candle data from any exchange
- [x] Cache writes reject out-of-order timestamps
- [x] Event types defined for candle:close channel

---

### Phase 05: Coinbase Adapter
**Goal:** Implement Coinbase adapter with native candles channel and robust connection management

**Requirements:**
- ADPT-02: Subscribe to native `candles` WebSocket channel
- ADPT-03: Normalize to UnifiedCandle schema
- ADPT-04: Emit candle:close events
- WS-01: Auto-reconnect with exponential backoff
- WS-02: Heartbeat subscription
- WS-03: Watchdog timer for silent disconnections
- WS-04: Sequence number tracking
- WS-05: Reconnection gap detection

**Deliverables:**
- `CoinbaseAdapter` implementing `IExchangeAdapter`
- Candles channel subscription (5m native data)
- Heartbeat channel subscription
- Watchdog timer (30s no-message = reconnect)
- Sequence tracking and gap detection on reconnect
- REST backfill trigger on reconnection gaps

**Plans:** 3 plans
- [x] 05-01-PLAN.md — CoinbaseAdapter skeleton with WebSocket connection and dual channel subscription
- [x] 05-02-PLAN.md — Candle processing pipeline (normalize, detect close, cache, emit)
- [x] 05-03-PLAN.md — Watchdog timer, sequence tracking, and REST backfill on reconnection

**Success Criteria:**
- [x] Adapter receives native 5m candles from Coinbase WebSocket
- [x] Candles normalized and written to Redis cache
- [x] candle:close events emitted on Redis pub/sub
- [x] Connection survives idle periods via heartbeat
- [x] Silent disconnections detected within 30 seconds
- [x] Reconnection triggers backfill if gap > 5 minutes

---

### Phase 06: Indicator Refactor
**Goal:** Make indicator service event-driven, reading exclusively from cache

**Requirements:**
- CACHE-03: Cache as single source of truth
- IND-01: Subscribe to candle:close events
- IND-02: Read exclusively from cache
- IND-03: 60-candle readiness check
- IND-04: Higher timeframes from cache

**Deliverables:**
- Indicator service subscribes to `candle:close` Redis pub/sub
- Remove all REST API calls from recalculation path
- Cache-only reads for candle data (all timeframes)
- Readiness gate (skip calculation if < 60 candles)
- Higher timeframe boundary detection triggers cache reads

**Plans:** 2 plans
- [x] 06-01-PLAN.md — candleClosePattern helper for Redis psubscribe
- [x] 06-02-PLAN.md — Event-driven indicator service (psubscribe, cache-only, readiness gate)

**Success Criteria:**
- [x] Zero REST API calls during normal indicator operation
- [x] Indicators recalculate on candle:close events only
- [x] Symbols with < 60 candles skipped gracefully
- [x] Higher timeframes read from cache (populated by Phase 07 backfill)
- [x] Existing MACD-V calculations produce same results

---

### Phase 07: Startup Backfill
**Goal:** Populate cache with historical candles on startup

**Requirements:**
- BKFL-01: Fetch 60+ historical candles per symbol/timeframe
- BKFL-02: Rate-limited REST calls
- BKFL-03: Priority order (short timeframes first)
- BKFL-04: Progress tracking

**Deliverables:**
- Startup backfill service
- Rate limiter (5 requests/batch, 1s delay)
- Priority queue (5m → 15m → 1h → 4h → 1d)
- Progress logging (X/Y symbols loaded)

**Plans:** 2 plans
- [x] 07-01-PLAN.md — StartupBackfillService class with rate-limited REST fetching
- [x] 07-02-PLAN.md — Server.ts integration (backfill before indicators)

**Success Criteria:**
- [x] All symbols have 60+ candles in cache before indicators start
- [x] No 429 errors during startup backfill
- [x] Backfill completes within 5 minutes for 25 symbols
- [x] Progress visible in logs

---

### Phase 08: Reconciliation
**Goal:** Event-driven higher timeframe fetching at candle boundaries

**Architecture:** Option A — Event-Driven REST at Timeframe Boundaries
- WebSocket provides 5m candles in real-time
- On 5m candle close, detect if it's also a higher timeframe boundary
- At boundaries (15m, 1h, 4h, 1d), fire rate-limited REST calls
- NO cron jobs — purely event-driven (triggered by WebSocket)

**Requirements:**
- CACHE-04: Gap detection query (for future use)
- RECON-01: Boundary detection (is 5m close also 15m/1h/4h/1d boundary?)
- RECON-02: Event-driven REST fetching at boundaries
- RECON-03: Rate-limited batch processing (5 req/batch, 1s delay)

**Deliverables:**
- Boundary detector (pure function)
- BoundaryRestService (subscribes to 5m candle:close, fetches higher TFs at boundaries)
- Gap detector utilities (for future gap-filling)
- Server.ts integration

**Plans:** 3 plans
- [x] 08-01-PLAN.md — Boundary detector and BoundaryRestService
- [x] 08-02-PLAN.md — Gap detection utilities
- [x] 08-03-PLAN.md — Server.ts integration

**Success Criteria:**
- [x] 5m candle close triggers boundary detection
- [x] At 15m boundaries, fetch 15m candles for all symbols
- [x] At 1h boundaries, fetch 1h candles for all symbols
- [x] At 4h boundaries, fetch 4h candles for all symbols
- [x] At 1d boundaries, fetch 1d candles for all symbols
- [x] REST calls rate-limited (5 req/batch, 1s delay)
- [ ] No 429 errors during boundary fetches (requires runtime verification)

---

### Phase 09: Cleanup
**Goal:** Remove legacy code and finalize migration

**Deliverables:**
- Deprecate old `CoinbaseWebSocketService`
- Remove REST API calls from indicator hot path
- Update server.ts to use new adapter
- Remove Option A code (WebSocket candle cache writes in old service)
- Documentation updates

**Plans:** 2 plans
- [x] 09-01-PLAN.md — Server migration to CoinbaseAdapter
- [x] 09-02-PLAN.md — Documentation finalization

**Success Criteria:**
- [x] Old WebSocket service removed or marked deprecated
- [x] No REST calls in indicator recalculation path
- [x] Server starts cleanly with new architecture
- [ ] All tests pass
- [ ] Zero 429 errors in 24-hour observation

---

## Dependency Graph

```
Phase 04 (Foundation)
    ↓
Phase 05 (Coinbase Adapter)
    ↓
Phase 06 (Indicator Refactor)
    ↓
    ├── Phase 07 (Startup Backfill) ─┐
    │                                 │
    └── Phase 08 (Reconciliation) ───┤
                                      ↓
                              Phase 09 (Cleanup)
```

- Phase 04 blocks all others (interfaces required first)
- Phase 05 blocks Phase 06 (adapter must exist for indicator refactor)
- Phase 06 blocks Phases 07 & 08 (indicator service must be event-driven first)
- Phases 07 & 08 can run in parallel after Phase 06
- Phase 09 requires Phases 07 & 08 complete

## Progress

| Phase | Name | Status | Plans |
|-------|------|--------|-------|
| 04 | Foundation | Complete | 3/3 |
| 05 | Coinbase Adapter | Complete | 3/3 |
| 06 | Indicator Refactor | Complete | 2/2 |
| 07 | Startup Backfill | Complete | 2/2 |
| 08 | Reconciliation | Complete | 3/3 |
| 09 | Cleanup | Complete | 2/2 |

**Overall:** 100% complete (6/6 phases)

---
*Roadmap created: 2026-01-21*
*Last updated: 2026-01-24 after v2.0 completion (Phase 09 finalized)*
