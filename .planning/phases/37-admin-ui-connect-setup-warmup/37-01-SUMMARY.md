---
phase: 37-admin-ui-connect-setup-warmup
plan: 01
subsystem: admin-ui
tags: [admin-ui, network-page, connect-button, lock-warning]
dependencies:
  requires: [network.getExchangeStatus, control.executeCommand]
  provides: [ConnectButton, LockWarningModal]
  affects: [InstanceCard, Network page]
tech-stack:
  added: []
  patterns: [tRPC imperative client, modal dialogs, conditional rendering]
key-files:
  created:
    - apps/admin/src/components/network/ConnectButton.tsx
    - apps/admin/src/components/network/LockWarningModal.tsx
  modified:
    - apps/admin/src/components/network/InstanceCard.tsx
    - apps/admin/src/components/network/index.ts
key-decisions:
  - decision: Use trpcClient directly for imperative calls instead of hooks
    rationale: Lock check and connect are imperative actions triggered by button click, not reactive queries
  - decision: Show ConnectButton for offline, idle, and stopped states only
    rationale: Active, starting, warming, and stopping states indicate exchange is in use and should not show connect
  - decision: Place ConnectButton in card footer with border separation
    rationale: Visual separation from status info, consistent card layout pattern
metrics:
  duration_seconds: 214
  tasks_completed: 2
  files_created: 2
  files_modified: 2
  commits: 2
  lines_added: 268
  completed_at: 2026-02-13
---

# Phase 37 Plan 01: Connect Button with Lock Check Summary

JWT auth with refresh rotation using jose library

## Overview

Added "Connect" button to exchange instance cards on the Network page. When clicked, checks if the exchange is already running on another machine and shows a warning modal with lock holder info (hostname, IP, connected-since timestamp) requiring explicit confirmation before proceeding.

## Implementation Details

### ConnectButton Component

Created `apps/admin/src/components/network/ConnectButton.tsx`:
- Accepts `exchangeId`, `exchangeName`, and optional `disabled` props
- On click: queries `network.getExchangeStatus` to check current lock status
- If exchange is online and NOT idle/stopped: opens LockWarningModal with lock holder info
- If exchange is offline/idle/stopped: directly calls `control.executeCommand` with 'start' type
- Uses `trpcClient` directly for imperative API calls (not hooks)
- On success: shows toast notification and invalidates network queries for immediate UI refresh
- Loading state shows spinner, disabled during operation

### LockWarningModal Component

Created `apps/admin/src/components/network/LockWarningModal.tsx`:
- Dialog component displaying warning when exchange is already connected elsewhere
- Shows lock holder information in styled amber info box:
  - Hostname
  - IP Address (or "Unknown")
  - Connected since timestamp (formatted as locale string)
- Warning text explains takeover will disconnect the other instance
- Two action buttons:
  - "Cancel" (outline variant) - closes modal, cancels operation
  - "Connect Anyway" (destructive variant) - confirms takeover, proceeds with start command

### InstanceCard Integration

Modified `apps/admin/src/components/network/InstanceCard.tsx`:
- Added conditional logic to determine if exchange is connectable
- `isConnectable = !online OR status.connectionState === 'idle' OR status.connectionState === 'stopped'`
- Renders ConnectButton in card footer (px-6 pb-4 pt-3) with top border for visual separation
- Button only appears for exchanges in connectable states
- Active/warming/starting/stopping exchanges do not show the button

### Barrel File Update

Modified `apps/admin/src/components/network/index.ts`:
- Exported ConnectButton and LockWarningModal components
- Maintains existing InstanceCard and ActivityFeed exports

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. TypeScript compilation passes with zero errors in network components
2. ConnectButton component exists and exports from barrel file
3. LockWarningModal component exists with hostname/IP/connectedAt display
4. InstanceCard conditionally renders ConnectButton for offline/idle/stopped states
5. ConnectButton calls `network.getExchangeStatus` before `control.executeCommand`
6. LockWarningModal has Cancel and "Connect Anyway" (destructive) buttons

## Requirements Fulfilled

- **ADM-01**: Instance cards for offline/idle exchanges display a Connect button
- **ADM-02**: Clicking Connect on an in-use exchange shows the lock warning modal with hostname, IP, connected-since before proceeding
- Connect button fires the 'start' command with exchange name payload
- No TypeScript compilation errors in network components

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| e0f8afb | feat(37-01): create ConnectButton and LockWarningModal components | ConnectButton.tsx, LockWarningModal.tsx, index.ts |
| 3580e03 | feat(37-01): wire ConnectButton into InstanceCard | InstanceCard.tsx |

## Self-Check: PASSED

All created files verified:
- FOUND: apps/admin/src/components/network/ConnectButton.tsx
- FOUND: apps/admin/src/components/network/LockWarningModal.tsx
- FOUND: apps/admin/src/components/network/InstanceCard.tsx (modified)
- FOUND: apps/admin/src/components/network/index.ts (modified)

All commits verified:
- FOUND: e0f8afb (Task 1)
- FOUND: 3580e03 (Task 2)
