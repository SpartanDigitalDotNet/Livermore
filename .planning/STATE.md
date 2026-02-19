# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-19)

**Core value:** Data accuracy and timely alerts
**Current focus:** Planning next milestone

## Current Position

**Milestone:** v8.0 Perseus Web Public API — SHIPPED
**Status:** Milestone complete, planning next

**Last activity:** 2026-02-19 — v8.0 milestone archived

Progress: [█████████░] 9 of 13 milestones complete (69%)

## Performance Metrics

**Velocity:**
- Total plans completed: 88+ (across v1.0-v8.0)
- v8.0: 5 phases, 11 plans, 2 days (2026-02-18 to 2026-02-19)

**Recent milestones:**
- v8.0: 5 phases, 2 days (2026-02-19)
- v7.0: 7 phases, 2 days (2026-02-13)
- v6.0: 6 phases, 2 days (2026-02-10)

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
| v8.0 | Perseus Web Public API | **Shipped** | 2026-02-19 |

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
| Legacy userId param in cache calls (candle/indicator only) | Low | Ticker keys migrated (v7.0); candle/indicator still have userId | v5.0 |
| Swagger UI CSP inline style violation | Low | swagger-ui-bundle.js blocked by CSP 'style-src' directive | v8.0 |

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
| **MACD-V is proprietary IP** | NEVER expose MACD-V name, formula, or calculation details publicly |

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

### Last Session

**Date:** 2026-02-19
**Activity:** Completed v8.0 milestone — audit passed (37/37), archived, tagged
**Stopped At:** Milestone archived, ready for `/gsd:new-milestone`

### Resume Context

**v8.0 SHIPPED** — 5 phases (39-43), 11 plans, 37/37 requirements satisfied, 35 commits, 3,897 LOC

Key deliverables:
- `@livermore/public-api` package with REST endpoints, WebSocket bridge, auth middleware
- OpenAPI 3.1 + AsyncAPI 3.1 specs
- IP protection via DTO field whitelisting (MACD-V never exposed)
- API key auth with rate limiting, Admin UI for key management
- Runtime mode system (exchange vs pw-host)
- UAT: 6/6 tests passed (including critical validateEnv auto-detect bug fix)

**Next:** `/gsd:new-milestone` to define next scope

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-19 — v8.0 Perseus Web Public API shipped*
