---
phase: 22-admin-ui-control-symbols
plan: 05
subsystem: ui
tags: [react, trpc, tanstack-query, symbols, search, validation]

# Dependency graph
requires:
  - phase: 22-04
    provides: SymbolWatchlist, ScannerStatus, SymbolRow components
  - phase: 20-symbol-management
    provides: symbol.search and symbol.validate endpoints
provides:
  - AddSymbolForm component with search, validation preview, and add functionality
  - Complete Symbols page with add/remove workflows
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [debounced search with autocomplete, validation preview before action, union type narrowing for API responses]

key-files:
  created:
    - apps/admin/src/components/symbols/AddSymbolForm.tsx
  modified:
    - apps/admin/src/components/symbols/index.ts
    - apps/admin/src/pages/Symbols.tsx

key-decisions:
  - "Debounce search with 300ms delay to reduce API calls"
  - "Filter search results to exclude symbols already in watchlist"
  - "Use 'metrics in validation' pattern for union type narrowing"
  - "Prevent dialog close during removal to avoid UI inconsistency"

patterns-established:
  - "AddSymbolForm uses debounced search query state pattern"
  - "Validation preview extracts metrics with type guard ('metrics' in validation)"
  - "Add/remove operations invalidate settings query for automatic refresh"

# Metrics
duration: 5min
completed: 2026-02-01
---

# Phase 22 Plan 05: Add Symbol Form Summary

**AddSymbolForm with debounced search, validation preview, and complete add/remove workflow integration**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-01T15:53:40Z
- **Completed:** 2026-02-01T15:59:02Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created AddSymbolForm component with debounced symbol search
- Search shows autocomplete dropdown with Coinbase symbols
- Validation preview displays price, 24h change, and 24h volume before adding
- Clear error messages for invalid symbols
- Integrated AddSymbolForm into Symbols page
- Improved remove confirmation flow with proper loading state

## Task Commits

Each task was committed atomically:

1. **Task 1: Create AddSymbolForm component** - `531205b` (feat)
2. **Task 2: Integrate into Symbols page** - `3305737` (feat)

## Files Created/Modified

### Created

- `apps/admin/src/components/symbols/AddSymbolForm.tsx` - Search input with autocomplete, validation preview with metrics, add button with loading state

### Modified

- `apps/admin/src/components/symbols/index.ts` - Added AddSymbolForm export
- `apps/admin/src/pages/Symbols.tsx` - Replaced placeholder with AddSymbolForm, improved remove flow

## Key Implementation Details

### AddSymbolForm Component

- Debounced search query (300ms delay) reduces API calls
- Search dropdown filters out symbols already in watchlist
- Selecting symbol triggers validation query
- Validation preview shows:
  - Symbol name with validation checkmark
  - Price, 24h change (color-coded), 24h volume
  - "Already in watchlist" badge if duplicate
- Add button sends `add-symbol` command via control.executeCommand
- Error state shows clear message for invalid symbols

### Symbols Page Integration

- AddSymbolForm receives existingSymbols array for duplicate detection
- handleSymbolAdded callback invalidates settings query
- Improved remove flow:
  - Added isRemoving state for tracking removal in progress
  - Dialog cannot be closed while removal is pending
  - Better toast messages for add/remove operations

### Type Narrowing Pattern

The symbol.validate endpoint returns a union type:
```typescript
{ symbol: string; valid: boolean; error: string; }
| { symbol: string; valid: boolean; metrics: {...}; }
```

Used `'metrics' in validation` pattern for proper type narrowing:
```typescript
const validationMetrics = validation?.valid && 'metrics' in validation
  ? validation.metrics
  : null;
```

## Decisions Made

1. **300ms debounce** - Balance between responsiveness and API call reduction

2. **Filter existing symbols from search** - Better UX than showing symbols that can't be added

3. **Prevent dialog close during removal** - Avoids inconsistent UI state if user dismisses dialog mid-operation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed type narrowing for union type**

- **Found during:** Task 1
- **Issue:** TypeScript error accessing `validation.metrics` and `validation.error` on union type
- **Fix:** Extracted metrics/error with type guards before accessing properties
- **Files modified:** AddSymbolForm.tsx
- **Commit:** 531205b

## Requirements Covered

- **UI-SYM-02:** User can search and add symbols with validation
- **UI-SYM-03:** User can remove symbols with confirmation (improved flow)
- Clear error messages for invalid symbols
- Metrics preview shown before adding

## Next Phase Readiness

Phase 22 (Admin UI - Control + Symbols) is now complete:
- 22-01: Page shells and shadcn components
- 22-02: Control panel commands and confirmation dialog
- 22-03: Skipped (bulk import deferred)
- 22-04: Symbol watchlist display
- 22-05: Add symbol form

All UI requirements for v4.0 milestone are complete.

---
*Phase: 22-admin-ui-control-symbols*
*Completed: 2026-02-01*
