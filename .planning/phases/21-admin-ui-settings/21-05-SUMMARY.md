---
phase: 21-admin-ui-settings
plan: 05
subsystem: admin-ui
tags: [react, modal, toast, save-discard, diff-preview, zod-validation]

dependency-graph:
  requires: [21-04]
  provides: [settings-save-workflow, diff-preview-modal]
  affects: []

tech-stack:
  added: []
  patterns:
    - Modal with backdrop click to close
    - useMutation for save operation with optimistic invalidation
    - Key prop to force component remount on discard
    - Zod validation before diff modal display

file-tracking:
  key-files:
    created:
      - apps/admin/src/components/settings/SettingsDiffModal.tsx
    modified:
      - apps/admin/src/pages/Settings.tsx
      - apps/admin/src/components/settings/index.ts

decisions:
  - id: "21-05-01"
    choice: "Validate with Zod before showing diff modal"
    rationale: "Prevents user from reviewing invalid settings that would fail on save"
  - id: "21-05-02"
    choice: "Use splitViewKey ref to force remount on discard"
    rationale: "Cleanest way to reset SettingsSplitView to initialSettings without complex state management"
  - id: "21-05-03"
    choice: "Toast notifications for all user actions"
    rationale: "Clear feedback on success, error, and discard operations"

metrics:
  duration: "~4.5 minutes"
  completed: "2026-02-01"
---

# Phase 21 Plan 05: Save/Discard with Diff Preview Summary

Complete settings save workflow with Zod validation, diff preview modal, and toast notifications.

## What Was Built

### Task 1: SettingsDiffModal component
Created `apps/admin/src/components/settings/SettingsDiffModal.tsx` (85 lines):
- Modal wrapper for SettingsDiffView with confirm/cancel actions
- Shows side-by-side comparison of original vs modified settings
- Loading state support during save operation (isSaving prop)
- Backdrop click closes modal
- Accessible with proper ARIA attributes

### Task 2: Complete Settings page with save/discard and toasts
Updated `apps/admin/src/pages/Settings.tsx` (192 lines):
- Save button validates with Zod before showing diff modal
- Validation errors displayed above split view and in error toast
- Diff modal shows original vs modified before confirm
- useMutation calls trpcClient.settings.update.mutate
- onSuccess invalidates query and shows success toast
- onError shows error toast with message
- Discard uses splitViewKey ref to force SettingsSplitView remount
- Save/Discard buttons only visible when isDirty is true

### Task 3: Index export and verification
Updated `apps/admin/src/components/settings/index.ts`:
- Added SettingsDiffModal export
- TypeScript compilation passes
- Admin app build successful

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Zod validation before diff modal | Prevents reviewing invalid settings that would fail on save anyway |
| splitViewKey ref for discard | Forces clean remount without complex state reset logic |
| toast.info for discard | Info level (not success) feels appropriate for reverting changes |
| queryClient.invalidateQueries on success | Ensures UI shows saved values from server, not local state |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- TypeScript compilation: PASS
- Admin app build: PASS
- SettingsDiffModal.tsx: 85 lines (min 60 required)
- Settings.tsx: 192 lines (min 120 required)
- Key links verified:
  - Settings.tsx -> trpcClient.settings.update.mutate
  - Settings.tsx -> toast.success/error/info
  - SettingsDiffModal -> SettingsDiffView import

## Commits

| Hash | Type | Description |
|------|------|-------------|
| bbc935b | feat | Add SettingsDiffModal component |
| 1817fb1 | feat | Complete Settings page with save/discard and toasts |
| 06d49e7 | feat | Export SettingsDiffModal from settings index |

## Phase 21 Completion

All UI-SET requirements satisfied:
- UI-SET-01: Form-based settings editing (21-02)
- UI-SET-02: JSON editor for power users (21-03)
- UI-SET-03: Side-by-side view with bidirectional sync (21-04)
- UI-SET-04: Diff view shows changes before saving (21-05)
- UI-SET-05: Save/discard buttons with validation error display (21-05)
- UI-SET-06: Loading states and success/error toasts (21-05)

## Success Criteria Verification

| Criterion | Status |
|-----------|--------|
| User can click Save to open diff view before committing | PASS |
| User can see side-by-side comparison of original vs modified | PASS |
| User can confirm save and see success toast | PASS |
| User can discard changes and revert to original | PASS |
| User sees error toast if save fails | PASS |
| Validation errors prevent save and show clear message | PASS |
