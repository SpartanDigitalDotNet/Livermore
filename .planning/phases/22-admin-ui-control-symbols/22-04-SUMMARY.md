---
phase: 22-admin-ui-control-symbols
plan: 04
subsystem: ui
tags: [react, trpc, tanstack-query, symbols, watchlist]

# Dependency graph
requires:
  - phase: 22-01
    provides: shadcn components (Badge, Dialog, Tooltip, Button, Switch) and page shells
  - phase: 22-02
    provides: ConfirmationDialog component for remove confirmation
  - phase: 20-symbol-management
    provides: symbol.validate endpoint for metrics
provides:
  - SymbolRow component with expandable metrics display
  - SymbolWatchlist component for listing user symbols
  - ScannerStatus component showing scanner configuration
  - Symbols page with integrated watchlist and scanner status
affects: [22-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [lazy metrics fetch on expand, settings extraction with type assertion]

key-files:
  created:
    - apps/admin/src/components/symbols/SymbolRow.tsx
    - apps/admin/src/components/symbols/SymbolWatchlist.tsx
    - apps/admin/src/components/symbols/ScannerStatus.tsx
    - apps/admin/src/components/symbols/index.ts
  modified:
    - apps/admin/src/pages/Symbols.tsx

key-decisions:
  - "Fetch metrics lazily on expand to avoid unnecessary API calls"
  - "Use type assertion for settings extraction (proper typing in plan 05)"
  - "Toggle shows toast placeholder - full implementation in plan 05"

patterns-established:
  - "SymbolRow fetches metrics via symbol.validate with 60s stale time"
  - "Settings fields extracted with (settings as any)?.field ?? default pattern"

# Metrics
duration: 9min
completed: 2026-02-01
---

# Phase 22 Plan 04: Symbol Watchlist UI Summary

**Symbol watchlist display with SymbolRow expandable metrics, ScannerStatus card, and remove confirmation dialog**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-01T15:40:38Z
- **Completed:** 2026-02-01T15:49:39Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Created SymbolRow component with enable/disable toggle and expandable metrics
- Created SymbolWatchlist component rendering symbols from settings
- Created ScannerStatus component showing scanner enabled/exchange/lastRun
- Integrated all components into Symbols page with remove confirmation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SymbolRow component** - `a362f57` (feat)
2. **Task 2: Create ScannerStatus and SymbolWatchlist** - `25c3787` (feat)
3. **Task 3: Integrate into Symbols page** - `ffcd1a5` (feat)

## Files Created/Modified

### Created

- `apps/admin/src/components/symbols/SymbolRow.tsx` - Individual symbol row with toggle, expand, remove, and metrics display
- `apps/admin/src/components/symbols/SymbolWatchlist.tsx` - Card listing all symbols via SymbolRow
- `apps/admin/src/components/symbols/ScannerStatus.tsx` - Card showing scanner enabled state and exchange
- `apps/admin/src/components/symbols/index.ts` - Barrel exports for symbol components

### Modified

- `apps/admin/src/pages/Symbols.tsx` - Integrated watchlist, scanner status, and remove confirmation

## Key Implementation Details

### SymbolRow Component

- Enable/disable toggle via Switch component
- Expand button reveals metrics fetched from `symbol.validate` endpoint
- Metrics include: price, 24h change, 24h volume, base/quote names
- Format helpers: `formatPrice` (decimals), `formatChange` (sign+%), `formatVolume` (K/M/B)
- 60s stale time for cached metrics

### SymbolWatchlist Component

- Renders list of symbols from settings
- Tracks disabled symbols via Set for O(1) lookup
- Shows empty state when no symbols configured
- Badge showing symbol count in header

### ScannerStatus Component

- Shows enabled/disabled badge
- Displays exchange name
- Shows last run timestamp if available
- "Scanner not configured" fallback

### Symbols Page Integration

- Fetches settings via `trpc.settings.get.queryOptions()`
- Extracts symbols, disabledSymbols, scanner with type assertions
- Toggle shows toast placeholder (full implementation in plan 05)
- Remove shows ConfirmationDialog, executes `remove-symbol` command on confirm

## Decisions Made

1. **Lazy metrics fetch** - Only fetch metrics when row is expanded, not on initial render. Reduces API calls for large watchlists.

2. **Type assertion for settings** - Used `(settings as any)?.field` pattern since proper UserSettings type doesn't include symbols array yet. Will be properly typed when settings schema is extended.

3. **Toast placeholder for toggle** - Enable/disable toggle shows informational toast rather than making API call. Full implementation with settings.patch will come in plan 05.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Unused Badge import in SymbolRow** - Plan included Badge import but component didn't use it. Removed during compile check.
- **Type narrowing for metrics** - Had to use `'metrics' in metrics` check to properly narrow union type from symbol.validate response.

## Requirements Covered

- **UI-SYM-01:** Symbol watchlist display with enable/disable toggles
- **UI-SYM-05:** Scanner status display (enabled, exchange, last run)
- **UI-SYM-06:** Symbol metrics displayed on expand (price, volume, change)

## Next Phase Readiness

- Plan 05 will add:
  - Symbol search form with autocomplete
  - Add symbol functionality with validation preview
  - Full toggle implementation via settings.patch
  - Bulk import option

---
*Phase: 22-admin-ui-control-symbols*
*Completed: 2026-02-01*
