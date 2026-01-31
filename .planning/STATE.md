# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Data accuracy and timely alerts
**Current focus:** v4.0 User Settings + Runtime Control

## Current Position

**Milestone:** v4.0 User Settings + Runtime Control
**Phase:** 19 (Runtime Commands) - COMPLETE
**Plan:** 03 of 3 complete
**Status:** Phase complete, ready for Phase 20

```
Progress: [=======...] 66%
Phases:   17 [X] 18 [X] 19 [X] 20 [ ] 21 [ ] 22 [ ]
```

**Last activity:** 2026-01-31 - Completed 19-03-PLAN.md (Remaining Command Handlers)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Shipped | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Shipped | 2026-01-30 |
| v4.0 | User Settings + Runtime Control | In Progress | -- |

See `.planning/MILESTONES.md` for full history.

## v4.0 Phase Summary

| Phase | Goal | Requirements | Status |
|-------|------|--------------|--------|
| 17 | Settings Infrastructure | SET-01 to SET-07 | Complete (SET-01 to SET-07) |
| 18 | Control Channel Foundation | RUN-01,02,03,10,11,12,13 | Complete (RUN-01,02,03,10,11,12,13) |
| 19 | Runtime Commands | RUN-04 to RUN-09 | Complete (RUN-04 to RUN-09) |
| 20 | Symbol Management | SYM-01 to SYM-06 | Pending |
| 21 | Admin UI - Settings | UI-SET-01 to UI-SET-06 | Pending |
| 22 | Admin UI - Control + Symbols | UI-CTL-*, UI-SYM-* | Pending |

## Tech Debt from v3.0

Carried forward from milestone audit:

| Issue | Priority | Impact |
|-------|----------|--------|
| indicator.router.ts uses publicProcedure | High | Unprotected API access |
| alert.router.ts uses publicProcedure | High | Unprotected API access |
| position.router.ts uses publicProcedure | High | Unprotected API access |
| UserRole/isValidRole/assertRole unused | Low | RBAC not enforced |

**Note:** Router auth hardening deferred to v4.1 per requirements.

## Accumulated Context

### Technical Discoveries (from v1.0)

- Coinbase List Orders endpoint uses cursor-based pagination with `has_next` flag
- Fee tier info available via getTransactionSummary() (already implemented)
- Order `total_fees` field contains aggregated fees per order

### v2.0 Architecture (Shipped 2026-01-24)

```
WebSocket Layer (CoinbaseAdapter)
    |
    | Native 5m candles + ticker from Coinbase channels
    v
+-------------------+
|   Redis Cache     |<-- Backfill Service (startup)
+-------------------+<-- BoundaryRestService (15m/1h/4h/1d at boundaries)
    |
    | candle:close events + ticker pub/sub
    v
Indicator Service (cache-only reads)
    |
    v
Alert Evaluation (receives ticker prices)
```

### Hard Constraints (User-Specified)

| Constraint | Reason |
|------------|--------|
| **NO cron jobs** | User explicitly rejected node-cron approach |
| **NO aggregation** | User stated "Don't suggest aggregate to me ever again" |
| **Zero 429 errors** | Core reliability requirement |
| **Atlas-only migrations** | Drizzle migrations BANNED - schema.sql is source of truth |
| **SSL required** | Azure PostgreSQL requires SSL - hardcode, don't use env vars |

### v3.0 Key Decisions

| Decision | Rationale |
|----------|-----------|
| Webhook before clerkPlugin | Server-to-server route has no JWT |
| Check-then-update for upsert | Partial unique index doesn't work with onConflictDoUpdate |
| protectedProcedure only for new routers | Existing routers left as publicProcedure (tech debt) |
| Pre-flight connection validation | Fail fast if database/Redis unavailable |

### v4.0 Key Decisions (from research)

| Decision | Rationale |
|----------|-----------|
| Settings as JSONB | Single column with version field for schema evolution |
| Redis pub/sub for control | Existing ioredis, no new dependencies needed |
| Control plane vs data plane | Control channel always on, data plane pausable |
| Admin calls exchange API | Delta-based symbol validation from Admin, not API |
| Credentials in env vars | Settings store env var names, not actual secrets |

### Open Items

- Low-volume symbol policy: Include or exclude symbols with < 100 candles?

## Session Continuity

### Last Session

**Date:** 2026-01-31
**Activity:** Completed plan 19-03 (Remaining Command Handlers)
**Stopped At:** Phase 19 complete, ready for Phase 20

### Resume Context

**PHASE 19 COMPLETE**

Plan 19-03 completed (Remaining Command Handlers):
- Implemented reload-settings (RUN-06): Fetches settings from database via identitySub
- Implemented switch-mode (RUN-07): Validates mode, returns stub response
- Implemented force-backfill (RUN-08): Uses StartupBackfillService + indicator recalculation
- Implemented clear-cache (RUN-09): Supports all/symbol/timeframe scopes
- Commits: 00f4d18, cc8efae, 008bf72

All Phase 19 requirements (RUN-04 to RUN-09) are now complete.

Next steps:
1. Execute Phase 20 (Symbol Management)
   - SYM-01 to SYM-06: Exchange symbol lookup, validation, storage
   - add-symbol / remove-symbol handlers will be completed here

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-31 - Completed 19-03-PLAN.md (Remaining Command Handlers)*
