---
phase: 33
plan: 02
subsystem: network
tags: [discord, notifications, state-machine, fire-and-forget]
depends_on:
  requires: [30-01, 30-02, 31-02]
  provides: [discord-state-notifications]
  affects: []
tech_stack:
  added: []
  patterns: [fire-and-forget-async, singleton-service]
key_files:
  created: []
  modified:
    - apps/api/src/services/state-machine.service.ts
decisions: []
metrics:
  duration: "2m"
  completed: "2026-02-10"
---

# Phase 33 Plan 02: Discord State Transition Notifications Summary

**One-liner:** Fire-and-forget Discord notifications on every state machine transition with exchange name, states, and hostname

## What Was Done

### Task 1: Add Discord notification to StateMachineService transitions
**Commit:** `00097dd` feat(33-02): add Discord notification on state transitions

Modified `apps/api/src/services/state-machine.service.ts` to send a Discord notification after every successful state transition:

- Added import of `getDiscordService` from `discord-notification.service`
- After the existing Phase 31 activity logger block in `transition()`, added a new Discord notification block
- Uses `getDiscordService()` singleton to check `isEnabled()` before sending
- Calls `this.registry.getStatus()` (async, via `.then()`) to get exchange name and hostname
- Sends notification with title `Perseus Network: {exchangeName}` and body `State changed: **{from}** -> **{to}** ({hostname})`
- Entire block is fire-and-forget: no `await`, `.catch()` on every promise, outer try-catch with swallowed errors
- `resetToIdle()` intentionally does NOT send Discord notifications (recovery mechanism, not normal transition)

**Key code pattern:**
```typescript
// Phase 33: Discord notification for state changes (fire-and-forget)
try {
  const discord = getDiscordService();
  if (discord.isEnabled()) {
    this.registry.getStatus().then((registryStatus) => {
      const exchangeName = registryStatus?.exchangeName ?? 'Unknown';
      const hostname = registryStatus?.hostname ?? 'Unknown';
      discord.sendSystemNotification(
        `Perseus Network: ${exchangeName}`,
        `State changed: **${from}** -> **${to}** (${hostname})`
      ).catch(() => { /* swallow */ });
    }).catch(() => { /* swallow */ });
  }
} catch {
  // getDiscordService() failed -- swallow
}
```

**Adaptation from plan:** The plan's sample code used `registry.getStatus()` synchronously, but the actual method is async (reads from Redis). Adapted to use `.then()` chaining to keep the entire block fire-and-forget without awaiting.

## Verification Results

- TypeScript compilation: PASS (zero errors)
- `getDiscordService` appears in import + usage: PASS
- `sendSystemNotification` called exactly once: PASS
- `await.*sendSystemNotification` matches zero times: PASS (fire-and-forget confirmed)
- Discord calls only in `transition()`, not in `resetToIdle()`: PASS
- No Discord calls in heartbeat paths or tRPC routers: PASS

## Deviations from Plan

### Minor Adaptation

**1. Async getStatus() handling**
- **Found during:** Task 1 implementation
- **Issue:** Plan sample code used `registry.getStatus()` synchronously, but the actual `InstanceRegistryService.getStatus()` is async (returns `Promise<InstanceStatus | null>`)
- **Fix:** Used `.then()` chaining instead of synchronous access, keeping the entire block fire-and-forget
- **Impact:** None -- same behavior, same fire-and-forget semantics

## Success Criteria Check

| Criteria | Status |
|----------|--------|
| DIFF-04: Discord notifications fire on state changes | PASS |
| Notifications are non-blocking (fire-and-forget) | PASS |
| No regression: transitions work if Discord is down/unconfigured | PASS |
