# Roadmap: v2.0 Data Pipeline Redesign

**Created:** 2026-01-21
**Milestone:** v2.0
**Goal:** Eliminate 429 errors and data gaps through cache-first, event-driven architecture

## Overview

Transform from REST-heavy, request-driven architecture to cache-first, event-driven system using native WebSocket candles channel.

```
[Coinbase WebSocket] → [Exchange Adapter] → [Redis Cache] → [Indicator Service] → [Alerts]
                              ↓                    ↑
                        candle:close         [Reconciliation Job]
                           events              (gap filling)
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
- [ ] 05-01-PLAN.md — CoinbaseAdapter skeleton with WebSocket connection and dual channel subscription
- [ ] 05-02-PLAN.md — Candle processing pipeline (normalize, detect close, cache, emit)
- [ ] 05-03-PLAN.md — Watchdog timer, sequence tracking, and REST backfill on reconnection

**Success Criteria:**
- [ ] Adapter receives native 5m candles from Coinbase WebSocket
- [ ] Candles normalized and written to Redis cache
- [ ] candle:close events emitted on Redis pub/sub
- [ ] Connection survives idle periods via heartbeat
- [ ] Silent disconnections detected within 30 seconds
- [ ] Reconnection triggers backfill if gap > 5 minutes

---

### Phase 06: Indicator Refactor
**Goal:** Make indicator service event-driven, reading exclusively from cache

**Requirements:**
- CACHE-03: Cache as single source of truth
- IND-01: Subscribe to candle:close events
- IND-02: Read exclusively from cache
- IND-03: 60-candle readiness check
- IND-04: Timeframe aggregation

**Deliverables:**
- Indicator service subscribes to `candle:close` Redis pub/sub
- Remove all REST API calls from recalculation path
- Cache-only reads for candle data
- Readiness gate (skip calculation if < 60 candles)
- Aggregation logic: build 15m/1h/4h/1d from cached 5m candles

**Success Criteria:**
- [ ] Zero REST API calls during normal indicator operation
- [ ] Indicators recalculate on candle:close events only
- [ ] Symbols with < 60 candles skipped gracefully
- [ ] Higher timeframes aggregate correctly from 5m data
- [ ] Existing MACD-V calculations produce same results

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
- Priority queue (1m → 5m → 15m → 1h → 4h → 1d)
- Progress logging (X/Y symbols loaded)

**Success Criteria:**
- [ ] All symbols have 60+ candles in cache before indicators start
- [ ] No 429 errors during startup backfill
- [ ] Backfill completes within 5 minutes for 25 symbols
- [ ] Progress visible in logs

---

### Phase 08: Reconciliation
**Goal:** Background jobs to detect and fill data gaps

**Requirements:**
- CACHE-04: Gap detection query
- RECON-01: 5-minute gap scan
- RECON-02: Hourly full reconciliation
- RECON-03: Gap-triggered backfill
- RECON-04: node-cron scheduling

**Deliverables:**
- Gap detection query (find missing timestamps in sorted set)
- 5-minute cron job: scan for gaps, queue backfill
- Hourly cron job: validate cached candles against REST
- Rate-limited backfill for detected gaps
- `node-cron` integration

**Success Criteria:**
- [ ] Gaps detected within 5 minutes of occurrence
- [ ] Gaps filled via REST backfill automatically
- [ ] Hourly validation catches cache-REST mismatches
- [ ] Reconciliation doesn't interfere with normal operations

---

### Phase 09: Cleanup
**Goal:** Remove legacy code and finalize migration

**Deliverables:**
- Deprecate old `CoinbaseWebSocketService`
- Remove REST API calls from indicator hot path
- Update server.ts to use new adapter
- Remove Option A code (WebSocket candle cache writes in old service)
- Documentation updates

**Success Criteria:**
- [ ] Old WebSocket service removed or marked deprecated
- [ ] No REST calls in indicator recalculation path
- [ ] Server starts cleanly with new architecture
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
| 05 | Coinbase Adapter | Planned | 0/3 |
| 06 | Indicator Refactor | Pending | 0/? |
| 07 | Startup Backfill | Pending | 0/? |
| 08 | Reconciliation | Pending | 0/? |
| 09 | Cleanup | Pending | 0/? |

**Overall:** 17% complete (1/6 phases)

---
*Roadmap created: 2026-01-21*
*Last updated: 2026-01-21 after Phase 05 planning*
