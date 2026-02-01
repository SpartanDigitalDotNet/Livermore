---
phase: 22-admin-ui-control-symbols
plan: 06
subsystem: ui
tags: [react, trpc, tanstack-query, symbols, bulk-import, json, validation]

# Dependency graph
requires:
  - phase: 22-05
    provides: AddSymbolForm component and Symbols page
  - phase: 20-symbol-management
    provides: symbol.bulkValidate endpoint
  - phase: 19-runtime-commands
    provides: control.executeCommand with bulk-add-symbols command
provides:
  - BulkImportModal component with JSON input, validation preview, and bulk import
  - Complete bulk import workflow on Symbols page
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [JSON paste input with validation, bulk operation preview before commit]

key-files:
  created:
    - apps/admin/src/components/symbols/BulkImportModal.tsx
  modified:
    - apps/admin/src/components/symbols/index.ts
    - apps/admin/src/pages/Symbols.tsx

key-decisions:
  - "Maximum 50 symbols per bulk import (matches API limit)"
  - "Validate all symbols before allowing import"
  - "Show valid/invalid/duplicate count badges in summary"
  - "Allow editing input after validation without closing modal"

patterns-established:
  - "BulkImportModal uses two-phase flow: validate then import"
  - "Import button only enabled when valid symbols exist"
  - "Results list shows price for valid, error for invalid, message for duplicate"

# Metrics
duration: 5min
completed: 2026-02-01
---

# Phase 22 Plan 06: Bulk Import Modal Summary

**BulkImportModal with JSON input, validation preview showing valid/invalid/duplicate status, and bulk import**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-01T16:02:27Z
- **Completed:** 2026-02-01T16:10:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created BulkImportModal component for bulk symbol import
- JSON array input with parse validation
- Bulk validation via symbol.bulkValidate endpoint
- Validation preview with status badges (valid/invalid/duplicate)
- Results list showing price for valid, error for invalid, message for duplicate
- Import via control.executeCommand with bulk-add-symbols command
- Added Bulk Import card to Symbols page with modal trigger

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BulkImportModal component** - `f97a32e` (feat)
2. **Task 2: Add bulk import to Symbols page** - `1fcbaf1` (feat)

## Files Created/Modified

### Created

- `apps/admin/src/components/symbols/BulkImportModal.tsx` - Modal with JSON textarea, validation, preview, and import functionality

### Modified

- `apps/admin/src/components/symbols/index.ts` - Added BulkImportModal export
- `apps/admin/src/pages/Symbols.tsx` - Added Bulk Import card and modal integration (181 lines)

## Key Implementation Details

### BulkImportModal Component

Two-phase workflow:

1. **Input Phase:**
   - JSON textarea with placeholder example
   - Parse validation (array check, non-empty, max 50, all strings)
   - "Validate Symbols" button triggers bulkValidate query

2. **Preview Phase:**
   - Summary badges showing counts (green valid, red invalid, yellow duplicate)
   - Results list with status icons and details:
     - Valid: green checkmark + price
     - Invalid: red X + error message
     - Duplicate: yellow warning + "Already in watchlist"
   - "Edit Input" button returns to input phase
   - "Import N Symbols" button executes bulk-add-symbols command

### Symbols Page Integration

- Added side-by-side layout with AddSymbolForm and Bulk Import card
- Bulk Import card has "Import from JSON" button
- Modal triggered by button click
- onImportComplete callback invalidates settings query for refresh

### API Integration

- `trpcClient.symbol.bulkValidate.query()` for validation
- `trpcClient.control.executeCommand.mutate()` with type 'bulk-add-symbols' for import
- Results include added/skipped counts in success toast

## Decisions Made

1. **50 symbol limit** - Matches API constraint, prevents timeout

2. **Two-phase flow** - Validate before import prevents accidental additions

3. **Edit after validate** - User can modify input and re-validate without losing modal state

4. **Summary badges** - Quick visual indicator of validation results

## Deviations from Plan

None - plan executed exactly as written.

## Requirements Covered

- **UI-SYM-04:** User can bulk import via JSON paste, validate, preview, and import
- Valid/invalid/duplicate symbols clearly distinguished
- Import adds only valid symbols
- Watchlist updates after bulk import

## Next Phase Readiness

Phase 22 (Admin UI - Control + Symbols) complete with all 6 plans:
- 22-01: Page shells and shadcn components
- 22-02: Control panel commands and confirmation dialog
- 22-03: Logs page with filtering and auto-refresh
- 22-04: Symbol watchlist display
- 22-05: Add symbol form
- 22-06: Bulk import modal

All UI requirements for v4.0 milestone are complete.

---
*Phase: 22-admin-ui-control-symbols*
*Completed: 2026-02-01*
