# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-08)

**Core value:** Data accuracy and timely alerts
**Current focus:** v6.0 Perseus Network -- Instance Registration and Health

## Current Position

**Milestone:** v6.0 Perseus Network
**Phase:** 30 of 33 (Instance Registry and State Machine)
**Plan:** 2 of 3 complete
**Status:** In progress

```
Progress: [######....] 17%
Phase 30 [==.]  Phase 31 [ ]  Phase 32 [ ]  Phase 33 [ ]
```

**Last activity:** 2026-02-10 -- Completed 30-02-PLAN.md (Core Services: StateMachine + InstanceRegistry)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Archived | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Archived | 2026-01-30 |
| v4.0 | User Settings + Runtime Control | Archived | 2026-02-06 |
| v5.0 | Distributed Exchange Architecture | Archived | 2026-02-08 |
| v6.0 | Perseus Network | In Progress | - |

See `.planning/MILESTONES.md` for full history.

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 4m 12s
- Total execution time: 8m 24s

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 30 | 2 | 8m 24s | 4m 12s |

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

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- 30-01-D1: adminEmail/adminDisplayName nullable in InstanceStatus (user identity unavailable at registration)
- 30-01-D2: Key pattern `exchange:{id}:status` (consistent with existing exchange-scoped keys)
- 30-01-D3: Separate HEARTBEAT_TTL_SECONDS constant (Redis EX takes seconds, not ms)
- 30-02-D1: Self-restart detection uses hostname match, not full instanceId (PID/timestamp change on restart)
- 30-02-D2: setAdminInfo/setSymbolCount defer Redis write to next heartbeat (reduces round-trips)
- 30-02-D3: Register retries on NX fail + GET null race (key can expire between operations)

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

### Last Session

**Date:** 2026-02-10
**Activity:** Executed 30-02-PLAN.md (Core Services: StateMachine + InstanceRegistry, 2 tasks)
**Stopped At:** Completed 30-02-PLAN.md

### Resume Context

**30-02 COMPLETE**

Core services created: StateMachineService (validated transitions, legacy state mapping) and InstanceRegistryService (atomic claims, heartbeat, KEEPTTL updates, error recording).
Next: Execute 30-03-PLAN.md (Integration: wire services into adapter-factory lifecycle).

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-10 -- Completed 30-02-PLAN.md*
