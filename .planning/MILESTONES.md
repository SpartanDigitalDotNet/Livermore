# Project Milestones: Livermore

## v5.0 Distributed Exchange Architecture (Shipped: 2026-02-08)

**Status:** Shipped (2026-02-08)

**Delivered:** Exchange-scoped distributed data architecture enabling cross-exchange visibility for soft-arbitrage patterns. Multi-exchange support with Coinbase and Binance clients, pluggable REST interfaces, idle startup with start/stop control, and two-tier symbol management.

**Phases completed:** 23-29 (7 phases)

**Key accomplishments:**

- `exchanges` metadata table with 6 exchange seed data and normalized `user_exchanges` FK
- Exchange-scoped Redis keys with dual-read pattern (shared Tier 1, user overflow Tier 2)
- `SymbolSourceService` with two-tier symbol sourcing and de-duplication
- Idle startup mode with `start`/`stop` commands and `--autostart` CLI flag
- Cross-exchange alert channels with source attribution (`source_exchange_id`)
- `ExchangeAdapterFactory` + `BinanceAdapter` + `BinanceRestClient`
- `IRestClient` interface decoupling REST clients from exchange-specific implementations
- Package rename: `@livermore/coinbase-client` to `@livermore/exchange-core`

**Stats:**

- 7 phases, 19 requirements, 23 commits
- 121 source files changed, ~6,000 lines of TypeScript
- 2 days from start to ship (2026-02-06 to 2026-02-08)

**Git range:** `00f27ea` to `6bb4182`

**Tech debt accepted:**
- SymbolSourceService and ExchangeAdapterFactory built but not wired into server.ts startup
- Hardcoded userId=1, exchangeId=1 in 4 locations
- Router auth hardening still deferred (publicProcedure)
- switch-mode still a stub

**What's next:** v5.1 - Wire orphaned services, Binance live testing, hardcoded ID removal

---

## v4.0 User Settings + Runtime Control (Shipped: 2026-02-06)

**Status:** Shipped (2026-02-06)

**Delivered:** User-specific configuration stored in PostgreSQL with JSONB, Redis pub/sub control channels for Admin-to-API command communication, runtime mode management, symbol management, and Admin UI for settings editing, runtime control, and symbol curation.

**Phases completed:** 17-22 (23 plans total)

**Key accomplishments:**

- User settings as JSONB column with typed Zod schema, CRUD endpoints, export/import
- Redis pub/sub control channel with commands, ACKs, results, priority queue, timeouts
- Runtime commands: pause/resume, reload-settings, force-backfill, clear-cache, switch-mode (stub)
- Symbol management with add/remove, exchange validation, bulk import, metrics preview
- Admin Settings UI with form editor + Monaco JSON editor, bidirectional sync, diff view
- Admin Control Panel UI with runtime status, pause/resume, mode switcher, command history
- Real-time WebSocket alerts with MACD-V colored UI elements

**Stats:**

- 6 phases, 23 plans, 45 requirements
- ~22,000 lines of TypeScript
- 2 days from start to ship (2026-01-31 → 2026-02-01)

**Git range:** `31de468` → `0eb7769`

**Tech debt accepted:**
- indicator/alert/position routers use publicProcedure (deferred to v4.1)
- control.getStatus returns mock data (architecture limitation)
- switch-mode is a stub (strategy implementation in v4.1)

**What's next:** v4.1 - Router auth hardening, orderbook imbalance, trading contracts

---

## v3.0 Admin UI + IAM Foundation (Shipped: 2026-01-30)

**Status:** Shipped (2026-01-30)

**Delivered:** Database-first workflow with Atlas migrations, OAuth identity management via Clerk authentication, and Admin UI for monitoring portfolio, signals, and logs.

**Phases completed:** 11-16 (9 plans total)

**Key accomplishments:**

- Atlas-based database workflow (Drizzle migrations banned, schema.sql is source of truth)
- IAM schema with OAuth identity columns (identity_provider, identity_sub, display_name, role)
- Clerk authentication integration (@clerk/fastify plugin + protectedProcedure middleware)
- User sync via webhooks (/webhooks/clerk) and frontend component (UserSync)
- Admin UI with Vite + React + TailwindCSS + tRPC client
- Portfolio viewer, trade signals viewer, and log viewer pages
- Kaia handoff documentation for PerseusWeb integration

**Stats:**

- 6 phases, 9 plans, 20 requirements
- 5 days from start to ship (2026-01-26 → 2026-01-30)

**Git range:** `2ace5e3` → `HEAD`

**Tech debt accepted:**
- indicator/alert/position routers use publicProcedure (should be protectedProcedure)
- Role-based authorization helpers exported but not used

**What's next:** v3.1 - Protect API endpoints, trading contracts for PerseusWeb

---

## v2.0 Data Pipeline Redesign (Code Complete: 2026-01-24)

**Status:** Shipped (2026-01-24)

**Delivered:** Cache-first, event-driven data pipeline eliminating 429 errors and data gaps through native WebSocket candles and intelligent boundary-triggered REST fetching.

**Verification (2026-01-24):**
- [x] Server starts and receives candle events
- [x] Boundary triggers deduplicated (single trigger per boundary, not per symbol)
- [x] Zero 429 errors (fix: snapshot filtering + boundary deduplication)
- [ ] Alerts show actual prices (not $0.00) — ticker pub/sub ready, awaiting signal trigger

**Phases completed:** 04-10 (17 plans total)

**Key accomplishments:**

- Exchange adapter pattern with `IExchangeAdapter` interface and `CoinbaseAdapter` implementation
- Native 5m WebSocket candles replacing ticker-built 1m candles (eliminates 93% data gaps)
- Cache as single source of truth — zero REST calls in indicator hot path
- Event-driven higher timeframe fetching at boundaries (no cron jobs)
- Startup backfill with rate limiting (5 req/batch, 1s delay)
- Ticker pub/sub for alert price display

**Stats:**

- 17 plans across 7 phases
- ~1,500 lines of TypeScript
- 3 days from start to ship (2026-01-21 → 2026-01-24)

**Git range:** `f1de50e` → `7017e13`

**What's next:** Multi-exchange support (Binance.us, Binance.com) or observability improvements

---

## v1.0 Coinbase Fee Analysis Spike (Shipped: 2026-01-19)

**Delivered:** One-shot analysis tool to understand Coinbase trading fee structure by examining historical transaction data.

**Phases completed:** 1-3 (3 plans total)

**Key accomplishments:**

- Extended CoinbaseRestClient with `getFilledOrders()` method (cursor-based pagination)
- Created fee calculation functions (by symbol, by side, by month)
- Built formatted console output with aligned tables
- Generated markdown reports with fee tier header
- Analyzed 1,622 orders across 140 symbols ($8.4M volume, $13K fees)

**Stats:**

- 22 files created/modified
- 703 lines of TypeScript (spike code)
- 3 phases, 3 plans, 6 tasks
- 2 days from start to ship

**Git range:** `60f1409` → `84bf199`

**What's next:** Spike complete. This was a one-shot analysis tool.

---

*Milestones log started: 2026-01-19*
