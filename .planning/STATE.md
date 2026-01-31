# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md

**Core value:** Data accuracy and timely alerts
**Current focus:** v3.1 API Security + Trading Contracts (planning)

## Current Position

**Milestone:** v3.1 (Not Started)
**Phase:** N/A
**Plan:** N/A
**Status:** Ready for milestone planning
**Last activity:** 2026-01-30 - Archived v3.0, prepared for v3.1

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Shipped | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Shipped | 2026-01-30 |
| v3.1 | API Security + Trading Contracts | Planning | — |

See `.planning/MILESTONES.md` for full history.

## Tech Debt from v3.0

Carried forward from milestone audit:

| Issue | Priority | Impact |
|-------|----------|--------|
| indicator.router.ts uses publicProcedure | High | Unprotected API access |
| alert.router.ts uses publicProcedure | High | Unprotected API access |
| position.router.ts uses publicProcedure | High | Unprotected API access |
| UserRole/isValidRole/assertRole unused | Low | RBAC not enforced |

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

### Open Items

- Low-volume symbol policy: Include or exclude symbols with < 100 candles?

## Session Continuity

### Last Session

**Date:** 2026-01-30
**Activity:** Completed v3.0 milestone archival
**Stopped At:** Ready for v3.1 planning

### Resume Context

**v3.0 ARCHIVED**

Milestone files moved to `.planning/milestones/`:
- v3.0-ROADMAP.md
- v3.0-REQUIREMENTS.md
- v3.0-MILESTONE-AUDIT.md

**Next steps for v3.1:**
1. Create ROADMAP.md with v3.1 phases
2. Create REQUIREMENTS.md with security + trading requirements
3. Address tech debt (convert routers to protectedProcedure)
4. Define trading contracts for PerseusWeb

---
*State initialized: 2026-01-18*
*Last updated: 2026-01-30 - v3.0 archived, ready for v3.1*
