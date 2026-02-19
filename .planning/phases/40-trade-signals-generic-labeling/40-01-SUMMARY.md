---
phase: 40-trade-signals-generic-labeling
plan: 01
subsystem: api
tags: [zod, schemas, transformers, ip-protection, whitelist, trade-signals]

# Dependency graph
requires:
  - phase: 39-public-api-foundation
    provides: Schema patterns (candle.schema.ts), transformer patterns (candle.transformer.ts), barrel exports
provides:
  - PublicSignalSchema, SignalParamsSchema, SignalQuerySchema for signal endpoints
  - PublicAlertSchema, AlertQuerySchema for alert endpoints
  - transformIndicatorToSignal for mapping cached indicators to public signals
  - transformAlertHistory for mapping alert rows to public alerts
  - deriveDirection, deriveStrength helper functions
  - deriveAlertDirection, deriveAlertStrength helper functions
affects: [40-02-endpoints, public-api-routes, signal-routes, alert-routes]

# Tech tracking
tech-stack:
  added: []
  patterns: [stage-to-direction-mapping, magnitude-to-strength-categorization, local-interface-copies]

key-files:
  created:
    - packages/public-api/src/schemas/signal.schema.ts
    - packages/public-api/src/schemas/alert.schema.ts
    - packages/public-api/src/transformers/signal.transformer.ts
    - packages/public-api/src/transformers/alert.transformer.ts
  modified:
    - packages/public-api/src/schemas/index.ts
    - packages/public-api/src/transformers/index.ts

key-decisions:
  - "Local interface copies instead of importing from @livermore/cache or @livermore/database to maintain zero-dependency IP isolation"
  - "Strength thresholds: >=150 extreme, >=80 strong, >=30 moderate, <30 weak (applied to both signals and alerts)"
  - "Alert direction defaults to bearish when trigger label is unrecognized (conservative fallback)"

patterns-established:
  - "Stage-to-direction mapping: internal stage labels mapped to bullish/bearish/neutral enum"
  - "Magnitude-to-strength categorization: raw numeric values mapped to weak/moderate/strong/extreme categories"
  - "Local interface pattern: copy internal data shapes instead of importing from internal packages"

# Metrics
duration: 4min
completed: 2026-02-19
---

# Phase 40 Plan 01: Schemas and Transformers Summary

**Zod schemas and whitelist transformers for trade signals and alert history with generic labels protecting proprietary indicator IP**

## Performance

- **Duration:** 4 min (223s)
- **Started:** 2026-02-19T18:42:56Z
- **Completed:** 2026-02-19T18:46:39Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Signal and alert Zod schemas with complete `.describe()` documentation on every field
- Whitelist transformers that map internal indicator stages to generic direction/strength categories
- Zero indicator names (no references to proprietary calculation methods) in any public-facing schema or transformer output
- Local interface copies maintaining zero-dependency IP isolation boundary

## Task Commits

Each task was committed atomically:

1. **Task 1: Create signal and alert Zod schemas** - `46b0f42` (feat)
2. **Task 2: Create signal and alert whitelist transformers** - `dd4fde5` (feat)

## Files Created/Modified
- `packages/public-api/src/schemas/signal.schema.ts` - PublicSignalSchema, SignalParamsSchema, SignalQuerySchema with generic type/direction/strength fields
- `packages/public-api/src/schemas/alert.schema.ts` - PublicAlertSchema, AlertQuerySchema with timestamp/symbol/exchange/direction/strength/price
- `packages/public-api/src/schemas/index.ts` - Barrel exports updated with signal and alert schemas
- `packages/public-api/src/transformers/signal.transformer.ts` - transformIndicatorToSignal, deriveDirection, deriveStrength
- `packages/public-api/src/transformers/alert.transformer.ts` - transformAlertHistory, deriveAlertDirection, deriveAlertStrength
- `packages/public-api/src/transformers/index.ts` - Barrel exports updated with signal and alert transformers

## Decisions Made
- Used local interface copies (CachedIndicator, AlertHistoryRow) instead of importing from @livermore/cache or @livermore/database to maintain zero-dependency IP isolation boundary
- Strength thresholds set to >=150 extreme, >=80 strong, >=30 moderate, <30 weak -- consistent across both signal and alert transformers
- Alert direction defaults to bearish when trigger label pattern is unrecognized (conservative fallback for safety)
- Named internal value access variable `momentumValue` instead of using indicator-specific name in output

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schemas and transformers ready for signal and alert REST endpoint routes (Plan 02)
- All barrel exports in place for route handlers to import
- Pre-existing TS errors in route files (candles.route.ts, exchanges.route.ts, symbols.route.ts) are unrelated to this plan's work

## Self-Check: PASSED

- All 6 files verified present on disk
- Commit `46b0f42` verified in git log (Task 1)
- Commit `dd4fde5` verified in git log (Task 2)

---
*Phase: 40-trade-signals-generic-labeling*
*Completed: 2026-02-19*
