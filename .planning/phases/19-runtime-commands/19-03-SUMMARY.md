---
phase: 19-runtime-commands
plan: 03
title: Remaining Command Handlers
subsystem: control-channel
tags: [command-handlers, force-backfill, clear-cache, reload-settings, switch-mode]
dependency-graph:
  requires: [19-02]
  provides: [reload-settings-handler, switch-mode-handler, force-backfill-handler, clear-cache-handler]
  affects: [20-symbol-management]
tech-stack:
  added: []
  patterns: [pattern-based-deletion, service-instantiation]
key-files:
  created: []
  modified:
    - apps/api/src/services/control-channel.service.ts
decisions:
  - id: CMD-03
    title: Cache clearing scope
    choice: "Three scopes: all, symbol, timeframe"
    rationale: "Provides granular control over what cache to clear"
  - id: CMD-04
    title: Force backfill indicator recalculation
    choice: "Loop through timeframes and call forceRecalculate"
    rationale: "Ensures indicators are updated after fresh candle data"
metrics:
  duration: 7m
  completed: 2026-01-31
---

# Phase 19 Plan 03: Remaining Command Handlers Summary

Complete implementation of runtime command handlers for reload-settings (RUN-06), switch-mode (RUN-07), force-backfill (RUN-08), and clear-cache (RUN-09).

## What Was Built

### reload-settings Handler (RUN-06)

Fetches user settings from database using identitySub lookup:

```typescript
private async handleReloadSettings(): Promise<Record<string, unknown>> {
  const result = await this.services.db
    .select({ settings: users.settings })
    .from(users)
    .where(
      and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, this.identitySub)
      )
    )
    .limit(1);
  // ...
}
```

Returns confirmation with `hasSettings` flag. TODO comment added for future settings application when symbol management is implemented.

### switch-mode Handler (RUN-07)

Validates mode against allowed values but does not actually switch:

```typescript
const validModes = ['position-monitor', 'scalper-macdv', 'scalper-orderbook'];
// Returns stub response indicating no actual mode switch
return {
  switched: false,
  mode,
  message: 'Mode switching is a stub - actual implementation pending strategy work',
  validModes,
};
```

This is per RUN-07 specification - actual mode switching requires strategy implementation in a future milestone.

### force-backfill Handler (RUN-08)

Triggers candle backfill for a specified symbol:

```typescript
private async handleForceBackfill(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const symbol = payload?.symbol as string;
  const timeframes: Timeframe[] = requestedTimeframes ?? ['1m', '5m', '15m', '1h', '4h', '1d'];

  // Create backfill service with credentials from config
  const backfillService = new StartupBackfillService(
    this.services.config.apiKeyId,
    this.services.config.privateKeyPem,
    this.services.redis
  );

  await backfillService.backfill([symbol], timeframes);

  // Force indicator recalculation after backfill
  for (const timeframe of timeframes) {
    await this.services.indicatorService.forceRecalculate(symbol, timeframe);
  }
}
```

### clear-cache Handler (RUN-09)

Clears Redis cache with three scope options:

| Scope | Description | Required Params |
|-------|-------------|-----------------|
| `all` | Delete all candles, indicators, and tickers | None |
| `symbol` | Delete all timeframes for a specific symbol | `symbol` |
| `timeframe` | Delete all symbols for a specific timeframe | `timeframe` |

Uses Redis KEYS pattern matching followed by DEL:

```typescript
const candlePattern = `candles:${userId}:${exchangeId}:${symbol}:*`;
const candleKeys = await this.services.redis.keys(candlePattern);
if (allKeys.length > 0) {
  await this.services.redis.del(...allKeys);
}
```

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Implement reload-settings handler (RUN-06) | 00f4d18 |
| 2 | Implement switch-mode handler stub (RUN-07) | cc8efae |
| 3 | Implement force-backfill and clear-cache (RUN-08, RUN-09) | 008bf72 |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compiles | PASS |
| Server starts successfully | PASS |
| All Phase 19 handlers implemented | PASS |
| reload-settings queries database | PASS |
| switch-mode validates mode | PASS |
| force-backfill uses StartupBackfillService | PASS |
| clear-cache supports all scopes | PASS |

## Remaining Stubs

The following handlers remain as stubs (will be implemented in Phase 20):

- `handleAddSymbol()` - Dynamic symbol addition
- `handleRemoveSymbol()` - Dynamic symbol removal

These are not part of Phase 19 requirements (RUN-04 to RUN-09).

## Phase 19 Complete

All Phase 19 requirements (RUN-04 through RUN-09) are now satisfied:

| Requirement | Handler | Status |
|-------------|---------|--------|
| RUN-04 | handlePause | Complete (19-02) |
| RUN-05 | handleResume | Complete (19-02) |
| RUN-06 | handleReloadSettings | Complete (19-03) |
| RUN-07 | handleSwitchMode | Complete (19-03) |
| RUN-08 | handleForceBackfill | Complete (19-03) |
| RUN-09 | handleClearCache | Complete (19-03) |

## Next Phase Readiness

**Ready for Phase 20 (Symbol Management):**
- All runtime command infrastructure is in place
- add-symbol and remove-symbol stubs ready for implementation
- ServiceRegistry provides access to all needed services

No blockers identified.
