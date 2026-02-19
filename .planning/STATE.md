# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Data accuracy and timely alerts
**Current focus:** v8.0 Perseus Web Public API - Phase 40 (Trade Signals with Generic Labeling)

## Current Position

**Milestone:** v8.0 Perseus Web Public API
**Phase:** 40 of 43 (Trade Signals with Generic Labeling)
**Plan:** Ready to plan
**Status:** Phase 39 complete and verified, Phase 40 awaiting planning

**Last activity:** 2026-02-19 — Phase 39 complete (3/3 plans, verified 8/8 must-haves)

Progress: [████░░░░░░] 8 of 13 milestones complete (61%)

## Performance Metrics

**Velocity:**
- Total plans completed: 85+ (across v1.0-v8.0)
- Average duration: Varies by phase complexity
- Total execution time: ~45.1 hours (across 8 milestones in progress)

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

| Plan | Duration (s) | Tasks | Files |
|------|--------------|-------|-------|
| Phase 39 P01 | 298 | 2 tasks | 9 files |
| Phase 39 P02 | 364 | 2 tasks | 5 files |
| Phase 39 P03 | 281 | 1 task | 3 files |

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

**Phase 39-01 decisions:**
- **Explicit field whitelisting over omission**: transformCandle() uses explicit field selection (not spreading and omitting) - ensures new internal fields never leak
- **String decimals for prices**: API uses string format (not numbers) to prevent precision loss, aligns with API-08 requirement
- **Opaque Base64 cursors**: Pagination cursors encode internal values (hides implementation details)
- **Zero indicators dependency**: @livermore/public-api does NOT depend on @livermore/indicators - hard IP isolation boundary
- [Phase 39]: Direct Redis access (not CandleCacheStrategy) for candle route to avoid userId dependency
- [Phase 39]: In-memory exchange name -> ID caching (exchanges rarely change)
- [Phase 39]: Liquidity score thresholds: >=0.8=high, >=0.5=medium, else low

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

### Last Session

**Date:** 2026-02-19
**Activity:** Executing Phase 39 Plan 01
**Stopped At:** Completed 39-02-PLAN.md (REST Endpoints)

### Resume Context

**PHASE 39 COMPLETE AND VERIFIED**

Phase 39 delivered:
- `@livermore/public-api` package with Zod schemas, DTO transformers, cursor pagination
- GET /public/v1/candles/:exchange/:symbol/:timeframe (Redis sorted set read)
- GET /public/v1/exchanges (DB + Redis status check)
- GET /public/v1/symbols (DB with liquidity grading)
- Fastify plugin with OpenAPI 3.1 spec (jsonSchemaTransform), Swagger UI at /docs
- Sanitized error handler (no stack traces, no internal fields)
- Verification: 8/8 must-haves passed, zero proprietary field names in code/spec

**Fixes applied post-execution:**
- Added `jsonSchemaTransform` to swagger config (spec was dumping raw Zod internals)
- Moved error handler before route registration (wasn't covering child scopes)
- Bypassed Zod response serializer in error handler (prevented double-fault)

**Model profile:** Switched to `quality` (Opus for executors) per user preference

**Next step:** `/gsd:plan-phase 40` — Trade Signals with Generic Labeling

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-19 — Phase 39 complete and verified, model profile set to quality*
