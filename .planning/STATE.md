# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Data accuracy and timely alerts
**Current focus:** v8.0 Perseus Web Public API - Phase 39 (Public API Foundation & IP Protection)

## Current Position

**Milestone:** v8.0 Perseus Web Public API
**Phase:** 39 of 43 (Public API Foundation & IP Protection)
**Plan:** Ready to plan
**Status:** Roadmap complete, awaiting phase planning

**Last activity:** 2026-02-18 — v8.0 roadmap created (5 phases, 37 requirements)

Progress: [████░░░░░░] 8 of 13 milestones complete (61%)

## Performance Metrics

**Velocity:**
- Total plans completed: 84+ (across v1.0-v7.0)
- Average duration: Varies by phase complexity
- Total execution time: ~45 hours (across 7 milestones)

**Recent milestones:**
- v7.0: 7 phases, 2 days (2026-02-13)
- v6.0: 6 phases, 2 days (2026-02-10)
- v5.0: 7 phases, 2 days (2026-02-08)

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
| v8.0 | Perseus Web Public API | **Active** | — |

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

Recent decisions affecting v8.0 work:

- **IP protection first**: Phase 39 establishes DTO transformation layer before any proprietary data is exposed (can't retrofit after fields are public)
- **REST before WebSocket**: Simpler protocol establishes data contracts first (Phases 39-41 before 42)
- **Auth deferred to Phase 41**: Allows REST endpoint development without blocking on API key infrastructure
- **Runtime modes last**: Phase 43 (pw-host mode) not required until production deployment
- **5-phase structure**: Derived from requirements (not imposed template), aligns with research recommendations

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

### Last Session

**Date:** 2026-02-18
**Activity:** Creating v8.0 roadmap
**Stopped At:** Roadmap complete, requirements traced to phases

### Resume Context

**v8.0 ROADMAP COMPLETE**

Phase structure (5 phases, starting at 39):
- **Phase 39**: Public API Foundation & IP Protection (16 requirements)
- **Phase 40**: Trade Signals with Generic Labeling (2 requirements)
- **Phase 41**: Authentication & Rate Limiting (5 requirements)
- **Phase 42**: WebSocket Bridge with Backpressure (11 requirements)
- **Phase 43**: Runtime Modes & Distributed Architecture (4 requirements)

**Coverage:** 37/37 requirements mapped (100%)

**Next step:** `/gsd:plan-phase 39` to decompose Phase 39 into executable plans

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-18 — v8.0 roadmap created, Phase 39 ready to plan*
