---
phase: 42-websocket-bridge-backpressure
plan: 01
subsystem: api
tags: [websocket, redis, pubsub, backpressure, streaming, ws]

requires:
  - phase: 39-public-api-foundation
    provides: "Candle transformer (transformCandle) and Zod schema patterns"
  - phase: 40-signals-alerts-endpoints
    provides: "Alert transformer (deriveAlertDirection, deriveAlertStrength)"
  - phase: 41-auth-rate-limiting
    provides: "API key validation and per-key tracking infrastructure"
provides:
  - "WebSocketBridge class with Redis psubscribe fan-out to WebSocket clients"
  - "ClientConnection class with heartbeat ping/pong and backpressure detection"
  - "WS message types, Zod schemas, and external channel parser"
  - "Message handlers for subscribe/unsubscribe with channel validation"
  - "Per-API-key connection counting (max 5 per key)"
affects: [42-02-websocket-route-wiring]

tech-stack:
  added: [ws, "@types/ws"]
  patterns: ["Redis psubscribe fan-out", "bufferedAmount backpressure", "IP-protective relay"]

key-files:
  created:
    - packages/public-api/src/ws/types.ts
    - packages/public-api/src/ws/schemas.ts
    - packages/public-api/src/ws/connection.ts
    - packages/public-api/src/ws/bridge.ts
    - packages/public-api/src/ws/handlers.ts
  modified:
    - packages/public-api/package.json

key-decisions:
  - "bufferedAmount thresholds: 64KB skip, 256KB terminate (heuristic, not exact)"
  - "Pong handler attached once in constructor (not per heartbeat tick) to avoid listener leak"
  - "Messages stringified once then fanned out to all matching clients"
  - "Alert channel parsed from JSON payload (symbol+timeframe) not from Redis channel name"
  - "console.error for relay errors (no logger import, consistent with existing public-api pattern)"

patterns-established:
  - "External channel format: candles:SYMBOL:TIMEFRAME or signals:SYMBOL:TIMEFRAME"
  - "Redis channel to external channel mapping in handleRedisMessage relay path"
  - "Per-API-key connection counting via Map for WS-06 enforcement"

duration: 5min
completed: 2026-02-19
---

# Phase 42 Plan 01: WebSocket Bridge Engine Summary

**WebSocket bridge with Redis psubscribe fan-out, bufferedAmount backpressure (64KB/256KB), and IP-protective candle/signal transformers**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-19T18:35:35Z
- **Completed:** 2026-02-19T18:40:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- WebSocketBridge class manages shared Redis subscriber with psubscribe patterns for candle close and alert events
- ClientConnection tracks per-client subscriptions, heartbeat liveness (30s ping/pong), and backpressure via bufferedAmount
- All Redis pub/sub messages pass through IP-protective transformers (transformCandle, deriveAlertDirection, deriveAlertStrength) before fan-out
- Per-API-key connection counting with configurable max (5) for WS-06 enforcement
- Zod discriminated union validates incoming subscribe/unsubscribe messages with channel format validation

## Task Commits

Each task was committed atomically:

1. **Task 1: WS types, schemas, and ClientConnection class** - `7e9c742` (feat)
2. **Task 2: WebSocketBridge class and message handlers** - `b626dda` (feat)

## Files Created/Modified
- `packages/public-api/src/ws/types.ts` - WS message types, channel parser (mapExternalChannel), VALID_TIMEFRAMES const
- `packages/public-api/src/ws/schemas.ts` - Zod discriminated union for subscribe/unsubscribe client messages
- `packages/public-api/src/ws/connection.ts` - ClientConnection class with heartbeat, backpressure send, subscription tracking
- `packages/public-api/src/ws/bridge.ts` - WebSocketBridge class with Redis psubscribe, IP-protective relay, per-key connection counting
- `packages/public-api/src/ws/handlers.ts` - handleClientMessage with JSON parsing, Zod validation, channel format validation
- `packages/public-api/package.json` - Added ws and @types/ws dependencies

## Decisions Made
- **bufferedAmount thresholds**: 64KB skip (client falling behind), 256KB terminate (irrecoverably slow) -- heuristic values from research
- **Pong handler in constructor**: Attached once to avoid listener accumulation on each heartbeat tick
- **Stringify once, fan out many**: Envelope is JSON.stringify'd once then sent to all matching clients for efficiency
- **Alert channel from payload**: External channel for alerts is built from the parsed JSON payload (symbol + timeframe), not from the Redis channel name which only contains exchangeId
- **console.error for relay path**: Consistent with existing public-api code which does not import logger from @livermore/utils

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed ws and @types/ws dependencies**
- **Found during:** Task 1 (before creating files)
- **Issue:** ws package not in package.json, required for WebSocket type imports
- **Fix:** Ran `pnpm add ws @types/ws --filter @livermore/public-api`
- **Files modified:** packages/public-api/package.json, pnpm-lock.yaml
- **Verification:** TypeScript compilation passes with ws imports
- **Committed in:** 7e9c742 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary dependency installation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All five WS engine files are complete and type-checked
- Plan 02 will wire WebSocketBridge into a Fastify WebSocket route at /public/v1/ws
- Bridge is self-contained: start()/stop()/addClient()/removeClient() API ready for route integration

## Self-Check: PASSED

- [x] 5/5 files found in packages/public-api/src/ws/
- [x] Commit 7e9c742 found (Task 1)
- [x] Commit b626dda found (Task 2)
- [x] TypeScript compilation: zero errors
- [x] Proprietary field grep: zero matches (except local interface definition)

---
*Phase: 42-websocket-bridge-backpressure*
*Completed: 2026-02-19*
