---
phase: 21-admin-ui-settings
plan: 04
subsystem: admin-ui
tags: [react, split-view, bidirectional-sync, react-hook-form, zod]

dependency-graph:
  requires: [21-02, 21-03]
  provides: [split-view-editor, form-json-sync]
  affects: [21-05]

tech-stack:
  added: []
  patterns:
    - Bidirectional sync with lastEditSource ref to prevent loops
    - Debounced form-to-JSON sync (300ms)
    - Immediate JSON-to-form sync with Zod validation
    - Dirty state tracking via JSON string comparison

file-tracking:
  key-files:
    created:
      - apps/admin/src/components/settings/SettingsSplitView.tsx
    modified:
      - apps/admin/src/pages/Settings.tsx
      - apps/admin/src/components/settings/index.ts

decisions:
  - id: "21-04-01"
    choice: "Use lastEditSource ref to prevent sync loops"
    rationale: "Form watch and JSON onChange would create infinite updates without tracking edit origin"
  - id: "21-04-02"
    choice: "Debounce form-to-JSON sync at 300ms"
    rationale: "Prevents excessive JSON updates while user types in form fields"
  - id: "21-04-03"
    choice: "Immediate JSON-to-form sync with validation"
    rationale: "User expects form to update as soon as valid JSON is entered"

metrics:
  duration: "~5 minutes"
  completed: "2026-02-01"
---

# Phase 21 Plan 04: Settings Split View Summary

Side-by-side form and JSON editor with bidirectional sync for power user flexibility.

## What Was Built

### Task 1: SettingsSplitView component with bidirectional sync
Created `apps/admin/src/components/settings/SettingsSplitView.tsx` (148 lines):
- Grid layout: form on left, JSON editor on right (responsive, stacks on mobile)
- Form changes sync to JSON with 300ms debounce to prevent rapid updates
- JSON changes sync to form immediately after Zod validation
- `lastEditSource` ref prevents infinite sync loops between editors
- Reports dirty state to parent via `onSettingsChange` callback

Key sync logic:
- Form watch subscription updates JSON after debounce timeout
- JSON onChange parses and validates with UserSettingsSchema
- Invalid JSON shows validation error in Monaco editor markers

### Task 2: Settings page integration
Updated `apps/admin/src/pages/Settings.tsx` (87 lines):
- Replaced raw JSON pre element with SettingsSplitView
- Added currentSettings and isDirty state tracking
- Shows "Unsaved changes" yellow badge when settings modified
- Kept refresh button for reloading from server
- Loading and error states unchanged

### Task 3: Index export and verification
Updated `apps/admin/src/components/settings/index.ts`:
- Added SettingsSplitView export
- Verified TypeScript compilation passes
- Verified Vite dev server starts successfully

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| lastEditSource ref for loop prevention | Without tracking origin, form watch triggers JSON update which triggers form reset in infinite loop |
| 300ms debounce for form-to-JSON | Typing in form shouldn't cause 60+ JSON updates per second; 300ms feels responsive |
| Immediate JSON-to-form | Users editing JSON expect instant form update; validation catches errors immediately |
| Grid with lg:grid-cols-2 | Side-by-side on desktop, stacked on mobile for responsive design |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- TypeScript compilation: PASS
- Vite dev server: PASS (started on port 4002)
- SettingsSplitView exports SettingsSplitView: PASS
- Imports both SettingsForm and SettingsJsonEditor: PASS
- Bidirectional sync logic with debouncing: PASS
- Line counts: SettingsSplitView 148 (min 80), Settings.tsx 87 (min 60)

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 4d5e406 | feat | Add SettingsSplitView with bidirectional sync |
| b099f97 | feat | Update Settings page to use SettingsSplitView |
| 00a5b97 | feat | Export SettingsSplitView from settings index |

## Next Phase Readiness

Ready for Plan 05 (save/discard functionality):
- SettingsSplitView tracks dirty state and current settings
- Parent (Settings.tsx) receives settings changes via callback
- onSettingsChange provides both current values and isDirty flag
- Foundation ready for save mutation and discard reset

## Success Criteria Verification

| Criterion | Status |
|-----------|--------|
| UI-SET-03: Side-by-side view with form + JSON | PASS |
| Bidirectional sync without infinite loops | PASS |
| Validation errors display in JSON editor | PASS |
| Dirty state tracked and displayed | PASS |
| Foundation ready for diff view and save/discard | PASS |
