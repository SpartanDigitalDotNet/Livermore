# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-13)

**Core value:** Data accuracy and timely alerts
**Current focus:** v7.0 Smart Warmup & Binance Adapter

## Current Position

**Milestone:** v7.0 Smart Warmup & Binance Adapter
**Phase:** 34 of 38 (Ticker Key Migration)
**Plan:** --
**Status:** Roadmap created, ready to plan Phase 34

**Last activity:** 2026-02-13 -- Roadmap created (5 phases, 22 requirements mapped)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Archived | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Archived | 2026-01-30 |
| v4.0 | User Settings + Runtime Control | Archived | 2026-02-06 |
| v5.0 | Distributed Exchange Architecture | Archived | 2026-02-08 |
| v6.0 | Perseus Network | Archived | 2026-02-10 |

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
| Legacy userId param in cache calls | Low | Cache API signature requires unused param | v5.0 |

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

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- exchangeName bug fix: control-channel.service.ts line 428 was hardcoding "coinbase" -- fixed to use DB value
- Ticker keys still user-scoped (to be migrated in Phase 34)
- BinanceRestClient exists (REST) but BinanceAdapter WebSocket does not exist yet
- Exchange Candle Status Scan approach: check largest to smallest timeframe per symbol
- Smart warmup scans cached data first, only fetches what is missing (not multi-exchange simultaneous)

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

### Last Session

**Date:** 2026-02-13
**Activity:** Created v7.0 roadmap -- 5 phases, 22 requirements, phases 34-38
**Stopped At:** Roadmap creation complete, ready to plan Phase 34

### Resume Context

**v7.0 SMART WARMUP & BINANCE ADAPTER -- ROADMAP CREATED**

Key context:
- v6.0 Perseus Network complete (phases 30-33)
- v7.0 roadmap: 5 phases (34-38), 22 requirements
- Phase 34 (Ticker Key Migration) is first -- surgical refactor, 3 requirements
- Phase 35 (Smart Warmup Engine) is the big one -- 5 requirements, core innovation
- Phase 36 (Binance WebSocket Adapter) -- 5 requirements, BinanceRestClient already exists
- Phase 37 (Admin UI) -- 5 requirements, combines connect/setup/warmup-progress
- Phase 38 (Test Harness & Handoff) -- 4 requirements, validates everything for Kaia

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-13 -- v7.0 roadmap created*
