# Livermore Trading Platform

## What This Is

A real-time cryptocurrency trading analysis platform with multi-exchange support (Coinbase and Binance). Monitors exchange data via WebSocket, calculates technical indicators (MACD-V), and fires alerts when signal conditions are met. Features exchange-scoped distributed data architecture, idle startup with runtime control, Admin UI, and a public REST/WebSocket API with OpenAPI spec for external clients and AI agents.

## Core Value

Data accuracy and timely alerts — indicators must calculate on complete, accurate candle data, and signals must fire reliably without missing conditions or producing false positives from stale data.

## Current State

**Status:** v8.0 shipped (2026-02-19)
**Current focus:** Planning next milestone

**Architecture (v8.0):**
```
Exchange Mode:
  API (Coinbase/Binance) ──WebSocket──► candles/indicators ──► alerts
                         ──registers──► exchange:N:status (Redis, TTL heartbeat)
                         ──serves────► /public/v1/* (REST + WebSocket)
                         ──serves────► /trpc/* (Admin UI)

pw-host Mode:
  API (headless) ────reads────► Redis cache (candles, indicators, tickers)
                 ────serves───► /public/v1/* (REST + WebSocket)
                 ────serves───► /health (mode: pw-host)
```

**Public API surface (v8.0):**
- REST: `/public/v1/candles`, `/signals`, `/alerts`, `/exchanges`, `/symbols`
- WebSocket: `/public/v1/stream` (candle close + trade signal events)
- Auth: API key via `X-API-Key` header, 300 req/min rate limit
- Specs: OpenAPI 3.1 at `/public/v1/openapi.json`, AsyncAPI 3.1 for WebSocket
- IP protection: DTO transformers with explicit field whitelisting — MACD-V never exposed

## Requirements

### Validated

<details>
<summary>v1.0-v5.0 validated requirements (41 items)</summary>

- ✓ Coinbase REST client with JWT authentication — v1.0
- ✓ Transaction summary endpoint (current fee tier, 30-day volume) — v1.0
- ✓ CoinbaseOrder interface with fee fields — v1.0
- ✓ WebSocket ticker subscription for real-time price updates — existing
- ✓ MACDV calculation across all timeframes (5m, 15m, 1h, 4h, 1d) — existing
- ✓ Redis cache for candle and indicator storage — existing
- ✓ Alert system for signal notifications — existing
- ✓ Exchange adapter abstraction layer — v2.0
- ✓ Unified candle cache schema (exchange-agnostic) — v2.0
- ✓ WebSocket candles channel subscription (Coinbase 5m native candles) — v2.0
- ✓ Cache-first indicator calculation (no REST during normal operation) — v2.0
- ✓ Event-driven reconciliation at timeframe boundaries — v2.0
- ✓ Startup backfill with 60-candle minimum per symbol/timeframe — v2.0
- ✓ Ticker pub/sub for alert price display — v2.0
- ✓ Atlas-based database workflow (schema.sql as source of truth) — v3.0
- ✓ IAM schema with OAuth identity columns — v3.0
- ✓ Clerk authentication for Admin UI — v3.0
- ✓ User sync via webhooks and frontend component — v3.0
- ✓ Admin UI with portfolio, signals, and logs viewers — v3.0
- ✓ Pre-flight connection validation (database + Redis) — v3.0
- ✓ User settings as JSONB column with typed Zod schema — v4.0
- ✓ Settings tRPC endpoints (get, update, patch, export, import) — v4.0
- ✓ Redis pub/sub control channel with commands, ACKs, results — v4.0
- ✓ Runtime commands (pause, resume, reload-settings, switch-mode stub, force-backfill, clear-cache) — v4.0
- ✓ Symbol management (add, remove, validate, bulk import, metrics) — v4.0
- ✓ Admin Settings UI (form + JSON editor, bidirectional sync, diff view) — v4.0
- ✓ Admin Control Panel (status, pause/resume, mode switcher, command history) — v4.0
- ✓ Admin Symbols UI (watchlist, add/remove, bulk import) — v4.0
- ✓ Real-time WebSocket alerts with MACD-V colored UI elements — v4.0
- ✓ `exchanges` metadata table with API limits, fees, geo restrictions — v5.0
- ✓ `user_exchanges` FK refactor to reference `exchanges` table — v5.0
- ✓ Exchange adapter factory (Coinbase/Binance) — v5.0
- ✓ Exchange connection status tracking — v5.0
- ✓ Exchange-scoped Redis keys (candles, indicators, pub/sub channels) — v5.0
- ✓ User overflow keys with TTL for Tier 2 symbols — v5.0
- ✓ Dual-read pattern (exchange-scoped first, user-scoped fallback) — v5.0
- ✓ Two-tier symbol management (Tier 1 shared, Tier 2 user positions) — v5.0
- ✓ Idle startup mode with start/stop commands — v5.0
- ✓ `--autostart` CLI flag for automation — v5.0
- ✓ Connection lifecycle events — v5.0
- ✓ Cross-exchange alert channels with source attribution — v5.0
- ✓ IRestClient interface with pluggable REST clients — v5.0
- ✓ BinanceRestClient and BinanceAdapter — v5.0

