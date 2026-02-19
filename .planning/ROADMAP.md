# Roadmap: Livermore Trading Platform

## Milestones

- ✅ **v1.0 Coinbase Fee Analysis Spike** - Phases 1-3 (shipped 2026-01-19)
- ✅ **v2.0 Data Pipeline Redesign** - Phases 4-10 (shipped 2026-01-24)
- ✅ **v3.0 Admin UI + IAM Foundation** - Phases 11-16 (shipped 2026-01-30)
- ✅ **v4.0 User Settings + Runtime Control** - Phases 17-22 (shipped 2026-02-06)
- ✅ **v5.0 Distributed Exchange Architecture** - Phases 23-29 (shipped 2026-02-08)
- 🚧 **v7.0 Smart Warmup & Binance Adapter** - Phases 30-38 (in progress)
- ✅ **v8.0 Perseus Web Public API** - Phases 39-43 (shipped 2026-02-19)

## Phases

<details>
<summary>✅ v1.0-v5.0 (Phases 1-29) - SHIPPED</summary>

See MILESTONES.md for details.

</details>

<details>
<summary>🚧 v7.0 Smart Warmup & Binance Adapter (Phases 30-38) - IN PROGRESS</summary>

### Phase 34: Ticker Key Migration
**Goal**: Ticker keys and pub/sub channels are exchange-scoped (consistent with candle and indicator keys), with no user_id in the key pattern
**Depends on**: Nothing (first phase -- surgical refactor of existing key pattern)
**Requirements**: TICK-01, TICK-02, TICK-03
**Plans:** 2 plans
Plans:
- [x] 34-01-PLAN.md -- Impact assessment + cache layer migration (tickerKey, tickerChannel, TickerCacheStrategy)
- [x] 34-02-PLAN.md -- Update all consumer code + final verification audit

### Phase 35: Smart Warmup Engine
**Goal**: Warmup only fetches candle data that is actually missing, skipping symbol/timeframe pairs that already have sufficient cached data, with real-time progress visible in Redis
**Depends on**: Phase 34
**Requirements**: WARM-01, WARM-02, WARM-03, WARM-04, WARM-05
**Plans:** 2 plans
Plans:
- [x] 35-01-PLAN.md -- Candle Status Scanner + Warmup Schedule Builder
- [x] 35-02-PLAN.md -- SmartWarmupService executor with progress stats + handleStart() integration

### Phase 36: Binance WebSocket Adapter
**Goal**: BinanceAdapter streams real-time candle data via WebSocket, handles Binance message formats, and integrates into the existing exchange adapter pipeline
**Depends on**: Nothing from this milestone
**Requirements**: BIN-01, BIN-02, BIN-04, BIN-05
**Plans:** 2 plans
Plans:
- [x] 36-01-PLAN.md -- BinanceAdapter core implementation
- [x] 36-02-PLAN.md -- ExchangeAdapterFactory wiring for binance/binance_us

### Phase 37: Admin UI -- Connect, Exchange Setup & Warmup Progress
**Goal**: Admins can connect an exchange from the Network page, manage exchange credentials, and monitor warmup progress in real time
**Depends on**: Phase 35, Phase 36
**Requirements**: ADM-01, ADM-02, ADM-03, ADM-04, WARM-06
**Plans:** 3 plans
Plans:
- [x] 37-01-PLAN.md -- Connect button + lock-check warning modal
- [x] 37-02-PLAN.md -- Exchange Setup Modal update + is_default orchestration
- [x] 37-03-PLAN.md -- Warmup progress panel with real-time stats

### Phase 38: Binance Test Harness & Handoff
**Goal**: Binance exchange integration is validated end-to-end with real exchange data and Kaia has everything needed to configure and run her Binance instance
**Depends on**: Phase 35, Phase 36, Phase 37
**Requirements**: TST-01, TST-02, TST-03, TST-04
**Plans:** 2 plans
Plans:
- [ ] 38-01-PLAN.md -- Subscription Test Harness script (REST warmup + WebSocket streaming tests)
- [ ] 38-02-PLAN.md -- Binance.us E2E test execution + Kaia handoff documentation

</details>

<details>
<summary>✅ v8.0 Perseus Web Public API (Phases 39-43) - SHIPPED 2026-02-19</summary>

See milestones/v8.0-ROADMAP.md for full details.

- [x] Phase 39: Public API Foundation & IP Protection (3/3 plans) -- 2026-02-18
- [x] Phase 40: Trade Signals with Generic Labeling (2/2 plans) -- 2026-02-19
- [x] Phase 41: Authentication & Rate Limiting (2/2 plans) -- 2026-02-19
- [x] Phase 42: WebSocket Bridge with Backpressure (2/2 plans) -- 2026-02-19
- [x] Phase 43: Runtime Modes & Distributed Architecture (2/2 plans) -- 2026-02-19

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 34. Ticker Key Migration | v7.0 | 2/2 | Complete | 2026-02-13 |
| 35. Smart Warmup Engine | v7.0 | 2/2 | Complete | 2026-02-13 |
| 36. Binance WebSocket Adapter | v7.0 | 2/2 | Complete | 2026-02-13 |
| 37. Admin UI -- Connect, Setup & Warmup | v7.0 | 3/3 | Complete | 2026-02-13 |
| 38. Binance Test Harness & Handoff | v7.0 | 0/2 | Not started | - |
| 39. Public API Foundation & IP Protection | v8.0 | 3/3 | Complete | 2026-02-18 |
| 40. Trade Signals with Generic Labeling | v8.0 | 2/2 | Complete | 2026-02-19 |
| 41. Authentication & Rate Limiting | v8.0 | 2/2 | Complete | 2026-02-19 |
| 42. WebSocket Bridge with Backpressure | v8.0 | 2/2 | Complete | 2026-02-19 |
| 43. Runtime Modes & Distributed Architecture | v8.0 | 2/2 | Complete | 2026-02-19 |

---
*Roadmap created: 2026-02-13*
*Last updated: 2026-02-19 -- v8.0 Perseus Web Public API shipped*
