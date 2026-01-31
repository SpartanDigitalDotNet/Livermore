---
phase: 18
plan: 03
subsystem: api
tags: [server, lifecycle, control-channel, startup, shutdown]

dependency-graph:
  requires: [18-01, 18-02]
  provides: [server-integration, control-channel-lifecycle]
  affects: [19-runtime-commands]

tech-stack:
  added: []
  patterns: [service-lifecycle-management]

key-files:
  created: []
  modified:
    - apps/api/src/server.ts

decisions:
  - id: CTRL-03
    choice: Control channel starts after pre-flight but before data services
    rationale: Must be ready to receive commands before data pipeline starts
    alternatives: [start-with-data-services, start-last]

metrics:
  duration: 10m
  completed: 2026-01-31
---

# Phase 18 Plan 03: Server Startup Integration Summary

**One-liner:** ControlChannelService integrated into server startup after pre-flight checks and graceful shutdown before data services

## What Was Built

Integrated the ControlChannelService (created in 18-02) with the API server lifecycle:

1. **Server Startup Integration**
   - Import ControlChannelService from services directory
   - Define TEST_IDENTITY_SUB constant for test user identity (placeholder for multi-user)
   - Start ControlChannelService after pre-flight checks pass, before data services initialize
   - Log startup confirmation with identitySub for observability

2. **Graceful Shutdown Integration**
   - Stop ControlChannelService FIRST in shutdown sequence (before alertService, coinbaseAdapter, etc.)
   - Ensures no new commands are accepted during shutdown
   - Clean unsubscribe and Redis connection cleanup

3. **Health Check Enhancement**
   - Added controlChannel: 'active' to health check endpoint services object
   - Allows monitoring systems to verify control channel is operational

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add ControlChannelService import and startup | 480dec3 | apps/api/src/server.ts |
| 2 | Add ControlChannelService to graceful shutdown | 480dec3 | apps/api/src/server.ts |

## Technical Details

### Startup Order
```
1. Validate environment
2. Create Fastify instance
3. Register plugins (cors, websocket, Clerk)
4. Pre-flight checks (database, Redis)
5. Discord service init
6. ControlChannelService.start()  <-- NEW: Early startup for command readiness
7. Fetch symbols from Coinbase
8. Cache backfill
9. tRPC router
10. Indicator service
11. BoundaryRestService
12. CoinbaseAdapter
13. AlertService
14. Listen on port
```

### Shutdown Order
```
1. ControlChannelService.stop()  <-- NEW: Stop first (no new commands)
2. alertService.stop()
3. coinbaseAdapter.disconnect()
4. boundaryRestService.stop()
5. indicatorService.stop()
6. subscriberRedis.quit()
7. Discord notification
8. redis.quit()
9. fastify.close()
```

### Constants Added
```typescript
// Temporary: hardcode test identity_sub until multi-user support
// This should match the Clerk user.id of the test user
// TODO: Replace with dynamic identity from authenticated context
const TEST_IDENTITY_SUB = 'user_test_001';
```

## Verification Results

- [x] `pnpm -F api build` - No TypeScript errors
- [x] ControlChannelService imported from ./services/control-channel.service
- [x] Service started after pre-flight checks with TEST_IDENTITY_SUB
- [x] Service stopped first in graceful shutdown sequence
- [x] Health check includes controlChannel status

## Deviations from Plan

None - plan executed exactly as written.

## Dependencies Satisfied

This plan completes the Control Channel Foundation (Phase 18):

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| RUN-01 | Complete | commandChannel() in keys.ts (18-01) |
| RUN-02 | Complete | responseChannel() in keys.ts (18-01) |
| RUN-03 | Complete | handleCommand() in ControlChannelService (18-02) |
| RUN-10 | Complete | Immediate ACK in handleCommand() (18-02) |
| RUN-11 | Complete | Result published after execution (18-02) |
| RUN-12 | Complete | 30s timeout check in handleMessage() (18-02) |
| RUN-13 | Complete | Priority queue with sorted set (18-02) |

## Next Phase Readiness

Phase 19 (Runtime Commands) can now proceed:
- ControlChannelService is running and receiving commands
- Command schemas validated, ACK/result flow working
- Priority queue ensures pause/resume processed first

**Blockers:** None
**Dependencies:** All Phase 18 requirements satisfied