</details>

**v8.0 Perseus Web Public API (37 requirements):**
- ✓ Public REST endpoints for candles, signals, alerts, exchanges, symbols — v8.0
- ✓ OpenAPI 3.1 spec auto-generated from Zod schemas at /public/v1/openapi.json — v8.0
- ✓ AI-optimized descriptions with concrete JSON examples for all endpoints — v8.0
- ✓ Consistent JSON envelope with cursor pagination and ISO8601 timestamps — v8.0
- ✓ WebSocket bridge at /public/v1/stream with subscribe/unsubscribe protocol — v8.0
- ✓ Redis pub/sub fan-out for candle close and trade signal events — v8.0
- ✓ Ping/pong heartbeat (30s), per-key connection limit (5), backpressure handling — v8.0
- ✓ AsyncAPI 3.1 spec for WebSocket message schemas — v8.0
- ✓ API key authentication via X-API-Key header with UUID keys in api_keys table — v8.0
- ✓ Rate limiting (300 req/min) via Redis-backed @fastify/rate-limit — v8.0
- ✓ Route-scoped CORS (permissive public, restrictive admin) — v8.0
- ✓ Error sanitization stripping stack traces and internal details — v8.0
- ✓ Admin UI page for API key generation, display, and regeneration — v8.0
- ✓ DTO transformation layer with explicit field whitelisting for IP protection — v8.0
- ✓ Zero proprietary indicator names in any public response or spec — v8.0
- ✓ Separate @livermore/public-api package isolated from internal indicator packages — v8.0
- ✓ Runtime mode system (LIVERMORE_MODE=exchange|pw-host) — v8.0
- ✓ pw-host mode skips exchange adapter, warmup, indicators — serves API from Redis cache — v8.0
- ✓ Health endpoint reports runtime mode and mode-appropriate service status — v8.0

### Active

**v7.0 Smart Warmup & Binance Adapter (remaining)**

- [ ] Subscription Test Harness (BTC 1d warmup + 2s WebSocket test)
- [ ] Binance.us end-to-end warmup test and Kaia handoff

### Out of Scope

- Full Order Book (Level2) — not needed for MACD-V calculation
- Trade Execution — monitoring only
- CCXT Library — performance overhead unnecessary
- Cross-Region Replication — single-region sufficient
- Azure pub/sub — Redis pub/sub sufficient for single-instance, Azure deferred
- 1m candle support — Coinbase WebSocket only provides native 5m
- Real-time arbitrage execution — soft-arbitrage (signals only) is safer
- Standby/passive instance registration — foundation first, failover in v6.1+
- Graceful handoff protocol — requires standby, deferred
- Remote Admin control — requires handoff, deferred
- GraphQL API — REST + OpenAPI spec is simpler and AI-agent-friendly
- OAuth 2.0 for public endpoints — API keys simpler for read-only data
- Client SDK npm package — wait for spec stability (2+ months)
- Webhook delivery for alerts — defer to v9+
- Historical data dumps (>90 days) — Livermore's value is real-time signals

## Constraints

