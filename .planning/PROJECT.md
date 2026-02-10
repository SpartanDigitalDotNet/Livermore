# Livermore Trading Platform

## What This Is

A real-time cryptocurrency trading analysis platform with multi-exchange support (Coinbase and Binance). Monitors exchange data via WebSocket, calculates technical indicators (MACD-V), and fires alerts when signal conditions are met. Features exchange-scoped distributed data architecture enabling cross-exchange visibility, idle startup with runtime control via Redis pub/sub, and Admin UI for settings, symbols, and exchange management.

## Core Value

Data accuracy and timely alerts — indicators must calculate on complete, accurate candle data, and signals must fire reliably without missing conditions or producing false positives from stale data.

## Current State

**Status:** v6.0 in progress
**Current focus:** Perseus Network — instance registration and health

**Architecture (v6.0):**
```
Mike's API (Coinbase) ──registers──► exchange:1:status  ◄──reads── Admin UI (Network View)
                      ──heartbeat──► (TTL-based)
                      ──logs──────► logs:network:coinbase (Redis Stream, 90d TTL)
                                         │
Kaia's API (Binance)  ──registers──► exchange:2:status  ◄──reads── Admin UI (Network View)
                      ──heartbeat──► (TTL-based)
                      ──logs──────► logs:network:binance (Redis Stream, 90d TTL)
```

Each Livermore API instance registers itself in Redis with full identity (hostname, IP, admin, exchange, symbol count). Heartbeat TTL ensures stale instances are detected automatically. Network activity logged to Redis Streams for 90-day audit trail.

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

### Active

**v6.0 Perseus Network — Instance Registration & Health**

- [ ] Exchange-scoped instance status key `exchange:<exchange_id>:status` (replaces prototype `exchange:status`)
- [ ] Full status payload: exchangeId, exchangeName, connectionState, connectedAt, lastHeartbeat, symbolCount, adminEmail, adminDisplayName, ipAddress (public), hostname, lastError
- [ ] Connection state machine: `idle → starting → warming → active → stopping → stopped`
- [ ] State transitions maintained throughout full API lifecycle (startup, warmup, active, shutdown)
- [ ] Heartbeat with Redis TTL (key expiry = instance is dead, no clean shutdown)
- [ ] Public IP detection via external service at startup
- [ ] Network activity log via Redis Streams (`logs:network:<exchange_name>`) with 90-day retention
- [ ] Log events: state transitions and errors
- [ ] Admin UI "Network" view showing all registered instances with real-time status and activity feed
- [ ] Fix existing bugs: heartbeat not updating, error not populating, connectionState stuck on `idle` when instance is down

### Out of Scope

- Full Order Book (Level2) — not needed for MACD-V calculation
- Trade Execution — monitoring only
- CCXT Library — performance overhead unnecessary
- Cross-Region Replication — single-region sufficient
- Azure pub/sub — Redis pub/sub sufficient for single-instance, Azure deferred
- 1m candle support — Coinbase WebSocket only provides native 5m
- Real-time arbitrage execution — soft-arbitrage (signals only) is safer
- Standby/passive instance registration — foundation first, failover in v6.1+
- Graceful handoff protocol (notify → takeover → confirm → shutdown) — requires standby, deferred
- Remote Admin control (ngrok tunnels, cross-instance management) — requires handoff, deferred
- Authorization/permission schema for remote control — requires remote admin, deferred

## Constraints

- **Event-driven**: No timer-based polling for indicator calculations. System must be driven by exchange data.
- **60-candle minimum**: MACDV requires at least 60 candles per symbol/timeframe for accurate alignment with charts.
- **Latency targets**: 1m/5m signals <10s, 4h/1d signals can tolerate 30s-1m delay.
- **Rate limits**: Must respect per-exchange API limits, hence WebSocket + cache-first.
- **Incremental refactor**: Existing MACDV functionality must work throughout refactor.
- **No silent defaults**: If exchange or configuration is unknown, surface the error — never silently fall back to Coinbase.
- **One instance per exchange**: Only one Livermore API may actively serve a given exchange at any time. Enforced via Redis status keys.
- **Heartbeat TTL**: If an instance stops heartbeating, it is considered dead. No separate health-check service.

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
| Dual-read for migration | Check exchange-scoped first, fall back to user-scoped | ✓ Shipped v5.0 |
| IRestClient interface | Decouple REST clients from exchange-specific implementations | ✓ Shipped v5.0 |
| Package rename (exchange-core) | coinbase-client contained exchange-agnostic services | ✓ Shipped v5.0 |
| 3 separate Redis env vars | Never store full connection URL; construct at runtime | ✓ Shipped v5.0 |
| No silent exchange defaults | If exchange unknown, surface error — never default to Coinbase | ✓ Shipped v5.0 |

## Partnership Context

**Kaia's UI (PerseusWeb):** Frontend trading platform that connects to Livermore as backend service.

**Integration points:**
- Sandbox PostgreSQL: Shared database for IAM and user settings
- Redis pub/sub: Cross-exchange visibility — Kaia subscribes to Coinbase alerts, Mike subscribes to Binance alerts
- Binance support: Kaia runs Binance exchange, data flows through same architecture

**v5.0 enabled:** Kaia's Binance instance publishes to Redis, Mike's Coinbase instance subscribes. Cross-exchange soft-arbitrage signals operational.

**v6.0 goal:** Each Livermore API instance becomes a visible, identifiable node in the Perseus Network. Admins can see who's running what, where, and whether it's healthy — the foundation for future active/passive failover and remote administration.

---
*Last updated: 2026-02-08 — start v6.0 Perseus Network milestone*
