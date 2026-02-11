---
phase: 33-admin-ui-network-view
plan: 01
subsystem: admin-ui
tags: [react, trpc, network-dashboard, polling, tailwind]

dependency-graph:
  requires: [32-01]
  provides: [network-page, instance-cards, activity-feed]
  affects: []

tech-stack:
  added: []
  patterns: [component-props-from-page, hash-routing, 5s-polling]

key-files:
  created:
    - apps/admin/src/components/network/InstanceCard.tsx
    - apps/admin/src/components/network/ActivityFeed.tsx
    - apps/admin/src/components/network/index.ts
    - apps/admin/src/pages/Network.tsx
  modified:
    - apps/admin/src/App.tsx

decisions: []

metrics:
  duration: 3m 20s
  completed: 2026-02-10
---

# Phase 33 Plan 01: Network Page and Components Summary

**Admin UI Network dashboard with instance cards, heartbeat latency, uptime, and activity feed using tRPC polling at 5s**

## What Was Done

### Task 1: InstanceCard and ActivityFeed Components
Created `apps/admin/src/components/network/` with three files:

**InstanceCard.tsx** -- Displays exchange instance status in a Card with:
- Connection state Badge (7 states mapped: active=success, starting=outline-blue, warming=warning, stopping=warning, stopped=secondary, idle=secondary, offline=destructive)
- Heartbeat latency with color coding: green (<10s), yellow (<30s), red (>=30s)
- Uptime display from connectedAt ("Running for Xh Ym")
- Grid layout showing hostname, IP, admin name, symbol count
- Offline state shows "No active connection"

**ActivityFeed.tsx** -- Scrollable reverse-chronological feed:
- max-h-96 overflow-y-auto container
- State transitions: green CheckCircle icon, "exchange: fromState -> toState"
- Errors: red AlertTriangle icon, "exchange: error message"
- Timestamps from Redis stream IDs formatted as relative time
- Loading spinner and empty state handling

**index.ts** -- Barrel exports for InstanceCard and ActivityFeed.

### Task 2: Network Page and App.tsx Routing
**Network.tsx** -- Page component with:
- Two polling queries (getInstances and getActivityLog) at refetchInterval: 5000
- Summary header showing "X of Y online"
- Responsive grid (1/2/3 cols) of InstanceCard components
- ActivityFeed below the grid
- Error state (red bg-red-50 card) and loading state (spinner)

**App.tsx** -- Modified to add:
- Import for Network component
- Nav link "Network" between "Control" and "Symbols" with active state highlighting
- HashRouter case `'#/network'` returning `<Network />`

## Verification Results

- TypeScript compilation: only pre-existing error in ControlPanel.tsx (ConnectionState 'starting' not in RuntimeStatus union). No errors from new files.
- `#/network` appears 3 times in App.tsx (href, className, case)
- `refetchInterval: 5000` appears twice in Network.tsx
- Both tRPC queries (getInstances, getActivityLog) present
- No `@livermore/schemas` imports in network components

## Deviations from Plan

None -- plan executed exactly as written.

## Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| UI-01 | Done | Network nav link in header, hash route |
| UI-02 | Done | InstanceCard with all fields |
| UI-03 | Done | Offline shows destructive badge |
| UI-04 | Done | ActivityFeed with max-h-96 scroll |
| UI-05 | Done | Both queries at 5000ms refetchInterval |
| DIFF-01 | Done | formatUptime from connectedAt |
| DIFF-02 | Done | getHeartbeatInfo with green/yellow/red |

## Commits

| Hash | Message |
|------|---------|
| fff555a | feat(33-01): add InstanceCard and ActivityFeed network components |
| f7c63dc | feat(33-01): add Network page with hash routing and 5s polling |
