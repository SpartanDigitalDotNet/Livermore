---
phase: 43-runtime-modes
plan: 02
subsystem: infra
tags: [runtime-mode, server-startup, pw-host, mode-gating, fastify]

# Dependency graph
requires:
  - phase: 43-runtime-modes
    plan: 01
    provides: "RuntimeMode type, resolveMode(), mode-aware validateEnv()"
  - phase: 39-dto-schemas
    provides: "publicApiPlugin for public API routes"
  - phase: 42-ws-streaming
    provides: "WebSocket bridge for optional WS in pw-host mode"
provides:
  - "Mode-gated server.ts startup: pw-host skips all exchange services"
  - "pw-host health endpoint returning mode + DB/Redis status only"
  - "Exchange health endpoint now includes mode: 'exchange'"
  - "WebSocket bridge available in pw-host via LIVERMORE_EXCHANGE_ID/NAME env vars"
  - "Simplified pw-host shutdown (Redis + Fastify only)"
affects: [deployment, pw-host-instances, health-monitoring]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Early-return branching for mode isolation", "Config type narrowing via cast after mode guard"]

key-files:
  created: []
  modified:
    - "apps/api/src/server.ts"

key-decisions:
  - "Early-return pattern over if/else wrapping: isPwHost block returns early, keeping exchange code path unindented and unchanged"
  - "Config cast to EnvConfig after pw-host guard: safe because pw-host returns before exchange-specific fields are accessed"
  - "Conditional validateEnv call: isPwHost ? validateEnv('pw-host') : validateEnv() to satisfy TypeScript overloads"
  - "Exchange identity from env vars in pw-host: LIVERMORE_EXCHANGE_ID/NAME enables optional WebSocket bridge without exchange adapter"

patterns-established:
  - "Mode guard pattern: resolveMode() -> isPwHost -> early return for headless path"
  - "Shared pre-flight: DB + Redis connection checks run in both modes before branching"

# Metrics
duration: 4min 47s
completed: 2026-02-19
---

# Phase 43 Plan 02: Mode-Gated Server Startup Summary

**server.ts branches on RuntimeMode with pw-host early-return path serving only public API from Redis/DB, skipping all exchange services**

## Performance

- **Duration:** 4 min 47 s
- **Started:** 2026-02-19T19:36:33Z
- **Completed:** 2026-02-19T19:41:20Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Mode-gated startup: pw-host path registers only Fastify + CORS + WebSocket + DB + Redis + publicApiPlugin + /health
- Zero exchange service initialization in pw-host: no Clerk, tRPC, Discord, ExchangeAdapterFactory, IndicatorCalculationService, AlertEvaluationService, ControlChannelService, InstanceRegistryService, StateMachineService, BoundaryRestService
- Health endpoint reports runtime mode in both paths: pw-host returns DB/Redis status, exchange returns full service status including Discord and exchange connection state
- WebSocket bridge optionally available in pw-host when LIVERMORE_EXCHANGE_ID and LIVERMORE_EXCHANGE_NAME env vars are set
- Simplified pw-host shutdown: only Redis quit + Fastify close (no exchange service teardown)
- Exchange mode completely unchanged except `mode: 'exchange'` added to health response

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor server.ts startup for mode-gated initialization** - `e6620c9` (feat)

## Files Created/Modified
- `apps/api/src/server.ts` - Mode-gated startup with pw-host early-return path, resolveMode() integration, exchangeConfig type narrowing

## Decisions Made
- **Early-return over if/else**: The pw-host block uses `if (isPwHost) { ... return; }` to avoid wrapping the large exchange-mode code in an else block, keeping the existing code path unmodified and at original indentation level
- **Conditional validateEnv call**: Used `isPwHost ? validateEnv('pw-host') : validateEnv()` instead of `validateEnv(mode)` because TypeScript overloads don't accept the union type `RuntimeMode` -- each overload requires a specific literal
- **Config type cast after guard**: `const exchangeConfig = config as EnvConfig` is safe after the pw-host early return because only exchange mode reaches that line
- **Exchange identity from env vars**: pw-host reads LIVERMORE_EXCHANGE_ID/LIVERMORE_EXCHANGE_NAME from process.env to optionally enable WebSocket bridge without requiring an exchange adapter

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Package rebuild required for cross-package exports**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `resolveMode` export from `@livermore/utils` not visible -- compiled .d.ts stale from Plan 01
- **Fix:** Ran `turbo build --filter=@livermore/schemas --filter=@livermore/utils` to regenerate declarations
- **Files modified:** None (build output only)
- **Verification:** `npx tsc --noEmit -p apps/api/tsconfig.json` passes

**2. [Rule 1 - Bug] validateEnv overload incompatibility with RuntimeMode union**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `validateEnv(mode)` where `mode: RuntimeMode` doesn't match either overload (`'exchange'` or `'pw-host'`)
- **Fix:** Used conditional call: `isPwHost ? validateEnv('pw-host') : validateEnv()` to pass literal types
- **Files modified:** `apps/api/src/server.ts`
- **Verification:** TypeScript compiles clean with no errors

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for compilation. No scope creep.

## Issues Encountered
- Stale package build artifacts expected in monorepo cross-package development -- standard `turbo build` resolves

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- pw-host mode fully operational: set `LIVERMORE_MODE=pw-host` to start headless public API instance
- Optionally set `LIVERMORE_EXCHANGE_ID` and `LIVERMORE_EXCHANGE_NAME` for WebSocket bridge in pw-host
- Phase 43 complete: RuntimeMode type system (Plan 01) + mode-gated server startup (Plan 02) delivered
- No blockers

---
*Phase: 43-runtime-modes*
*Completed: 2026-02-19*
