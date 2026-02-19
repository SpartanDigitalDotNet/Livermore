# Roadmap: Livermore Trading Platform

## Milestones

- ✅ **v1.0 Coinbase Fee Analysis Spike** - Phases 1-3 (shipped 2026-01-19)
- ✅ **v2.0 Data Pipeline Redesign** - Phases 4-10 (shipped 2026-01-24)
- ✅ **v3.0 Admin UI + IAM Foundation** - Phases 11-16 (shipped 2026-01-30)
- ✅ **v4.0 User Settings + Runtime Control** - Phases 17-22 (shipped 2026-02-06)
- ✅ **v5.0 Distributed Exchange Architecture** - Phases 23-29 (shipped 2026-02-08)
- 🚧 **v7.0 Smart Warmup & Binance Adapter** - Phases 30-38 (in progress)
- 📋 **v8.0 Perseus Web Public API** - Phases 39-43 (planned)

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
- [x] 36-01-PLAN.md -- BinanceAdapter core implementation (WebSocket streaming, kline/ticker handling, cache integration)
- [x] 36-02-PLAN.md -- ExchangeAdapterFactory wiring for binance/binance_us

### Phase 37: Admin UI -- Connect, Exchange Setup & Warmup Progress
**Goal**: Admins can connect an exchange from the Network page, manage exchange credentials, and monitor warmup progress in real time
**Depends on**: Phase 35 (warmup stats in Redis), Phase 36 (Binance adapter for connect to work), existing Network page from v6.0
**Requirements**: ADM-01, ADM-02, ADM-03, ADM-04, WARM-06
**Success Criteria** (what must be TRUE):
  1. The Admin Network page shows a "Connect" button on instance cards for exchanges that are offline or idle, and clicking it initiates the connection flow
  2. If the exchange is already running on another machine, the Connect button shows a warning modal displaying the current lock holder's hostname, IP, and connected-since timestamp -- the user must explicitly confirm before proceeding
  3. An Exchange Setup Modal allows creating and updating user_exchanges records (API key env var names, display name), with correct is_active/is_default orchestration -- setting a new default exchange automatically unsets the previous default for that user
  4. During warmup, the Admin UI subscribes to warmup progress stats and displays real-time percent complete, ETA, current symbol being warmed, and any failures -- the subscription is active only for the lifetime of the warmup process
**Plans:** 3 plans
Plans:
- [x] 37-01-PLAN.md -- Connect button + lock-check warning modal (ADM-01, ADM-02)
- [x] 37-02-PLAN.md -- Exchange Setup Modal update + is_default orchestration (ADM-03, ADM-04)
- [x] 37-03-PLAN.md -- Warmup progress panel with real-time stats (WARM-06)

### Phase 38: Binance Test Harness & Handoff
**Goal**: Binance exchange integration is validated end-to-end with real exchange data and Kaia has everything needed to configure and run her Binance instance
**Depends on**: Phase 35 (smart warmup), Phase 36 (Binance adapter), Phase 37 (Admin UI for exchange setup)
**Requirements**: TST-01, TST-02, TST-03, TST-04
**Success Criteria** (what must be TRUE):
  1. A Subscription Test Harness performs a BTC 1d warmup against the configured exchange, confirming REST candle fetching works and candles are cached correctly in Redis
  2. The same test harness runs a 2-second WebSocket subscription test, confirming live streaming data is received and parsed into valid candle events
  3. Binance.us is tested end-to-end with real exchange data -- warmup completes, candles are cached at the correct exchange-scoped Redis keys, and WebSocket streaming delivers live updates
  4. Handoff documentation is prepared for Kaia covering: environment variable setup, exchange database configuration, first-run steps, and how to verify the Binance instance is healthy via the Admin Network page
**Plans:** 2 plans
Plans:
- [ ] 38-01-PLAN.md -- Subscription Test Harness script (REST warmup + WebSocket streaming tests)
- [ ] 38-02-PLAN.md -- Binance.us E2E test execution + Kaia handoff documentation

</details>

### v8.0 Perseus Web Public API (Planned)

**Milestone Goal:** Expose Livermore's data through a public REST API and WebSocket endpoint with OpenAPI spec so the open-source Perseus Web client (and any AI agent) can connect without direct Redis/DB access.

**Critical constraint:** MACD-V is proprietary IP -- internal indicator names, formulas, and calculation details NEVER exposed through public endpoints.

#### Phase 39: Public API Foundation & IP Protection
**Goal**: Establish REST endpoints for non-proprietary data with field transformation layer and OpenAPI spec
**Depends on**: Nothing (first phase of milestone)
**Requirements**: API-01, API-04, API-05, API-06, API-07, API-08, OAS-01, OAS-02, OAS-03, OAS-04, OAS-05, OAS-06, IP-01, IP-02, IP-03
**Success Criteria** (what must be TRUE):
  1. External client can fetch OHLCV candle data for any symbol/timeframe/exchange from public REST endpoint
  2. External client can fetch exchange metadata and symbol lists with liquidity grades
  3. All responses use consistent JSON envelope with cursor pagination and ISO8601 timestamps
  4. OpenAPI 3.1 spec serves at /public/v1/openapi.json with AI-optimized descriptions and concrete examples
  5. No internal field names (macdV, signal, histogram, fastEMA, slowEMA, atr, informativeATR) appear in any public response or spec
**Plans:** 3 plans

