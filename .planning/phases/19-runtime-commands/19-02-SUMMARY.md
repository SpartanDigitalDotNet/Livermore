---
phase: 19-runtime-commands
plan: 02
title: Command Handler Implementation
subsystem: control-channel
tags: [command-dispatcher, pause-resume, dependency-injection, service-lifecycle]
dependency-graph:
  requires: [19-01]
  provides: [pause-command-handler, resume-command-handler, command-dispatcher]
  affects: [19-03]
tech-stack:
  added: []
  patterns: [command-pattern, dependency-order-lifecycle]
key-files:
  created: []
  modified:
    - apps/api/src/services/types/service-registry.ts
    - apps/api/src/services/control-channel.service.ts
    - apps/api/src/server.ts
decisions:
  - id: CMD-01
    title: Service stop order
    choice: "Downstream first: AlertService -> CoinbaseAdapter -> BoundaryRestService -> IndicatorService"
    rationale: "Consumers must stop before producers to prevent processing stale events"
  - id: CMD-02
    title: Service start order
    choice: "Upstream first: IndicatorService -> CoinbaseAdapter -> BoundaryRestService -> AlertService"
    rationale: "Producers must be listening before events arrive to prevent event loss"
metrics:
  duration: 12m
  completed: 2026-01-31
---

# Phase 19 Plan 02: Command Handler Implementation Summary

Command dispatcher and pause/resume handlers enabling runtime control of the data pipeline via Redis pub/sub commands.

## What Was Built

### ServiceRegistry Runtime State Fields

Extended `apps/api/src/services/types/service-registry.ts` with:

```typescript
/** Symbols currently being monitored (for resume resubscription) */
monitoredSymbols: string[];

/** Indicator configs for all symbol/timeframe combinations */
indicatorConfigs: Array<{ symbol: string; timeframe: Timeframe }>;

/** Supported timeframes for alert service */
timeframes: Timeframe[];
```

These fields allow resume to restart services with the correct configuration.

### ServiceRegistry Injection in server.ts

Updated `apps/api/src/server.ts` to:

1. Move ControlChannelService creation after all other services
2. Build ServiceRegistry with all service references
3. Pass ServiceRegistry to ControlChannelService constructor

```typescript
const serviceRegistry: ServiceRegistry = {
  coinbaseAdapter,
  indicatorService,
  alertService,
  boundaryRestService,
  redis,
  db,
  config: runtimeConfig,
  monitoredSymbols,
  indicatorConfigs,
  timeframes: SUPPORTED_TIMEFRAMES,
};

const controlChannelService = new ControlChannelService(TEST_IDENTITY_SUB, serviceRegistry);
```

### Command Dispatcher

Replaced stub `executeCommand()` with proper dispatcher:

```typescript
switch (type) {
  case 'pause':
    return this.handlePause();
  case 'resume':
    return this.handleResume();
  case 'reload-settings':
    return this.handleReloadSettings();
  // ... other commands
}
```

### Pause Handler (RUN-04)

Stops services in dependency order (downstream to upstream):

1. **AlertService** - Stop consuming indicator events
2. **CoinbaseAdapter** - Disconnect WebSocket (stop producing candle events)
3. **BoundaryRestService** - Stop fetching higher timeframes
4. **IndicatorService** - Stop processing candles

Sets `isPaused = true` and returns `{ status: 'paused', timestamp }`.

### Resume Handler (RUN-05)

Starts services in dependency order (upstream to downstream):

1. **IndicatorService** - Start listening before events arrive
2. **CoinbaseAdapter** - Connect WebSocket and resubscribe
3. **BoundaryRestService** - Start listening for boundary events
4. **AlertService** - Start evaluating alerts

Sets `isPaused = false` and returns `{ status: 'resumed', timestamp }`.

### Stub Handlers

Added stub handlers for remaining commands (Plan 03):
- `handleReloadSettings()` - RUN-06
- `handleSwitchMode()` - RUN-07
- `handleForceBackfill()` - RUN-08
- `handleClearCache()` - RUN-09
- `handleAddSymbol()` - Symbol management
- `handleRemoveSymbol()` - Symbol management

All throw "not yet implemented" to fail explicitly rather than silently.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 3 | Add runtime state fields to ServiceRegistry | 91943d9 |
| 1 | Inject ServiceRegistry into ControlChannelService | c5d83d5 |
| 2 | Implement command dispatcher and handlers | 6eadcfc |

## Deviations from Plan

None - plan executed exactly as written. Task 3 was executed first because Tasks 1 and 2 depend on the fields it adds.

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compiles | PASS |
| Server starts successfully | PASS |
| ServiceRegistry includes runtime state fields | PASS |
| ControlChannelService receives ServiceRegistry | PASS |
| Pause handler stops services in correct order | PASS |
| Resume handler starts services in correct order | PASS |
| Stub handlers throw explicit errors | PASS |

## Next Phase Readiness

**Ready for 19-03:** Pause and resume are fully functional. Plan 03 will implement:
1. `reload-settings` - Refresh settings from database
2. `switch-mode` - Toggle live/paper trading
3. `force-backfill` - Trigger cache backfill
4. `clear-cache` - Delete Redis keys
5. `add-symbol` / `remove-symbol` - Dynamic symbol management

No blockers identified.
