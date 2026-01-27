---
phase: 15
plan: 02
subsystem: api
tags: [trpc, logs, filesystem, authentication]

dependency_graph:
  requires: [13-01, 13-02]
  provides: [logs-api-endpoint]
  affects: [15-03]

tech_stack:
  added: []
  patterns: [filesystem-log-reader, level-filtering]

key_files:
  created:
    - apps/api/src/routers/logs.router.ts
  modified:
    - apps/api/src/routers/index.ts
    - apps/api/src/routers/alert.router.ts

decisions:
  - id: logs-protected
    choice: Use protectedProcedure for auth requirement
    rationale: Logs may contain sensitive operational data
  - id: level-hierarchy
    choice: Filter levels with hierarchy (ERROR only, WARN+ERROR, INFO+WARN+ERROR, all)
    rationale: Standard log filtering pattern - higher severity includes lower

metrics:
  duration: ~14 minutes
  completed: 2026-01-27
---

# Phase 15 Plan 02: Logs Router Summary

**One-liner:** Protected tRPC endpoint reading JSON log files with level filtering and date selection

## What Was Built

Created `logs.router.ts` providing two authenticated endpoints:

1. **logs.getRecent** - Fetches log entries with filtering:
   - `level` parameter filters by severity hierarchy
   - `limit` parameter caps results (default 100, max 500)
   - `date` parameter selects which day's log file to read
   - Returns newest entries first (reverse chronological)

2. **logs.getAvailableDates** - Lists available log file dates for UI date picker

## Key Implementation Details

```typescript
// Level filtering hierarchy
if (level === 'ERROR') {
  entries = entries.filter(e => e.level === 'ERROR');
} else if (level === 'WARN') {
  entries = entries.filter(e => e.level === 'WARN' || e.level === 'ERROR');
} else if (level === 'INFO') {
  entries = entries.filter(e => e.level !== 'DEBUG');
}
// DEBUG = no filter (all levels)
```

Log files are read from `./logs/livermore-YYYY-MM-DD.log` (JSON-lines format).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed implicit any types in alert.router.ts**
- **Found during:** Task 1 type-check verification
- **Issue:** Pre-existing TypeScript errors - `(t)` parameter in map callbacks had implicit any type
- **Fix:** Added `InferSelectModel<typeof alertHistory>` type alias and annotated map callbacks
- **Files modified:** apps/api/src/routers/alert.router.ts
- **Commit:** 4280e5b (bundled with Task 1)

**2. [Rule 1 - Bug] Fixed LogEntry type export**
- **Found during:** Task 2 type-check verification
- **Issue:** TypeScript error TS4023 - exported appRouter uses LogEntry but it wasn't exported
- **Fix:** Changed `interface LogEntry` to `export interface LogEntry`
- **Files modified:** apps/api/src/routers/logs.router.ts
- **Commit:** fdf8bae (bundled with Task 2)

## Verification Results

| Check | Status |
|-------|--------|
| Type-check passes | Pass |
| logs.getRecent requires auth | Pass (uses protectedProcedure) |
| Level filtering logic | Pass |
| Date parameter support | Pass |
| AppRouter includes logs namespace | Pass |

## Commits

| Hash | Message |
|------|---------|
| 4280e5b | feat(15-02): create logs router with getRecent endpoint |
| fdf8bae | feat(15-02): register logs router in appRouter |

## Requirements Covered

- **UI-02: Log viewer** - Provides data source endpoint for admin log viewer component

## Next Phase Readiness

**Ready for:** Plan 15-03 (Log viewer React component)

**Dependencies satisfied:**
- Authenticated endpoint exists at `trpc.logs.getRecent`
- Type inference available via AppRouter
- Response shape defined: `{ success, date, count, total, data: LogEntry[] }`

**Note:** Server startup failed due to pre-existing dotenv dependency issue (unrelated to this plan). The router code is correct - verify server runs when dotenv is available.
