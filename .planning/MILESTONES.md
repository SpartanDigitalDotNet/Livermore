# Project Milestones: Livermore

## v2.0 Data Pipeline Redesign (Shipped: 2026-01-24)

**Delivered:** Cache-first, event-driven data pipeline eliminating 429 errors and data gaps through native WebSocket candles and intelligent boundary-triggered REST fetching.

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

**Git range:** `f1de50e` → `235c9ff`

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
