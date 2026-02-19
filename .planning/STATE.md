# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-13)

**Core value:** Data accuracy and timely alerts
**Current focus:** v8.0 Perseus Web Public API

## Current Position

**Milestone:** v8.0 Perseus Web Public API
**Phase:** Not started (defining requirements)
**Plan:** —
**Status:** Defining requirements

**Last activity:** 2026-02-18 — Milestone v8.0 started

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Archived | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Archived | 2026-01-30 |
| v4.0 | User Settings + Runtime Control | Archived | 2026-02-06 |
| v5.0 | Distributed Exchange Architecture | Archived | 2026-02-08 |
| v6.0 | Perseus Network | Archived | 2026-02-10 |
| v7.0 | Smart Warmup & Binance Adapter | Archived | 2026-02-13 |

See `.planning/MILESTONES.md` for full history.

## Tech Debt (Carried Forward)

| Issue | Priority | Impact | From |
|-------|----------|--------|------|
| indicator.router.ts uses publicProcedure | High | Unprotected API access | v3.0 |
| alert.router.ts uses publicProcedure | High | Unprotected API access | v3.0 |
| position.router.ts uses publicProcedure | High | Unprotected API access | v3.0 |
| switch-mode is a stub | Medium | Mode doesn't actually switch | v4.0 |
| Autostart has no user context | High | Can't load user settings/symbols | v5.0 |
| Autostart hardcodes exchangeId=1 (Coinbase) | Medium | Autostart only supports Coinbase | v5.0 |
| Routers hardcode TEST_USER_ID/TEST_EXCHANGE_ID | Medium | Tied to publicProcedure debt | v3.0 |
| Legacy userId param in cache calls (candle/indicator only) | Low | Ticker keys migrated (v7.0 Phase 34); candle/indicator still have userId | v5.0 |

## Accumulated Context

### Hard Constraints (User-Specified)

| Constraint | Reason |
|------------|--------|
| **NO cron jobs** | User explicitly rejected node-cron approach |
| **NO aggregation** | User stated "Don't suggest aggregate to me ever again" |
| **Zero 429 errors** | Core reliability requirement |
| **Atlas-only migrations** | Drizzle migrations BANNED - schema.sql is source of truth |
| **SSL required** | Azure PostgreSQL requires SSL - hardcode, don't use env vars |
| **No silent defaults** | If exchange unknown, surface error -- never default to Coinbase |
| **One instance per exchange** | Only one Livermore API may actively serve a given exchange at any time |
| **Env vars from Windows User scope** | Never use .env files -- environment variables injected via .ps1 scripts |
| **MACD-V is proprietary IP** | NEVER expose MACD-V name, formula, or calculation details publicly. Public API uses generic labels ("trade signal", "momentum", "divergence"). Internal indicator names must not leak through public endpoints. |

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- exchangeName bug fix: control-channel.service.ts line 428 was hardcoding "coinbase" -- fixed to use DB value
- Ticker keys fully migrated to exchange-scoped: cache layer (34-01) and all 5 consumer call sites (34-02) complete
- Removed unused userId param from getCurrentPrice() in position-sync.service.ts during ticker migration
- BinanceAdapter WebSocket class created with kline x-field close detection and miniTicker streaming
- Used /ws bare endpoint with SUBSCRIBE method frames for dynamic stream management (no reconnect needed for subscription changes)
- wsUrl injected from options (not hardcoded) so same BinanceAdapter works for binance.com and binance.us
- Exchange Candle Status Scan approach: check largest to smallest timeframe per symbol
- Smart warmup scans cached data first, only fetches what is missing (not multi-exchange simultaneous)
- SCAN_TIMEFRAME_ORDER: 1d -> 1m (largest to smallest per WARM-01)
- MIN_CANDLE_THRESHOLD: 60 candles determines sufficient vs insufficient pairs
- Schedule persisted as JSON to exchange:<id>:warm-up-schedule:symbols for external observability
- SmartWarmupService replaces StartupBackfillService for startup only; ad-hoc backfill unchanged
- Warmup stats persisted without TTL so Admin UI can read after warmup completes
- Batch size 5 with 1s delay matching existing rate limiting pattern
- BinanceRestClient created in factory (not adapter) to keep exchange-core free from binance-client dependency
- Factory wsUrl/restUrl sourced from exchanges DB table -- binance.com vs binance.us is data-driven
- [Phase 37]: Use trpcClient directly for imperative calls instead of hooks
- [Phase 37]: Show ConnectButton for offline, idle, and stopped states only
- [Phase 37-02]: is_default orchestration pattern: unset all other defaults before setting new default (prevents multiple defaults per user)
- [Phase 37-02]: ExchangeSetupModal supports both create (existing flow) and edit mode (pre-populated, calls updateExchange)
- [Phase 37-02]: Edit mode skips exchange selection step and is dismissable (vs non-dismissable create mode)
- [Phase 37-03]: Use conditional refetchInterval based on warmup status (2s active, 30s complete)
- [Phase 38-01]: Use raw WebSocket (ws library) for 2s streaming test instead of full BinanceAdapter (simpler, no state)
- [Phase 38-01]: Test harness validates both REST (TST-01) and WebSocket (TST-02) with real exchange data before Kaia handoff
- [Phase 38-02]: KAIA-HANDOFF.md structured with 7 sections: Overview, Environment Variables, Exchange Config, First-Run Steps, Verification, Troubleshooting, Test Results
- [Phase 38-02]: Test harness executed against binance_us -- both TST-01 (REST) and TST-02 (WebSocket) PASSED on 2026-02-13

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

### Last Session

**Date:** 2026-02-18
**Activity:** Starting v8.0 Perseus Web Public API milestone
**Stopped At:** Defining requirements

### Resume Context

**v8.0 PERSEUS WEB PUBLIC API — MILESTONE STARTED**

Key context:
- v7.0 complete (phases 34-38, shipped 2026-02-13)
- Liquidity scoring shipped on Binance-Wireup branch (post-v7.0)
- v8.0 branch: `public-api`
- Perseus Web (PW) is open-source client in separate repo
- Livermore exposes public REST API + WebSocket for PW consumption
- "Headless" mode: Livermore instances that serve PW without exchange connections
- OpenAPI spec as contract between repos (zod-to-openapi server, openapi-typescript client)
- AsyncAPI for WebSocket message schemas
- NATS deferred to future milestone

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-18 — Milestone v8.0 started (Perseus Web Public API)*
