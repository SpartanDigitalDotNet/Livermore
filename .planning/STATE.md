# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Data accuracy and timely alerts
**Current focus:** v3.0 Admin UI + IAM Foundation

## Current Position

**Milestone:** v3.0 Admin UI + IAM Foundation
**Phase:** 11 - Database Workflow (Pending)
**Plan:** Not yet created
**Status:** Roadmap complete, awaiting phase planning
**Last activity:** 2026-01-26 - Roadmap created

**Progress:** [....................] 0/20 requirements (0%)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Shipped | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | In Progress | - |

See `.planning/MILESTONES.md` for full history.

## v3.0 Phase Summary

| Phase | Name | Status | Requirements |
|-------|------|--------|--------------|
| 11 | Database Workflow | Pending | DB-01, DB-02, DB-03, DB-04 |
| 12 | IAM Schema | Pending | IAM-01 to IAM-06 |
| 13 | Clerk Authentication | Pending | AUTH-01, AUTH-02, AUTH-03 |
| 14 | User Sync Webhooks | Pending | AUTH-04, AUTH-05 |
| 15 | Admin UI | Pending | UI-01, UI-02, UI-03, UI-04 |
| 16 | Kaia Handoff | Pending | DOC-01 |

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

### Clerk Integration Research (2026-01-26)

Research completed for v3.0. Key findings:
- `@clerk/fastify@2.6.14` compatible with Fastify 5.2.2
- Critical: `dotenv/config` must be imported BEFORE `@clerk/fastify`
- tRPC integration via `getAuth(req)` in createContext
- Webhook verification via `svix` package

See `.planning/research/CLERK-INTEGRATION.md` for full details.

### Open Items

- Low-volume symbol policy: Include or exclude symbols with < 100 candles?

## Session Continuity

### Last Session

**Date:** 2026-01-26
**Activity:** v3.0 roadmap creation
**Stopped At:** Roadmap created, ready for phase planning

### Resume Context

**v3.0 Admin UI + IAM Foundation roadmap is complete.**

**6 phases mapped (Phases 11-16):**
1. Phase 11: Database Workflow (4 requirements) - Atlas sandbox, deployment scripts
2. Phase 12: IAM Schema (6 requirements) - OAuth identity columns on users table
3. Phase 13: Clerk Authentication (3 requirements) - Fastify plugin, tRPC context
4. Phase 14: User Sync Webhooks (2 requirements) - user.created, user.updated
5. Phase 15: Admin UI (4 requirements) - MACD-V viewer, logs, signals, sign-in
6. Phase 16: Kaia Handoff (1 requirement) - Documentation for PerseusWeb

**Coverage:** 20/20 requirements mapped (100%)

**Next:** Plan Phase 11 (Database Workflow)

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-26 after v3.0 roadmap creation*
