---
phase: 37-admin-ui-connect-setup-warmup
plan: 03
subsystem: admin-ui
tags: [admin-ui, network-page, warmup-progress, real-time-monitoring]
dependencies:
  requires: [network.getWarmupStats, warmupStatsKey, Progress UI component]
  provides: [WarmupProgressPanel, getWarmupStats endpoint]
  affects: [InstanceCard, Network page, network.router]
tech-stack:
  added: []
  patterns: [tRPC query polling, conditional refetchInterval, React Query queryOptions, collapsible details]
key-files:
  created:
    - apps/admin/src/components/network/WarmupProgressPanel.tsx
  modified:
    - apps/api/src/routers/network.router.ts
    - apps/admin/src/components/network/InstanceCard.tsx
    - apps/admin/src/components/network/index.ts
key-decisions:
  - decision: Use conditional refetchInterval based on warmup status
    rationale: Fast polling (2s) during active warmup for real-time feel, slow polling (30s) when complete to avoid hammering Redis
  - decision: Show WarmupProgressPanel for starting and warming states only
    rationale: Warmup happens during these connection states, panel returns null if no stats exist
  - decision: Use HTML details/summary element for collapsible failures list
    rationale: Simple native solution, no additional UI components needed
metrics:
  duration_seconds: 191
  tasks_completed: 2
  files_created: 1
  files_modified: 3
  commits: 2
  lines_added: 212
  completed_at: 2026-02-13
---

# Phase 37 Plan 03: Warmup Progress Display Summary

Real-time warmup progress panel with percent complete, ETA, current symbol, and failure tracking

## Overview

Added a warmup progress panel to the Network page that displays real-time warmup stats during the warmup phase. The panel polls a new tRPC endpoint that reads from the warmup stats Redis key, providing admins with visibility into warmup progress including percent complete, ETA, current symbol being warmed, and any failures encountered.

## Implementation Details

### Task 1: getWarmupStats Endpoint (network.router.ts)

Added `getWarmupStats` query to the network router:
- **Input**: `{ exchangeId: number }`
- **Implementation**:
  - Imports `warmupStatsKey` from `@livermore/cache`
  - Reads Redis key: `redis.get(warmupStatsKey(exchangeId))`
  - Returns `{ stats: null }` if no data exists
  - Parses JSON and returns typed `WarmupStats` object
  - Wraps in try/catch for Redis failure handling
- **Type Safety**: Imports `WarmupStats` type from `@livermore/exchange-core`
- **Error Handling**: Returns `{ stats: null }` on Redis failure or parse error

The endpoint is read-only and does not modify any Redis keys. Stats are written by the SmartWarmupService during warmup execution (Phase 35).

### Task 2: WarmupProgressPanel Component

Created `apps/admin/src/components/network/WarmupProgressPanel.tsx`:

**Component Features:**
1. **Real-time polling**: Uses `useQuery` with `trpc.network.getWarmupStats.queryOptions({ exchangeId })`
2. **Conditional refetchInterval**:
   - Fast poll (2s) during active warmup (`scanning` or `executing` status)
   - Slow poll (30s) when complete/error to avoid hammering Redis
3. **Progress display**: Compact bordered container with `bg-blue-50/50` background
4. **Status badge**: Visual indicator (scanning=outline, executing=warning, complete=success, error=destructive)
5. **Progress bar**: Radix UI Progress component showing `percentComplete` (0-100)
6. **ETA formatting**: Human-readable format (e.g., "~2m 15s remaining")
7. **Current symbol display**: Shows currently warming symbol and timeframe
8. **Summary statistics**: Completed/total pairs, skipped count, failed count
9. **Failure list**: Collapsible HTML `<details>` element showing failures with red text
10. **Null rendering**: Returns `null` if no stats exist

**Integration into InstanceCard:**
- Imported `WarmupProgressPanel` component
- Conditionally renders when `connectionState === 'starting'` OR `connectionState === 'warming'`
- Placed inside CardContent with `mt-3 pt-3 border-t` for visual separation
- The panel itself handles the case where stats don't exist (returns null)

**Barrel Export Update:**
- Added `export { WarmupProgressPanel } from './WarmupProgressPanel';` to `index.ts`

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. TypeScript compilation passes with zero errors for both API and admin apps
2. `getWarmupStats` endpoint exists in `network.router.ts` and reads from `warmupStatsKey`
3. `WarmupProgressPanel` component uses `trpc.network.getWarmupStats.queryOptions`
4. Progress bar uses the existing Progress UI component from Radix
5. Component shows percent complete, ETA, current symbol, and failures
6. Conditional refetchInterval logic: fast (2s) during active warmup, slow (30s) when complete
7. Panel renders on InstanceCard only when connectionState is `starting` or `warming`
8. Failures are displayed in collapsible list when present

## Requirements Fulfilled

- **WARM-06**: Admin UI subscribes to warmup stats for the lifetime of the warmup process, displaying real-time progress
- Progress bar shows percent complete with ETA
- Current symbol being warmed is visible
- Failure list is displayed if any failures occur
- No TypeScript compilation errors

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| 1e00f6c | feat(37-03): add getWarmupStats endpoint to network router | network.router.ts |
| 0a2b918 | feat(37-03): create WarmupProgressPanel and integrate into InstanceCard | WarmupProgressPanel.tsx, InstanceCard.tsx, index.ts |

## Self-Check: PASSED

All created files verified:
- FOUND: apps/admin/src/components/network/WarmupProgressPanel.tsx
- FOUND: apps/api/src/routers/network.router.ts (modified)
- FOUND: apps/admin/src/components/network/InstanceCard.tsx (modified)
- FOUND: apps/admin/src/components/network/index.ts (modified)

All commits verified:
- FOUND: 1e00f6c (Task 1)
- FOUND: 0a2b918 (Task 2)