- **Event-driven**: No timer-based polling for indicator calculations. System must be driven by exchange data.
- **60-candle minimum**: MACDV requires at least 60 candles per symbol/timeframe for accurate alignment with charts.
- **Latency targets**: 1m/5m signals <10s, 4h/1d signals can tolerate 30s-1m delay.
- **Rate limits**: Must respect per-exchange API limits, hence WebSocket + cache-first.
- **Incremental refactor**: Existing MACDV functionality must work throughout refactor.
- **No silent defaults**: If exchange or configuration is unknown, surface the error — never silently fall back to Coinbase.
- **One instance per exchange**: Only one Livermore API may actively serve a given exchange at any time. Enforced via Redis status keys.
- **Heartbeat TTL**: If an instance stops heartbeating, it is considered dead. No separate health-check service.
- **MACD-V IP protection**: Internal indicator names, formulas, and calculation details NEVER exposed through public endpoints. Generic labels only.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Event-driven architecture | No cron jobs, no polling — WebSocket events trigger all processing | ✓ Shipped v2.0 |
| Cache as source of truth | Indicator service never calls REST API during normal operation | ✓ Shipped v2.0 |
| Native 5m candles | Eliminates data gaps from ticker-built candles | ✓ Shipped v2.0 |
| Boundary-triggered REST | Higher timeframes fetched at 5m boundaries (no cron) | ✓ Shipped v2.0 |
| Exchange adapter pattern | Multi-exchange support without indicator changes | ✓ Shipped v2.0 |
| Atlas-only migrations | Database schema (schema.sql) is source of truth; Drizzle migrations BANNED | ✓ Shipped v3.0 |
| Database-first ORM | Use `drizzle-kit pull` to generate TypeScript from database (like EF scaffolding) | ✓ Shipped v3.0 |
| Sandbox as shared DB | Azure PostgreSQL (Sandbox) shared between Livermore and Kaia's UI | ✓ Shipped v3.0 |
| Settings as JSONB | Single JSONB column on users table for flexible settings schema | ✓ Shipped v4.0 |
| Redis pub/sub for control | Admin→API commands via Redis, future Azure pub/sub | ✓ Shipped v4.0 |
| Credentials in env vars | Settings store env var names, not actual secrets | ✓ Shipped v4.0 |
| Manual shadcn components | Project doesn't use shadcn CLI; components created manually with CVA | ✓ Shipped v4.0 |
| Exchange-scoped shared keys | Tier 1 symbols share data across users/instances | ✓ Shipped v5.0 |
| User overflow with TTL | Tier 2 symbols have TTL-based auto-cleanup | ✓ Shipped v5.0 |
| Idle startup mode | API doesn't connect until `start` command | ✓ Shipped v5.0 |
| Adapter factory pattern | Factory instantiates correct adapter by exchange type | ✓ Shipped v5.0 |
| No silent exchange defaults | If exchange unknown, surface error — never default to Coinbase | ✓ Shipped v5.0 |
| Explicit field whitelisting | DTO transformers use explicit field selection, not spreading and omitting — new internal fields never leak | ✓ Shipped v8.0 |
| String decimals for prices | API uses string format to prevent precision loss | ✓ Shipped v8.0 |
| Opaque Base64 cursors | Pagination cursors hide internal implementation details | ✓ Shipped v8.0 |
| Zero indicators dependency | @livermore/public-api does NOT depend on @livermore/indicators — hard IP isolation | ✓ Shipped v8.0 |
| In-memory API key cache | 60s TTL avoids DB hit per request; negative entries prevent abuse | ✓ Shipped v8.0 |
| CORS delegator pattern | Single registration with route-scoped origin logic | ✓ Shipped v8.0 |
| Early-return mode isolation | pw-host block returns early, keeping exchange code at original indentation | ✓ Shipped v8.0 |
| Auto-detect mode in validateEnv | resolveMode() called internally when no mode arg passed — fixes module-level callers | ✓ Shipped v8.0 |

## Partnership Context

**Perseus Network (PN):** The data network — provides candles, signals, alerts, and metadata. NOT a trading platform. PN does not execute trades.

**Perseus Web (PW):** Open-source client that consumes PN's public API. PW is responsible for:
- Live trading: Each PW implementation integrates with the user's own exchange for execution
- Paper trading: PW maintains its own paper trading stack locally (not hosted by PN)
- The PN public API documentation must make AI agents aware that PW clients are expected to implement paper and live trading modes

**Kaia's UI (PerseusWeb):** The reference PW implementation that connects to Livermore as backend service.

**Integration points:**
- Sandbox PostgreSQL: Shared database for IAM and user settings
- Redis pub/sub: Cross-exchange visibility — Kaia subscribes to Coinbase alerts, Mike subscribes to Binance alerts
- Public API: Perseus Web clients connect via /public/v1/* REST + WebSocket (v8.0)
- Binance support: Kaia runs Binance exchange, data flows through same architecture

**v8.0 enabled:** External clients and AI agents can connect to Livermore's public API with API keys, receiving real-time candle and signal data without direct Redis/DB access. pw-host mode enables dedicated API instances separate from exchange data ingest.

---
*Last updated: 2026-02-19 after v8.0 milestone*
