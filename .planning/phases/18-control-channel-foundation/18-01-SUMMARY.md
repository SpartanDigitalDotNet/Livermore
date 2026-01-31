---
# Execution metadata
phase: 18
plan: 01
subsystem: control-channel
tags: [zod, schemas, redis, pubsub, typescript]

# Dependency graph
requires: [17-settings-infrastructure]
provides: [command-schemas, channel-keys]
affects: [18-02, 18-03, 19-runtime-commands]

# Tech tracking
tech-stack:
  added: []
  patterns: [command-response-pattern, redis-pubsub-channels]

# File tracking
key-files:
  created:
    - packages/schemas/src/control/command.schema.ts
  modified:
    - packages/schemas/src/index.ts
    - packages/cache/src/keys.ts

# Decision log
decisions:
  - id: DEC-1801-01
    choice: "Define all 8 command types upfront"
    rationale: "Forward compatibility - only pause/resume implemented now but schema ready for Phase 19/20"
  - id: DEC-1801-02
    choice: "Use livermore: prefix for control channels"
    rationale: "Distinguish from existing channel: prefix used for market data"

# Metrics
duration: ~5min
completed: 2026-01-31
---

# Phase 18 Plan 01: Command Schemas and Channel Keys Summary

**One-liner:** Zod schemas for Command/CommandResponse messages with Redis pub/sub channel key helpers for user-scoped control channels.

## What Was Built

### 1. Command Schema (packages/schemas/src/control/command.schema.ts)

Created Zod schemas for the control channel message protocol:

- **CommandTypeSchema**: Enum with 8 command types
  - Phase 18: `pause`, `resume`
  - Phase 19: `reload-settings`, `switch-mode`, `force-backfill`, `clear-cache`
  - Phase 20: `add-symbol`, `remove-symbol`

- **CommandSchema**: Message structure for commands
  - `correlationId` (UUID) - for request/response correlation
  - `type` (CommandType) - command to execute
  - `payload` (optional) - command-specific data
  - `timestamp` (number) - Unix ms when issued
  - `priority` (1-100) - for command ordering

- **CommandResponseSchema**: Message structure for responses
  - `correlationId` (UUID) - matches original command
  - `status` (`ack` | `success` | `error`)
  - `message` (optional) - human-readable text
  - `data` (optional) - response payload
  - `timestamp` (number) - Unix ms when generated

### 2. Channel Key Helpers (packages/cache/src/keys.ts)

Added two functions for Redis pub/sub channels:

- `commandChannel(identitySub)` - returns `livermore:commands:{sub}`
- `responseChannel(identitySub)` - returns `livermore:responses:{sub}`

These are scoped by Clerk identity subject (user.id) so each user has isolated control channels.

## Commits

| Commit | Description |
|--------|-------------|
| 73753b6 | feat(18-01): add command and response Zod schemas |
| ff6f9a7 | feat(18-01): export command schemas and add channel key helpers |

## Requirements Satisfied

| Requirement | Status |
|-------------|--------|
| RUN-10: Message schema with correlationId, type, payload, timestamp, priority | Done |
| RUN-11: Response schema with correlationId, status, message, data, timestamp | Done |
| RUN-12: Channel key pattern livermore:commands:{sub} | Done |
| RUN-13: Channel key pattern livermore:responses:{sub} | Done |

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

### Ready For
- Plan 18-02: ControlChannelService can import CommandSchema, CommandResponseSchema from @livermore/schemas
- Plan 18-02: Can use commandChannel(), responseChannel() from @livermore/cache for pub/sub
- Plan 18-03: Pause/resume endpoints can reference CommandTypeSchema

### Dependencies Satisfied
- Schemas exported from barrel (packages/schemas/src/index.ts)
- Channel keys exported from cache package
- All packages build successfully with monorepo `pnpm build`

---
*Generated: 2026-01-31*
