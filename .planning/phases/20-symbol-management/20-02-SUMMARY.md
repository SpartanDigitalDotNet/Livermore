---
phase: 20-symbol-management
plan: 02
subsystem: control-channel
tags: [redis-pubsub, symbol-management, jsonb, drizzle-orm]

dependency-graph:
  requires:
    - "20-01 (Symbol router for validation)"
    - "18-control-channel (ControlChannelService infrastructure)"
    - "17-settings-infrastructure (UserSettingsSchema with symbols field)"
  provides:
    - "handleAddSymbol command handler (SYM-01)"
    - "handleRemoveSymbol command handler (SYM-02)"
    - "cleanupSymbolCache helper for Redis cleanup"
  affects:
    - "22-admin-ui (Control panel can now add/remove symbols)"

tech-stack:
  added: []
  patterns:
    - "JSONB atomic updates via jsonb_set SQL"
    - "Symbol normalization (uppercase, trim)"
    - "In-memory array synchronization with database"
    - "Cascading cache cleanup on symbol removal"

file-tracking:
  created: []
  modified:
    - "apps/api/src/services/control-channel.service.ts"

decisions:
  - decision: "Atomic JSONB update via raw SQL"
    rationale: "jsonb_set ensures atomic array modification without race conditions"
  - decision: "Backfill before WebSocket subscription"
    rationale: "Ensures indicator data available before live updates arrive"
  - decision: "Hardcoded userId/exchangeId for cache keys"
    rationale: "Single-user system; multi-user support deferred to v4.1"

metrics:
  duration: "~6 minutes"
  completed: "2026-01-31"
---

# Phase 20 Plan 02: Symbol CRUD API Summary

**One-liner:** Command handlers for add-symbol and remove-symbol with JSONB persistence, backfill, and cache cleanup

## What Was Built

Implemented two command handlers in `ControlChannelService` that enable dynamic symbol management via Redis pub/sub commands:

### 1. handleAddSymbol (SYM-01)

Adds a symbol to the user's watchlist with full monitoring setup:

```typescript
// Flow:
// 1. Normalize symbol (uppercase, trim)
// 2. Check if already exists in watchlist
// 3. Update database via jsonb_set
// 4. Push to in-memory monitoredSymbols array
// 5. If not paused:
//    a. Backfill historical data via StartupBackfillService
//    b. Add indicator configs for all timeframes
//    c. Force indicator recalculation
//    d. Resubscribe WebSocket with new symbol
```

**Response:**
```json
{
  "added": true,
  "symbol": "SOL-USD",
  "totalSymbols": 5,
  "backfilled": true,
  "timestamp": 1769903374000
}
```

### 2. handleRemoveSymbol (SYM-02)

Removes a symbol from the watchlist with full cleanup:

```typescript
// Flow:
// 1. Normalize symbol
// 2. Check if exists in watchlist
// 3. Update database via jsonb_set (filter out symbol)
// 4. Remove from in-memory array
// 5. Clean up Redis cache (ticker, candles, indicators)
// 6. If not paused:
//    a. Filter out from indicatorConfigs
//    b. Resubscribe WebSocket without symbol
```

**Response:**
```json
{
  "removed": true,
  "symbol": "SOL-USD",
  "totalSymbols": 4,
  "timestamp": 1769903374000
}
```

### 3. cleanupSymbolCache Helper

Private method that deletes all Redis keys for a removed symbol:
- `ticker:{userId}:{exchangeId}:{symbol}`
- `candles:{userId}:{exchangeId}:{symbol}:{tf}` (for each timeframe)
- `indicator:{userId}:{exchangeId}:{symbol}:{tf}:macd-v` (for each timeframe)

## Key Implementation Details

**JSONB Update Pattern:**
```typescript
await this.services.db.execute(sql`
  UPDATE users
  SET settings = jsonb_set(
    COALESCE(settings, '{}'),
    '{symbols}',
    ${JSON.stringify(newSymbols)}::jsonb,
    true
  ),
  updated_at = NOW()
  WHERE identity_provider = 'clerk' AND identity_sub = ${this.identitySub}
`);
```

**Type Safety:** Used `as Record<string, unknown>` casting for settings JSONB field to avoid `any` type.

**Import Added:** `sql` from 'drizzle-orm' for raw SQL execution.

## Commits

| Hash | Description |
|------|-------------|
| 7803a52 | feat(20-02): implement handleAddSymbol command handler (SYM-01) |
| 934e59b | feat(20-02): implement handleRemoveSymbol command handler (SYM-02) |

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/services/control-channel.service.ts` | Modified (+221 lines, -9 lines) |

## Deviations from Plan

None - plan executed exactly as written.

## Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| SYM-01 | Complete | handleAddSymbol persists to DB, backfills, subscribes |
| SYM-02 | Complete | handleRemoveSymbol persists to DB, cleans cache, unsubscribes |

## Verification Checklist

- [x] handleAddSymbol updates database via jsonb_set
- [x] handleAddSymbol triggers backfill before adding to live subscription
- [x] handleAddSymbol adds indicator configs for all timeframes
- [x] handleRemoveSymbol updates database to remove symbol
- [x] handleRemoveSymbol cleans up Redis cache (ticker, candles, indicators)
- [x] handleRemoveSymbol removes from indicatorConfigs
- [x] Both handlers update in-memory monitoredSymbols array
- [x] TypeScript compiles: `cd apps/api && pnpm tsc --noEmit`

## Next Phase Readiness

**Phase 20 Complete:** Symbol management backend is fully implemented:
- 20-01: Symbol router API (search, validate, metrics)
- 20-02: Command handlers (add-symbol, remove-symbol)

**Ready for Phase 21:** Admin UI can now be built to consume these endpoints and commands.

**Blockers:** None
