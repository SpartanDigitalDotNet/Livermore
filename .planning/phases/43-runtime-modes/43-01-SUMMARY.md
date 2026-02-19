---
phase: 43-runtime-modes
plan: 01
subsystem: infra
tags: [zod, env-validation, runtime-mode, typescript-overloads]

# Dependency graph
requires:
  - phase: 39-dto-schemas
    provides: "EnvConfigSchema and env-validator foundation"
provides:
  - "RuntimeMode type ('exchange' | 'pw-host')"
  - "resolveMode() function reading LIVERMORE_MODE env var"
  - "PwHostEnvConfigSchema omitting exchange-specific fields"
  - "Mode-aware validateEnv() with TypeScript overloads"
affects: [43-02, server-startup, pw-host-mode]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Zod .omit() for mode-specific schema derivation", "TypeScript function overloads for mode-dependent return types"]

key-files:
  created: []
  modified:
    - "packages/schemas/src/env/config.schema.ts"
    - "packages/utils/src/validation/env-validator.ts"
    - "packages/utils/src/index.ts"

key-decisions:
  - "Zod .omit() over separate schema definition: derives PwHostEnvConfigSchema from EnvConfigSchema to stay in sync"
  - "Function overloads for validateEnv(): compile-time type narrowing based on mode parameter"
  - "resolveMode() as standalone function: called before validateEnv() so mode is resolved once and passed explicitly"

patterns-established:
  - "Mode-aware validation: resolveMode() then validateEnv(mode) pattern for startup"
  - "Schema derivation: omit exchange-specific fields from base schema for alternative modes"

# Metrics
duration: 4min 46s
completed: 2026-02-19
---

# Phase 43 Plan 01: RuntimeMode Type System Summary

**RuntimeMode type with resolveMode() and PwHostEnvConfigSchema using Zod .omit() derivation and TypeScript overloads for mode-aware env validation**

## Performance

- **Duration:** 4 min 46 s
- **Started:** 2026-02-19T19:29:12Z
- **Completed:** 2026-02-19T19:33:58Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- RuntimeMode type ('exchange' | 'pw-host') with resolveMode() that reads LIVERMORE_MODE env var
- PwHostEnvConfigSchema derived via Zod .omit() removing Coinbase, Clerk, and Discord fields
- validateEnv() accepts optional RuntimeMode parameter with TypeScript overloads for type-safe returns
- Full backward compatibility: existing validateEnv() calls unchanged, all three packages compile clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RuntimeMode type, resolveMode(), and PwHostEnvConfigSchema** - `d470d94` (feat)
2. **Task 2: Make validateEnv() mode-aware** - `cd6161a` (feat)

## Files Created/Modified
- `packages/schemas/src/env/config.schema.ts` - Added RuntimeMode type, resolveMode(), PwHostEnvConfigSchema, PwHostEnvConfig
- `packages/utils/src/validation/env-validator.ts` - Mode-aware validateEnv() with overloads
- `packages/utils/src/index.ts` - Re-export resolveMode from @livermore/schemas

## Decisions Made
- **Zod .omit() over separate schema**: Keeps PwHostEnvConfigSchema in sync with EnvConfigSchema automatically when new shared fields are added
- **Function overloads**: validateEnv('pw-host') returns PwHostEnvConfig, validateEnv() returns EnvConfig -- compile-time safety
- **resolveMode() standalone**: Separated from validateEnv() so mode resolution happens once at startup and can be passed to other consumers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- schemas package required rebuild (`turbo build --filter=@livermore/schemas`) before utils could see new exports -- expected behavior for cross-package references

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- RuntimeMode and resolveMode() ready for Phase 43 Plan 02 (server startup branching)
- validateEnv('pw-host') can be called from pw-host server entry point
- No blockers

---
*Phase: 43-runtime-modes*
*Completed: 2026-02-19*
