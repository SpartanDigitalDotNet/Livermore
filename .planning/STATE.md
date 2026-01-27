# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Data accuracy and timely alerts
**Current focus:** v3.0 Admin UI + IAM Foundation

## Current Position

**Milestone:** v3.0 Admin UI + IAM Foundation
**Phase:** 16 - Kaia Handoff (Complete)
**Plan:** N/A (documentation phase)
**Status:** MILESTONE COMPLETE
**Last activity:** 2026-01-27 - Created KAIA-IAM-HANDOFF.md

**Progress:** [####################] 20/20 requirements (100%)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Shipped | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Shipped | 2026-01-27 |

See `.planning/MILESTONES.md` for full history.

## v3.0 Phase Summary

| Phase | Name | Status | Requirements |
|-------|------|--------|--------------|
| 11 | Database Workflow | Complete | DB-01, DB-02, DB-03, DB-04 |
| 12 | IAM Schema | Complete | IAM-01 to IAM-06 |
| 13 | Clerk Authentication | Complete | AUTH-01, AUTH-02, AUTH-03 |
| 14 | User Sync Webhooks | Complete | AUTH-04, AUTH-05 |
| 15 | Admin UI | Complete | UI-01, UI-02, UI-03, UI-04 |
| 16 | Kaia Handoff | Complete | DOC-01 |

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

### User Sync Webhooks Decisions (2026-01-27)

| Decision | Rationale |
|----------|-----------|
| Register webhook route BEFORE clerkPlugin | Webhook is server-to-server, has no JWT token; routes after clerkPlugin require JWT |
| Check-then-update instead of onConflictDoUpdate | Partial unique index doesn't work with Drizzle's onConflictDoUpdate |
| Timestamp mode 'string' in users schema | Ensures ISO string compatibility with lastLoginAt from Clerk |

### Logs Router Decisions (2026-01-27)

| Decision | Rationale |
|----------|-----------|
| Use protectedProcedure for logs endpoints | Logs may contain sensitive operational data |
| Level filtering with hierarchy | ERROR only, WARN+ERROR, INFO+WARN+ERROR, all - standard log filtering pattern |

### Admin UI Decisions (2026-01-27)

| Decision | Rationale |
|----------|-----------|
| createTRPCOptionsProxy with queryClient | tRPC v11 requires queryClient passed to options proxy |
| Add @types/pg to API and database packages | Fixed pnpm duplicate drizzle-orm instances from peer dep mismatch |
| Export queryClient from trpc.ts | Single QueryClient instance shared between tRPC and React Query providers |

## Session Continuity

### Last Session

**Date:** 2026-01-27
**Activity:** Completed v3.0 milestone - all 6 phases delivered
**Stopped At:** Milestone complete

### Resume Context

**v3.0 MILESTONE COMPLETE**

All phases delivered:
- Phase 11: Database Workflow (Atlas migrations, sync scripts)
- Phase 12: IAM Schema (OAuth columns, role-based access)
- Phase 13: Clerk Authentication (Fastify plugin, tRPC context)
- Phase 14: User Sync Webhooks (automatic user creation/updates)
- Phase 15: Admin UI (Vite + React + Clerk + tRPC)
- Phase 16: Kaia Handoff (`docs/KAIA-IAM-HANDOFF.md`)

**Next milestone:** v3.1 (API authentication for PerseusWeb, trading contracts)

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-27 - v3.0 milestone complete*
