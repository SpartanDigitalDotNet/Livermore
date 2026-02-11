# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-08)

**Core value:** Data accuracy and timely alerts
**Current focus:** v6.0 Perseus Network -- Admin UI Network View

## Current Position

**Milestone:** v6.0 Perseus Network
**Phase:** 33 of 33 (Admin UI Network View) -- Complete
**Plan:** 2 of 2 complete
**Status:** Phase complete

```
Progress: [########.] 88%
Phase 30 [===]  Phase 31 [==]  Phase 32 [ ]  Phase 33 [==]
```

**Last activity:** 2026-02-10 -- Completed 33-01-PLAN.md (Network Page and Components)

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
- Total plans completed: 7
- Average duration: 3m 52s
- Total execution time: 27m 03s

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 30 | 3 | 13m 54s | 4m 38s |
| 31 | 2 | 7m 49s | 3m 55s |
| 33 | 2 | 5m 20s | 2m 40s |

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
- 30-03-D1: Placeholder registry with exchangeId=0 for idle mode (replaced in handleStart)
- 30-03-D2: Fresh InstanceRegistryService in handleStart (immutable exchangeId)
- 30-03-D3: Migrated exchange-symbol.router to new key format (exchange:{id}:status)
- 31-01-D1: networkActivityStreamKey uses exchange name (not ID) with lowercase normalization
- 31-01-D2: BaseLogEntrySchema is internal-only (not exported)
- 31-01-D3: Empty string defaults for ip and adminEmail in logger constructor

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

### Last Session

**Date:** 2026-02-10
**Activity:** Executed 33-01-PLAN.md (Network Page and Components, 2 tasks)
**Stopped At:** Completed 33-01-PLAN.md

### Resume Context

Phase 33 complete. Admin UI Network page is fully functional.

Delivered in 33-01:
- InstanceCard component with color-coded state badges, heartbeat latency, uptime display
- ActivityFeed component with scrollable reverse-chronological event feed
- Network page with dual polling queries (getInstances + getActivityLog) at 5s
- Hash route #/network with nav link between Control and Symbols

Delivered in 33-02:
- StateMachineService.transition() sends fire-and-forget Discord notification
- Notification includes exchange name, from/to states, hostname
- Uses getDiscordService() singleton with isEnabled() check

Remaining for v6.0 Perseus Network:
- Phase 32: 32-01 (tRPC network router) -- code exists but plan not formally executed

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-10 -- Completed 33-01-PLAN.md*
