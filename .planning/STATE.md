# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Data accuracy and timely alerts
**Current focus:** Planning next milestone

## Current Position

**Milestone:** v4.0 User Settings + Runtime Control — SHIPPED
**Phase:** Complete
**Status:** Ready for next milestone

```
Progress: [==========] 100%
v1.0 [X]  v2.0 [X]  v3.0 [X]  v4.0 [X]
```

**Last activity:** 2026-02-06 — v4.0 milestone archived

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Archived | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Archived | 2026-01-30 |
| v4.0 | User Settings + Runtime Control | Archived | 2026-02-06 |

See `.planning/MILESTONES.md` for full history.

## v4.0 Summary

**Shipped:** 6 phases, 23 plans, 45 requirements

Key features:
- User settings as JSONB with typed Zod schema
- Redis pub/sub control channel
- Runtime commands (pause, resume, reload-settings, etc.)
- Symbol management with exchange validation
- Admin Settings UI (form + JSON, bidirectional sync)
- Admin Control Panel (status, pause/resume, mode switcher)
- Admin Symbols UI (watchlist, add/remove, bulk import)
- Real-time WebSocket alerts with MACD-V colored UI

## Tech Debt (Carried to v4.1)

| Issue | Priority | Impact |
|-------|----------|--------|
| indicator.router.ts uses publicProcedure | High | Unprotected API access |
| alert.router.ts uses publicProcedure | High | Unprotected API access |
| position.router.ts uses publicProcedure | High | Unprotected API access |
| control.getStatus returns mock data | Medium | UI shows mock status |
| switch-mode is a stub | Medium | Mode doesn't actually switch |

## Accumulated Context

### Hard Constraints (User-Specified)

| Constraint | Reason |
|------------|--------|
| **NO cron jobs** | User explicitly rejected node-cron approach |
| **NO aggregation** | User stated "Don't suggest aggregate to me ever again" |
| **Zero 429 errors** | Core reliability requirement |
| **Atlas-only migrations** | Drizzle migrations BANNED - schema.sql is source of truth |
| **SSL required** | Azure PostgreSQL requires SSL - hardcode, don't use env vars |

### v4.0 Key Decisions

| Decision | Rationale |
|----------|-----------|
| Settings as JSONB | Single column with version field for schema evolution |
| Redis pub/sub for control | Existing ioredis, no new dependencies needed |
| Control plane vs data plane | Control channel always on, data plane pausable |
| Admin calls exchange API | Delta-based symbol validation from Admin, not API |
| Credentials in env vars | Settings store env var names, not actual secrets |
| Cast zodResolver for UserSettings | Zod schemas with defaults create type mismatch |
| lastEditSource ref for bidirectional sync | Prevents infinite loops between form and JSON editor |
| splitViewKey ref for discard | Forces clean remount of SettingsSplitView |
| Manual shadcn component creation | Project doesn't use shadcn CLI |
| controlRouter uses protectedProcedure | Auth required for control commands |
| Mock getStatus endpoint | Full implementation requires architecture change |

### Open Items

- Low-volume symbol policy: Include or exclude symbols with < 100 candles?

## Session Continuity

### Last Session

**Date:** 2026-02-06
**Activity:** Completed v4.0 milestone, archived to milestones/
**Stopped At:** Ready for `/gsd:new-milestone`

### Resume Context

**v4.0 MILESTONE COMPLETE — READY FOR NEXT MILESTONE**

v4.0 archived:
- milestones/v4.0-ROADMAP.md
- milestones/v4.0-REQUIREMENTS.md
- milestones/v4.0-MILESTONE-AUDIT.md

Next: Run `/gsd:new-milestone` to start v4.1 (or v5.0)

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-06 — v4.0 milestone archived*
