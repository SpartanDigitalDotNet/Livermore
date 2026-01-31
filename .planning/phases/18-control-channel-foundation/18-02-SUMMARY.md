---
# Execution metadata
phase: 18
plan: 02
subsystem: control-channel
tags: [redis, pubsub, ioredis, service, priority-queue]

# Dependency graph
requires: [18-01-command-schemas]
provides: [control-channel-service]
affects: [18-03, 19-runtime-commands]

# Tech tracking
tech-stack:
  added: []
  patterns: [redis-pubsub-subscriber, priority-queue-sorted-set, command-handler]

# File tracking
key-files:
  created:
    - apps/api/src/services/control-channel.service.ts
  modified: []

# Decision log
decisions:
  - id: DEC-1802-01
    choice: "Use redis.duplicate() for pub/sub subscriber"
    rationale: "Required pattern - main client cannot be in both command and pub/sub mode"
  - id: DEC-1802-02
    choice: "Use Redis sorted set for priority queue"
    rationale: "zpopmin efficiently retrieves lowest score (highest priority) commands"
  - id: DEC-1802-03
    choice: "Command priority field overrides PRIORITY constant"
    rationale: "Allow callers to override default priorities when needed"

# Metrics
duration: ~8min
completed: 2026-01-31
---

# Phase 18 Plan 02: ControlChannelService Summary

**One-liner:** Redis pub/sub service with priority queue that validates commands, publishes ACK immediately, executes handlers, and publishes results.

## What Was Built

### 1. ControlChannelService (apps/api/src/services/control-channel.service.ts)

Created the core service for Admin-to-API communication via Redis pub/sub:

- **Constructor:** Accepts `identitySub` (Clerk user ID) to scope all channels
  - Command channel: `livermore:commands:{sub}`
  - Response channel: `livermore:responses:{sub}`
  - Queue key: `livermore:command-queue:{sub}`

- **start() method:**
  - Creates duplicate Redis connection (required for pub/sub mode)
  - Subscribes to command channel
  - Sets up message handler

- **handleMessage() method:**
  - Parses JSON with error handling
  - Validates with CommandSchema.safeParse()
  - Checks command expiry (30s timeout per RUN-12)
  - Queues valid commands by priority

- **processQueue() method:**
  - Uses ZPOPMIN to get highest priority (lowest score) command
  - Processes one at a time with setImmediate for non-blocking
  - Continues until queue empty

- **handleCommand() method:**
  - Publishes immediate ACK (RUN-10)
  - Executes command (stub in Phase 18)
  - Publishes success result or error (RUN-11)

- **stop() method:**
  - Unsubscribes from channel
  - Quits subscriber connection
  - Cleans up resources

### 2. Priority Queue (RUN-13)

```typescript
const PRIORITY: Record<CommandType, number> = {
  pause: 1,           // Critical - process first
  resume: 1,          // Critical - process first
  'reload-settings': 10,
  'switch-mode': 10,
  'add-symbol': 15,
  'remove-symbol': 15,
  'force-backfill': 20,
  'clear-cache': 20,
};
```

Commands with lower priority numbers are processed first, ensuring pause/resume always execute before other operations.

## Commits

| Commit | Description |
|--------|-------------|
| 9ec96d1 | feat(18-02): add ControlChannelService with pub/sub handling |
| 848408b | feat(18-02): add priority queue support for command ordering |

## Requirements Satisfied

| Requirement | Status |
|-------------|--------|
| RUN-01: Command channel subscription | Done |
| RUN-02: Response channel publishing | Done |
| RUN-03: Command handling | Done |
| RUN-10: Immediate ACK on command receipt | Done |
| RUN-11: Result published after execution | Done |
| RUN-12: Commands older than 30s rejected | Done |
| RUN-13: Priority queue for command ordering | Done |

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

### Ready For
- Plan 18-03: Can instantiate ControlChannelService in server startup
- Plan 18-03: pause/resume endpoints can use existing infrastructure
- Phase 19: Actual command handlers replace stub in executeCommand()

### Dependencies Satisfied
- Service uses CommandSchema from @livermore/schemas (18-01)
- Service uses commandChannel/responseChannel from @livermore/cache (18-01)
- Build passes with no TypeScript errors
- 295 lines (above 100 line minimum)

---
*Generated: 2026-01-31*
