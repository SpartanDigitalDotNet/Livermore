# Roadmap: Livermore v7.0 Smart Warmup & Binance Adapter

## Overview

v7.0 transforms warmup from brute-force backfill into a smart, observable process and brings Binance WebSocket streaming online for Kaia's instance. The roadmap starts with a surgical ticker key migration to align the last user-scoped keys with the exchange-scoped pattern established in v5.0, then builds the smart warmup engine that scans cached data before fetching, followed by the Binance WebSocket adapter (the REST client already exists from v5.0), Admin UI enhancements for exchange connection and warmup monitoring, and finally a test harness that validates the complete Binance pipeline end-to-end before Kaia handoff.

## Phases

**Phase Numbering:**
- Integer phases (34, 35, 36, 37, 38): Planned v7.0 milestone work
- Decimal phases (34.1, 34.2): Urgent insertions if needed (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 34: Ticker Key Migration** - Remove userId from ticker keys and pub/sub channels to complete exchange-scoped key alignment
- [x] **Phase 35: Smart Warmup Engine** - Scan cached candle data first, build a schedule of what is missing, execute only the gaps, and publish real-time progress stats
- [ ] **Phase 36: Binance WebSocket Adapter** - Implement IExchangeAdapter for Binance with WebSocket streaming, symbol normalization, and factory wiring
- [ ] **Phase 37: Admin UI -- Connect, Exchange Setup & Warmup Progress** - Network page Connect button with lock-check, Exchange Setup Modal for user_exchanges, and warmup progress subscription
- [ ] **Phase 38: Binance Test Harness & Handoff** - Validate Binance REST warmup and WebSocket streaming end-to-end, then prepare Kaia handoff

## Phase Details

### Phase 34: Ticker Key Migration
**Goal**: Ticker keys and pub/sub channels are exchange-scoped (consistent with candle and indicator keys), with no user_id in the key pattern
**Depends on**: Nothing (first phase -- surgical refactor of existing key pattern)
**Requirements**: TICK-01, TICK-02, TICK-03
**Success Criteria** (what must be TRUE):
  1. An impact assessment documents every service, router, and component that reads or writes ticker keys or subscribes to ticker pub/sub channels, confirming nothing is missed before code changes begin
  2. Ticker data is stored at `ticker:{exchangeId}:{symbol}` instead of `ticker:{userId}:{exchangeId}:{symbol}`, and all services that read ticker data (alert price display, Admin UI) resolve prices correctly from the new key
  3. Ticker pub/sub channels use the new exchange-scoped pattern, and real-time price updates flow from the WebSocket ticker handler through pub/sub to any subscriber without interruption
**Plans:** 2 plans
Plans:
- [x] 34-01-PLAN.md -- Impact assessment + cache layer migration (tickerKey, tickerChannel, TickerCacheStrategy)
- [x] 34-02-PLAN.md -- Update all consumer code + final verification audit

### Phase 35: Smart Warmup Engine
**Goal**: Warmup only fetches candle data that is actually missing, skipping symbol/timeframe pairs that already have sufficient cached data, with real-time progress visible in Redis
**Depends on**: Phase 34 (clean key patterns before building new warmup logic)
**Requirements**: WARM-01, WARM-02, WARM-03, WARM-04, WARM-05
**Success Criteria** (what must be TRUE):
  1. Before any REST calls are made, an Exchange Candle Status Scan checks each symbol from largest to smallest timeframe (1d, 4h, 1h, 15m, 5m) and identifies which symbol/timeframe pairs already have 60+ cached candles -- pairs with sufficient data are skipped entirely
  2. The scan results are compiled into a warmup schedule stored at `exchange:<exchange_id>:warm-up-schedule:symbols` in Redis, listing only the symbol/timeframe pairs that need fetching -- an external observer (or Admin UI) can read this key to see what warmup will do before it starts
  3. Warmup execution follows the schedule, making REST calls only for symbol/timeframe pairs listed as needing data -- a warm restart with fully cached data results in zero REST backfill calls
  4. Warmup progress stats (percent complete, ETA, symbols remaining, failures) are continuously updated at `exchange:<exchange_id>:warm-up-schedule:stats` in Redis as warmup progresses, reflecting real-time status
**Plans:** 2 plans
Plans:
- [x] 35-01-PLAN.md -- Candle Status Scanner + Warmup Schedule Builder (types, scanner, schedule builder, Redis keys)
- [x] 35-02-PLAN.md -- SmartWarmupService executor with progress stats + handleStart() integration

### Phase 36: Binance WebSocket Adapter
**Goal**: BinanceAdapter streams real-time candle data via WebSocket, handles Binance message formats, and integrates into the existing exchange adapter pipeline
**Depends on**: Nothing from this milestone (BinanceRestClient and IExchangeAdapter interface already exist from v5.0)
**Requirements**: BIN-01, BIN-02, BIN-04, BIN-05
**Success Criteria** (what must be TRUE):
  1. BinanceAdapter implements IExchangeAdapter and streams real-time kline (candle) data via WebSocket, processing Binance's JSON message format into the same candle events that CoinbaseAdapter produces
  2. The adapter works for both binance.com and binance.us by reading wsUrl and restUrl from the exchanges table -- no code changes needed to switch between the two, only the database row differs
  3. ExchangeAdapterFactory creates a BinanceAdapter when the exchange name is 'binance' or 'binance_us' -- the commented-out factory branch is replaced with working code
  4. The adapter handles Binance WebSocket specifics: ping/pong heartbeat, automatic reconnection on disconnect, and subscription management for multiple symbol streams
**Plans:** 2 plans
Plans:
- [ ] 36-01-PLAN.md -- BinanceAdapter core implementation (WebSocket streaming, kline/ticker handling, cache integration)
- [ ] 36-02-PLAN.md -- ExchangeAdapterFactory wiring for binance/binance_us

### Phase 37: Admin UI -- Connect, Exchange Setup & Warmup Progress
**Goal**: Admins can connect an exchange from the Network page, manage exchange credentials, and monitor warmup progress in real time
**Depends on**: Phase 35 (warmup stats in Redis), Phase 36 (Binance adapter for connect to work), existing Network page from v6.0
**Requirements**: ADM-01, ADM-02, ADM-03, ADM-04, WARM-06
**Success Criteria** (what must be TRUE):
  1. The Admin Network page shows a "Connect" button on instance cards for exchanges that are offline or idle, and clicking it initiates the connection flow
  2. If the exchange is already running on another machine, the Connect button shows a warning modal displaying the current lock holder's hostname, IP, and connected-since timestamp -- the user must explicitly confirm before proceeding
  3. An Exchange Setup Modal allows creating and updating user_exchanges records (API key env var names, display name), with correct is_active/is_default orchestration -- setting a new default exchange automatically unsets the previous default for that user
  4. During warmup, the Admin UI subscribes to warmup progress stats and displays real-time percent complete, ETA, current symbol being warmed, and any failures -- the subscription is active only for the lifetime of the warmup process
**Plans**: TBD

### Phase 38: Binance Test Harness & Handoff
**Goal**: Binance exchange integration is validated end-to-end with real exchange data and Kaia has everything needed to configure and run her Binance instance
**Depends on**: Phase 35 (smart warmup), Phase 36 (Binance adapter), Phase 37 (Admin UI for exchange setup)
**Requirements**: TST-01, TST-02, TST-03, TST-04
**Success Criteria** (what must be TRUE):
  1. A Subscription Test Harness performs a BTC 1d warmup against the configured exchange, confirming REST candle fetching works and candles are cached correctly in Redis
  2. The same test harness runs a 2-second WebSocket subscription test, confirming live streaming data is received and parsed into valid candle events
  3. Binance.us is tested end-to-end with real exchange data -- warmup completes, candles are cached at the correct exchange-scoped Redis keys, and WebSocket streaming delivers live updates
  4. Handoff documentation is prepared for Kaia covering: environment variable setup, exchange database configuration, first-run steps, and how to verify the Binance instance is healthy via the Admin Network page
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 34 -> 35 -> 36 -> 37 -> 38

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 34. Ticker Key Migration | 2/2 | Complete | 2026-02-13 |
| 35. Smart Warmup Engine | 2/2 | Complete | 2026-02-13 |
| 36. Binance WebSocket Adapter | 0/2 | Planned | - |
| 37. Admin UI -- Connect, Exchange Setup & Warmup Progress | 0/TBD | Not started | - |
| 38. Binance Test Harness & Handoff | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-13*
*Last updated: 2026-02-13 -- Phase 36 planned (Binance WebSocket Adapter)*
