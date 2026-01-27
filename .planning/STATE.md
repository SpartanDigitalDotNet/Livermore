# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Data accuracy and timely alerts
**Current focus:** v3.0 Admin UI + IAM Foundation

## Current Position

**Milestone:** v3.0 Admin UI + IAM Foundation
**Phase:** 13 - Clerk Authentication (Complete)
**Plan:** 01 of 01 complete
**Status:** Phase complete
**Last activity:** 2026-01-26 - Completed 13-01-PLAN.md

**Progress:** [######..............] 13/20 requirements (65%)

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
| 11 | Database Workflow | Complete | DB-01, DB-02, DB-03, DB-04 |
| 12 | IAM Schema | Complete | IAM-01 to IAM-06 |
| 13 | Clerk Authentication | Complete | AUTH-01, AUTH-02, AUTH-03 |
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
- `@clerk/fastify@2.6.17` compatible with Fastify 5.2.2
- Critical: `dotenv/config` must be imported BEFORE `@clerk/fastify`
- tRPC integration via `getAuth(req)` in createContext
- Webhook verification via `svix` package

See `.planning/research/CLERK-INTEGRATION.md` for full details.

### Open Items

- Low-volume symbol policy: Include or exclude symbols with < 100 candles?

### IAM Schema Decisions (2026-01-26)

| Decision | Rationale |
|----------|-----------|
| Partial unique index on identity_provider/identity_sub | Allows NULL values for non-OAuth users while enforcing uniqueness for OAuth identities |
| Role as VARCHAR(20) with 'user' default | Matches Clerk metadata pattern, allows future role expansion |
| Azure livermore database created | Was missing from sandbox environment |

### Clerk Authentication Decisions (2026-01-26)

| Decision | Rationale |
|----------|-----------|
| Import Clerk types from @clerk/backend/internal | SignedInAuthObject/SignedOutAuthObject not exported from public API |
| Add @clerk/types as explicit dependency | Required for portable type declarations in protectedProcedure |

## Session Continuity

### Last Session

**Date:** 2026-01-26
**Activity:** Completed 13-01-PLAN.md (Clerk authentication integration)
**Stopped At:** Phase 13 complete

### Resume Context

**Phase 13 (Clerk Authentication) complete.**

**Plan delivered:**
- 13-01: @clerk/fastify plugin, tRPC auth context, protectedProcedure middleware

**Next:** Phase 14 (User Sync Webhooks)

**User setup required before testing:**
- Set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY environment variables
- Create Clerk application in Clerk Dashboard (if not already done)

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-26 after 13-01-PLAN.md completion*
