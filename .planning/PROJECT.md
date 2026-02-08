# Livermore Trading Platform

## What This Is

A real-time cryptocurrency trading analysis platform that monitors exchange data (starting with Coinbase), calculates technical indicators (MACD-V), and fires alerts when signal conditions are met. Now includes user-specific configuration, runtime control via Redis pub/sub, and Admin UI for settings and symbol management. Designed for multi-exchange support with Binance.us and Binance.com planned for future milestones.

## Core Value

Data accuracy and timely alerts — indicators must calculate on complete, accurate candle data, and signals must fire reliably without missing conditions or producing false positives from stale data.

## Current State

**Status:** v5.0 planning
**Current focus:** Exchange-scoped data architecture, distributed cross-exchange visibility

## Current Milestone: v5.0 Distributed Exchange Architecture

**Goal:** Refactor from user-scoped to exchange-scoped candles/indicators, enabling cross-exchange visibility for distributed soft-arbitrage ("trigger remotely, buy locally").

**Target features:**
- Exchange-scoped candle keys: `candles:<exchange_id>:<symbol>:<timeframe>` (shared pool)
- Exchange-scoped indicator keys: `indicator:<exchange_id>:<symbol>:<timeframe>:macdv`
- User-defined overflow: `usercandles:` / `userindicator:` keys with TTL for positions/manual adds
- New `exchanges` table with full metadata (API limits, fees, geo restrictions, supported timeframes)
- Idle startup mode: API starts without exchange connections, awaits `start` command
- `user_exchanges` refactor with FK to `exchanges` table
- Symbol sourcing: Tier 1 (Top N by volume, shared) + Tier 2 (user positions + manual, de-duped)
- New startup script with `--autostart <exchange>` parameter option

**Architecture change:**
```
Mike's API (Coinbase)  ──publishes──►  Redis  ◄──subscribes── Kaia's PerseusWeb
                                         │
Kaia's API (Binance)   ──publishes──►────┘
```

Cross-exchange visibility via Redis pub/sub. Any client can subscribe to any exchange's feed.

## Requirements

### Validated

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

### Next Milestone Goals (v5.1+)

- Router auth hardening (convert publicProcedure to protectedProcedure) — tech debt from v3.0
- Orderbook imbalance detection (scalper-orderbook mode implementation)
- Trading contracts (orders, positions, paper trading)
- Runtime exchange switching via Admin (connect to different exchange without restart)
- Azure pub/sub for multi-instance deployment (identity_sub as channel)

### Out of Scope

- Full Order Book (Level2) — not needed for MACD-V calculation
- Trade Execution — monitoring only
- CCXT Library — performance overhead unnecessary
- Cross-Region Replication — single-region sufficient
- Azure pub/sub — Redis pub/sub sufficient for single-instance, Azure deferred
- Runtime exchange switching — API connects to one exchange per startup; switch requires restart
- Router auth hardening — tech debt accepted, defer to v5.1

## Context

**Current architecture (v4.0):**
```
Admin UI (Vite + React + tRPC)
    │
    │ tRPC calls + WebSocket alerts
    ▼
┌─────────────────────────────────────────┐
│                 API                      │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ Control     │  │ Settings Router  │  │
│  │ Channel     │  │ Symbol Router    │  │
│  │ Service     │  │ Control Router   │  │
│  └─────────────┘  └──────────────────┘  │
│         │                │               │
│         ▼                ▼               │
│  ┌─────────────────────────────┐        │
│  │    Redis Pub/Sub            │        │
│  │  (commands + responses)     │        │
│  └─────────────────────────────┘        │
│                                          │
│  ┌─────────────────────────────┐        │
│  │   WebSocket Layer           │        │
│  │   (CoinbaseAdapter)         │        │
│  └─────────────────────────────┘        │
│         │                                │
│         │ Native 5m candles + ticker     │
│         ▼                                │
│  ┌─────────────┐                         │
│  │ Redis Cache │◄── Backfill Service    │
│  └─────────────┘◄── BoundaryRestService │
│         │                                │
│         │ candle:close events            │
│         ▼                                │
│  Indicator Service → Alert Evaluation   │
└─────────────────────────────────────────┘
    │
    │ WebSocket broadcast
    ▼
Admin UI (real-time alerts)
```

**What v4.0 added:**
- User settings stored in PostgreSQL JSONB
- Admin→API command communication via Redis pub/sub
- Runtime control without restart (pause/resume/reload)
- Symbol management with exchange validation
- Full Admin UI for settings, control, and symbols

## Constraints

- **Event-driven**: No timer-based polling for indicator calculations. System must be driven by exchange data.
- **60-candle minimum**: MACDV requires at least 60 candles per symbol/timeframe for accurate alignment with charts.
- **Latency targets**: 1m/5m signals <10s, 4h/1d signals can tolerate 30s-1m delay.
- **Coinbase rate limits**: Must respect API limits, hence move to WebSocket + cache-first.
- **Incremental refactor**: Existing MACDV functionality must work throughout refactor.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Event-driven architecture | No cron jobs, no polling — WebSocket events trigger all processing | ✓ Shipped v2.0 |
| Cache as source of truth | Indicator service never calls REST API during normal operation | ✓ Shipped v2.0 |
| Native 5m candles | Eliminates data gaps from ticker-built candles | ✓ Shipped v2.0 |
| Boundary-triggered REST | Higher timeframes fetched at 5m boundaries (no cron) | ✓ Shipped v2.0 |
| Exchange adapter pattern | Multi-exchange support without indicator changes | ✓ Shipped v2.0 |
| Preserve legacy service | Deprecated but kept for rollback during observation | ✓ Shipped v2.0 |
| Atlas-only migrations | Database schema (schema.sql) is source of truth; Drizzle migrations BANNED | ✓ Shipped v3.0 |
| Database-first ORM | Use `drizzle-kit pull` to generate TypeScript from database (like EF scaffolding) | ✓ Shipped v3.0 |
| Sandbox as shared DB | Azure PostgreSQL (Sandbox) shared between Livermore and Kaia's UI | ✓ Shipped v3.0 |
| Settings as JSONB | Single JSONB column on users table for flexible settings schema | ✓ Shipped v4.0 |
| Redis pub/sub for control | Admin→API commands via Redis, future Azure pub/sub | ✓ Shipped v4.0 |
| Pause mode not shutdown | API stays running but idles; keeps pub/sub channel open | ✓ Shipped v4.0 |
| Credentials in env vars | Settings store env var names, not actual secrets | ✓ Shipped v4.0 |
| Hybrid symbol management | Scanner from exchange + user curation in Admin | ✓ Shipped v4.0 |
| Bidirectional form/JSON sync | lastEditSource ref prevents infinite loops | ✓ Shipped v4.0 |
| Manual shadcn components | Project doesn't use shadcn CLI; components created manually with CVA | ✓ Shipped v4.0 |

## Partnership Context

**Kaia's UI (PerseusWeb):** Frontend trading platform that connects to Livermore as backend service.

**Integration points:**
- Sandbox PostgreSQL: Shared database for IAM and user settings
- WebSocket: Real-time data feed (candles, indicators, signals) — future milestone
- Contracts: Shared TypeScript models for API communication — future milestone
- Redis pub/sub: PerseusWeb can subscribe to Livermore control channels

**v3.0 unblocked Kaia:** IAM tables deployed, KAIA-IAM-HANDOFF.md delivered.

**v4.0 added:** User settings schema that Kaia's PerseusWeb can also leverage for her Binance.com configuration. PerseusWeb integration guide for Redis pub/sub and API setup.

---
*Last updated: 2026-02-06 — v5.0 milestone started*
