---
phase: 42-websocket-bridge-backpressure
plan: 02
subsystem: api
tags: [websocket, fastify, asyncapi, streaming, auth, route-wiring]

requires:
  - phase: 42-websocket-bridge-backpressure
    plan: 01
    provides: "WebSocketBridge, ClientConnection, handleClientMessage, schemas, types"
  - phase: 41-auth-rate-limiting
    provides: "validateApiKey(), buildAuthHook() for API key authentication"
provides:
  - "/public/v1/stream WebSocket endpoint with query param API key auth"
  - "Bridge lifecycle integration (start on plugin init, stop on server close)"
  - "AsyncAPI 3.1 specification documenting all WebSocket message schemas"
affects: [43-pw-host-mode]

tech-stack:
  added: ["@fastify/websocket (as public-api dependency)"]
  patterns: ["Plugin-scoped WebSocket route with in-route auth", "AsyncAPI 3.1 spec for WS documentation"]

key-files:
  created:
    - packages/public-api/src/ws/index.ts
    - packages/public-api/docs/asyncapi.yaml
  modified:
    - packages/public-api/src/plugin.ts
    - packages/public-api/src/middleware/auth.ts
    - apps/api/src/server.ts
    - packages/public-api/package.json

key-decisions:
  - "Triple-slash reference for @fastify/websocket types (module augmentation needed in plugin scope)"
  - "Move publicApiPlugin registration after activeExchangeId declaration in server.ts"
  - "Skip /stream in buildAuthHook (WS auth via query param, not header)"
  - "Bridge only created when exchangeId + exchangeName provided (idle mode has no bridge)"

patterns-established:
  - "WebSocket route auth: query param ?apiKey=xxx with in-route validation (bypasses header hook)"
  - "Plugin-scoped bridge lifecycle: start on init, stop via onClose hook"

duration: 9min
completed: 2026-02-19
---

# Phase 42 Plan 02: WebSocket Route Wiring & AsyncAPI Spec Summary

**Fastify /stream WebSocket route with query param API key auth (4001/4008 close codes), bridge lifecycle hooks, and AsyncAPI 3.1 specification with all message schemas**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-19T18:43:08Z
- **Completed:** 2026-02-19T18:52:08Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- /public/v1/stream WebSocket endpoint registered with query param API key auth and per-key connection limiting (close codes 4001, 4008)
- Bridge lifecycle integrated: starts on plugin init when exchangeId is available, stops on server close via onClose hook
- AsyncAPI 3.1 spec documents all 6 message types (subscribe, unsubscribe, subscribed, unsubscribed, candle_close, trade_signal, error) with concrete JSON examples
- Auth hook updated to skip /stream path (WS auth handled in-route, not via X-API-Key header)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire /stream route into plugin and integrate bridge lifecycle** - `71d11cf` (feat)
2. **Task 2: AsyncAPI 3.1 specification** - `7c14de2` (docs)

## Files Created/Modified
- `packages/public-api/src/ws/index.ts` - Barrel export for WebSocketBridge, ClientConnection, handleClientMessage, schemas, types
- `packages/public-api/src/plugin.ts` - Added /stream WebSocket route with bridge lifecycle, query param auth, connection limiting
- `packages/public-api/src/middleware/auth.ts` - Skip /stream in buildAuthHook (WS auth handled in-route)
- `apps/api/src/server.ts` - Pass exchangeId/exchangeName to publicApiPlugin opts, reorder variable declarations
- `packages/public-api/package.json` - Added @fastify/websocket dependency for type augmentation
- `packages/public-api/docs/asyncapi.yaml` - AsyncAPI 3.1 spec with channels, operations, message schemas, examples

## Decisions Made
- **Triple-slash reference for types**: Used `/// <reference types="@fastify/websocket" />` in plugin.ts to load module augmentation that adds `websocket` to RouteShorthandOptions
- **Variable declaration reorder**: Moved `activeExchangeId`/`activeExchangeName` declarations before publicApiPlugin registration in server.ts (plan referenced wrong line numbers)
- **Bridge conditional on exchangeId**: Bridge only created when `opts.exchangeId && opts.exchangeName` are provided -- idle mode (no exchange) has no bridge, which is correct
- **Skip /stream in auth hook**: Added to both routerPath check and full URL regex pattern for defense-in-depth

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @fastify/websocket as public-api dependency**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `{ websocket: true }` route option and WebSocket handler types require `@fastify/websocket` module augmentation in scope
- **Fix:** Added `@fastify/websocket` dependency and `/// <reference types="@fastify/websocket" />` directive
- **Files modified:** packages/public-api/package.json, packages/public-api/src/plugin.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 71d11cf (Task 1 commit)

**2. [Rule 1 - Bug] Fixed variable declaration ordering in server.ts**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `activeExchangeId` and `activeExchangeName` used in plugin registration (line 289) before being declared (line 300)
- **Fix:** Moved variable declarations above the plugin registration
- **Files modified:** apps/api/src/server.ts
- **Verification:** `npx tsc --noEmit -p apps/api/tsconfig.json` passes
- **Committed in:** 71d11cf (Task 1 commit)

**3. [Rule 3 - Blocking] Typed message handler parameter to fix RawData assignability**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `socket.on('message', (data) => ...)` infers `data` as `RawData` (includes `ArrayBuffer`) which is not assignable to `Buffer | string`
- **Fix:** Explicitly typed parameter as `(data: Buffer | string)` to match handleClientMessage signature
- **Files modified:** packages/public-api/src/plugin.ts
- **Verification:** TypeScript compilation passes
- **Committed in:** 71d11cf (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All fixes necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 42 is complete: WebSocket bridge engine (Plan 01) + route wiring and AsyncAPI spec (Plan 02)
- Ready for Phase 43 (pw-host mode) which may extend the bridge for multi-exchange scenarios
- The bridge only activates when exchangeId is known (autostart mode); idle mode defers bridge creation

## Self-Check: PASSED

- [x] 5/5 key files found
- [x] Commit 71d11cf found (Task 1)
- [x] Commit 7c14de2 found (Task 2)
- [x] TypeScript compilation: zero errors (both public-api and apps/api)
- [x] Proprietary field grep: zero matches in ws/ and docs/

---
*Phase: 42-websocket-bridge-backpressure*
*Completed: 2026-02-19*
