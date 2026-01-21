---
# Identification
phase: 04-foundation
plan: 02
subsystem: cache
tags: [redis, pub-sub, versioning, sequence-numbers]

# Dependency graph (what this plan provides to the system)
requires:
  - 04-01 (UnifiedCandle schema)
provides:
  - candleCloseChannel() function for Redis pub/sub
  - addCandleIfNewer() method for versioned cache writes
affects:
  - 05-coinbase-adapter (publishes to candleCloseChannel)
  - 06-indicator-refactor (subscribes to candleCloseChannel)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Versioned writes using sequence number comparison
    - Separate pub/sub channels for updates vs finalized events

# File tracking
key-files:
  created: []
  modified:
    - packages/cache/src/keys.ts
    - packages/cache/src/strategies/candle-cache.ts

# Decisions
decisions: []

# Metrics
duration: "~2 minutes"
completed: "2026-01-21"
---

# Phase 04 Plan 02: Cache Infrastructure Summary

Redis pub/sub channel and versioned write method added for event-driven candle architecture.

## What Was Delivered

### candleCloseChannel()

New function in `packages/cache/src/keys.ts` for Redis pub/sub:

```typescript
export function candleCloseChannel(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:candle:close:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}
```

**Purpose:** Distinct from existing `candleChannel` (for updates). This channel is specifically for finalized candles, enabling the indicator service to subscribe and react when candles close.

### addCandleIfNewer()

New method on `CandleCacheStrategy` class in `packages/cache/src/strategies/candle-cache.ts`:

```typescript
async addCandleIfNewer(
  userId: number,
  exchangeId: number,
  candle: UnifiedCandle
): Promise<boolean>
```

**Versioning logic:**
- If no existing candle at timestamp: writes, returns `true`
- If existing candle with lower sequence number: writes, returns `true`
- If existing candle with equal/higher sequence number: skips, returns `false`
- If existing candle has sequence but new doesn't: skips, returns `false`
- If existing has no sequence but new does: writes, returns `true`

**Purpose:** Prevents out-of-order WebSocket messages from corrupting cache with stale data. Sequence numbers from exchange ensure ordering correctness.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All checks passed:
- `npx tsc --noEmit -p packages/cache/tsconfig.json` - compiles without errors
- `candleCloseChannel` exported from @livermore/cache (via keys.ts)
- `addCandleIfNewer` method exists on CandleCacheStrategy

## Success Criteria Status

- [x] candleCloseChannel() function added to keys.ts
- [x] Function follows existing naming pattern (channel:candle:close:...)
- [x] addCandleIfNewer() method added to CandleCacheStrategy
- [x] Method uses sequence number comparison for versioning
- [x] Method returns boolean indicating if write occurred
- [x] TypeScript compilation succeeds for cache package

## Commits

| Hash | Message | Files |
|------|---------|-------|
| 11b6d86 | feat(04-02): add candleCloseChannel() to keys.ts | keys.ts |
| 68d36c5 | feat(04-02): add addCandleIfNewer() versioned write method | candle-cache.ts |

## Next Phase Readiness

Phase 04-03 (Base Adapter Class) can now proceed:
- candleCloseChannel available for adapters to publish events
- addCandleIfNewer available for versioned cache writes

No blockers identified.