Plans:
- [x] 39-01-PLAN.md -- Scaffold packages/public-api, public Zod schemas, DTO transformers, pagination helpers
- [x] 39-02-PLAN.md -- Candle, exchange, and symbol route handlers with Fastify OpenAPI plugin
- [x] 39-03-PLAN.md -- Wire plugin into server.ts, end-to-end verification of IP protection

#### Phase 40: Trade Signals with Generic Labeling
**Goal**: Expose trade signals and alert history with proprietary indicator details stripped
**Depends on**: Phase 39
**Requirements**: API-02, API-03
**Success Criteria** (what must be TRUE):
  1. External client can fetch generic trade signals (momentum_signal, trend_signal) for any symbol with direction and strength only
  2. External client can fetch alert history with timestamp, symbol, exchange, timeframe, signal type, direction, and price
  3. No indicator names (MACD-V), calculation parameters (EMA periods, ATR multipliers), or internal metric names appear in signal responses
  4. OpenAPI spec documents signal endpoints with generic schema and clear examples
**Plans:** 2 plans

Plans:
- [x] 40-01-PLAN.md -- Zod schemas and whitelist transformers for signals and alerts
- [x] 40-02-PLAN.md -- Route handlers, plugin wiring, and OpenAPI documentation

#### Phase 41: Authentication & Rate Limiting
**Goal**: Secure public API with API key authentication and tiered rate limiting
**Depends on**: Phase 40
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):
  1. External client can authenticate requests via X-API-Key header with UUID key
  2. Unauthenticated requests to /public/v1/* are rejected with 401 error
  3. All public API requests are rate limited (300 req/min) with 429 response when exceeded
  4. Admin tRPC routes exempt from rate limiting
  5. Admin can generate, view, and regenerate API keys via Admin UI
  6. Public API errors are sanitized with no stack traces or internal details exposed
**Plans:** 2 plans

Plans:
- [x] 41-01-PLAN.md -- Database schema, auth middleware, rate limiting, plugin wiring, CORS, tRPC router
- [x] 41-02-PLAN.md -- Admin UI page for API key management

#### Phase 42: WebSocket Bridge with Backpressure
**Goal**: Real-time streaming of candle closes and trade signals via WebSocket with connection management
**Depends on**: Phase 41
**Requirements**: WS-01, WS-02, WS-03, WS-04, WS-05, WS-06, WS-07, AAS-01, AAS-02, AAS-03, AAS-04
**Success Criteria** (what must be TRUE):
  1. External client can connect to /public/v1/stream with API key authentication
  2. Client can subscribe to candle and signal channels (candles:BTC-USD:1h, signals:ETH-USD:15m) via JSON message
  3. Client receives real-time candle close events when Redis pub/sub fires
  4. Client receives real-time trade signal events with generic labels (no internal indicator details)
  5. Slow or disconnected clients are detected via ping/pong heartbeat and removed automatically
  6. Per-API-key connection limit enforced (max 5 concurrent connections)
  7. AsyncAPI 3.1 spec documents all WebSocket message schemas with concrete examples
**Plans:** 2 plans

Plans:
- [x] 42-01-PLAN.md -- WebSocket bridge engine (types, schemas, ClientConnection, WebSocketBridge, handlers)
- [x] 42-02-PLAN.md -- Route wiring, server integration, and AsyncAPI 3.1 specification

#### Phase 43: Runtime Modes & Distributed Architecture
**Goal**: Enable headless pw-host mode for dedicated public API instances separate from exchange data ingest
**Depends on**: Phase 42
**Requirements**: MODE-01, MODE-02, MODE-03, MODE-04
**Success Criteria** (what must be TRUE):
  1. Server can start in pw-host mode (LIVERMORE_MODE=pw-host) without exchange adapter initialization
  2. In pw-host mode, server serves public API from Redis cache without running warmup or indicator calculations
  3. In exchange mode, server runs full data pipeline and optionally serves public API
  4. Health endpoint reports runtime mode and mode-appropriate status (exchange: WebSocket connected; pw-host: Redis connected)
**Plans**: TBD

Plans:
- [ ] 43-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 34 → 35 → 36 → 37 → 38 → 39 → 40 → 41 → 42 → 43

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 34. Ticker Key Migration | v7.0 | 2/2 | Complete | 2026-02-13 |
| 35. Smart Warmup Engine | v7.0 | 2/2 | Complete | 2026-02-13 |
| 36. Binance WebSocket Adapter | v7.0 | 2/2 | Complete | 2026-02-13 |
| 37. Admin UI -- Connect, Exchange Setup & Warmup Progress | v7.0 | 3/3 | Complete | 2026-02-13 |
| 38. Binance Test Harness & Handoff | v7.0 | 0/2 | Not started | - |
| 39. Public API Foundation & IP Protection | v8.0 | 3/3 | Complete | 2026-02-18 |
| 40. Trade Signals with Generic Labeling | v8.0 | 2/2 | Complete | 2026-02-19 |
| 41. Authentication & Rate Limiting | v8.0 | 2/2 | Complete | 2026-02-19 |
| 42. WebSocket Bridge with Backpressure | v8.0 | 2/2 | Complete | 2026-02-19 |
| 43. Runtime Modes & Distributed Architecture | v8.0 | 0/? | Not started | - |

---
*Roadmap created: 2026-02-13*
*Last updated: 2026-02-19 -- Phase 42 complete (WebSocket bridge + AsyncAPI 3.1 spec)*
