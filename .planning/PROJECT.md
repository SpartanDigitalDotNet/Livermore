# Livermore Trading Platform

## What This Is

A real-time cryptocurrency trading analysis platform that monitors exchange data (starting with Coinbase), calculates technical indicators (MACD-V), and fires alerts when signal conditions are met. Designed for multi-exchange support with Binance.us and Binance.com planned for future milestones.

## Core Value

Data accuracy and timely alerts — indicators must calculate on complete, accurate candle data, and signals must fire reliably without missing conditions or producing false positives from stale data.

## Current State

**Status:** v4.0 planning
**Current focus:** User settings infrastructure, Admin→API runtime control

## Current Milestone: v4.0 User Settings + Runtime Control

**Goal:** Enable user-specific configuration stored in PostgreSQL, with Admin UI for editing settings and Redis pub/sub for Admin→API command communication.

**Target features:**
- User settings as JSONB column on users table (mirrors current file structure)
- Settings tRPC endpoints (CRUD)
- Admin Settings UI (form-based editor + JSON editor for power users)
- Redis pub/sub channel for Admin→API commands
- API command handling: pause, resume, reload-settings, switch-mode, add/remove-symbol, force-backfill, clear-cache
- Runtime modes: position-monitor, scalper-macdv, scalper-orderbook (stub)
- Hybrid symbol management: scanner fetches from exchange, user curates in Admin
- Per-user exchange credential env var names (credentials stay in env vars, not DB)

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

### Next Milestone Goals (v4.1+)

- Orderbook imbalance detection (scalper-orderbook mode implementation)
- Trading contracts (orders, positions, paper trading)
- Multi-exchange adapters (Binance.us, Binance.com)
- Azure pub/sub for multi-instance deployment (identity_sub as channel)
- Router auth tech debt (convert publicProcedure to protectedProcedure)

### Out of Scope

- Full Order Book (Level2) — not needed for MACD-V calculation
- Trade Execution — monitoring only
- CCXT Library — performance overhead unnecessary
- Cross-Region Replication — single-region sufficient
- Orderbook imbalance implementation — stub only in v4.0, full implementation v4.1
- Azure pub/sub — Redis pub/sub sufficient for single-instance, Azure deferred
- Router auth hardening — tech debt accepted, defer to v4.1

## Context

**Current architecture (v2.0):**
```
WebSocket Layer (CoinbaseAdapter)
    │
    │ Native 5m candles + ticker from Coinbase channels
    ▼
┌─────────────────┐
│   Redis Cache   │◄── Backfill Service (startup)
└─────────────────┘◄── BoundaryRestService (15m/1h/4h/1d at boundaries)
    │
    │ candle:close events + ticker pub/sub
    ▼
Indicator Service (cache-only reads)
    │
    ▼
Alert Evaluation (receives ticker prices)
```

**What v2.0 solved:**
- 17,309 429 errors from REST-heavy architecture → eliminated
- 93% data gaps from ticker-built candles → native 5m candles
- $0.00 price in alert notifications → ticker pub/sub

**Multi-exchange readiness:**
- `IExchangeAdapter` interface defined
- `BaseExchangeAdapter` abstract class with reconnection logic
- `UnifiedCandle` schema normalizes exchange data
- Binance adapters can be added without modifying indicator service

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
| Settings as JSONB | Single JSONB column on users table for flexible settings schema | — v4.0 |
| Redis pub/sub for control | Admin→API commands via Redis, future Azure pub/sub | — v4.0 |
| Pause mode not shutdown | API stays running but idles; keeps pub/sub channel open | — v4.0 |
| Credentials in env vars | Settings store env var names, not actual secrets | — v4.0 |
| Hybrid symbol management | Scanner from exchange + user curation in Admin | — v4.0 |

## Partnership Context

**Kaia's UI (PerseusWeb):** Frontend trading platform that connects to Livermore as backend service.

**Integration points:**
- Sandbox PostgreSQL: Shared database for IAM and user settings
- WebSocket: Real-time data feed (candles, indicators, signals) — future milestone
- Contracts: Shared TypeScript models for API communication — future milestone

**v3.0 unblocked Kaia:** IAM tables deployed, KAIA-IAM-HANDOFF.md delivered.

**v4.0 adds:** User settings schema that Kaia's PerseusWeb can also leverage for her Binance.com configuration.

---
*Last updated: 2026-01-31 — v4.0 milestone started*
