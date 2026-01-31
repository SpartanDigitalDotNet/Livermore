# Project Milestones: Livermore

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
