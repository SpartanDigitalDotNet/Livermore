---
phase: 06-indicator-refactor
plan: 02
subsystem: indicator-calculation
tags: [redis-pubsub, event-driven, cache-first, ioredis, macd-v]

dependency-graph:
  requires: [04-foundation, 05-coinbase-adapter]
  provides: [event-driven-indicators, cache-only-reads, 60-candle-readiness]
  affects: [07-startup-backfill, 08-reconciliation]

tech-stack:
  added: []
  patterns: [redis-psubscribe, dedicated-subscriber, readiness-gate]

key-files:
  created: []
  modified:
    - apps/api/src/services/indicator-calculation.service.ts
    - apps/api/src/server.ts
    - packages/cache/src/keys.ts

decisions:
  - id: IND-PATTERN
    choice: "Redis psubscribe with wildcard pattern"
    reason: "Scales to any number of symbols without individual subscriptions"
  - id: IND-THRESHOLD
    choice: "60-candle readiness threshold (not 35)"
    reason: "Project requirement for TradingView alignment per IND-03"
  - id: IND-NO-WARMUP
    choice: "Defer warmup to Phase 07"
    reason: "Clear separation of concerns; Phase 06 is pure event-driven refactor"

metrics:
  duration: "10m"
  completed: 2026-01-21
---

# Phase 06 Plan 02: Event-Driven Indicator Refactor Summary

Event-driven indicator calculation with Redis psubscribe for candle:close events, cache-only reads, and 60-candle readiness gates.

## What Was Delivered

### Task 1: candleClosePattern helper (b368a86)

Added `candleClosePattern()` function to `@livermore/cache` for Redis psubscribe patterns:

```typescript
// Subscribe to all 5m closes for user 1, exchange 1
candleClosePattern(1, 1, '*', '5m')
// Returns: "channel:candle:close:1:1:*:5m"
```

### Task 2: IndicatorCalculationService Refactor (d95b49d)

Major refactor of `IndicatorCalculationService`:

**Removed:**
- REST API calls in recalculation path (`fetchRecentCandles`, `fetchHistoricalCandles`)
- Batch processing for rate limiting (no longer needed)
- WebSocket-to-indicator callback wiring in server.ts
- `onCandleClose()` public method (replaced by Redis subscription)

**Added:**
- Dedicated Redis subscriber connection (`this.subscriber = this.redis.duplicate()`)
- psubscribe pattern subscription for 5m candle:close events
- `handleCandleCloseEvent()` for Redis pmessage handling
- `recalculateFromCache()` for cache-only indicator recalculation
- 60-candle `REQUIRED_CANDLES` constant (IND-03)
- Async `stop()` method with proper cleanup

**Changed:**
- `HIGHER_TIMEFRAMES` now excludes 5m (source timeframe)
- Constructor no longer creates REST client (kept parameters for compatibility)
- Boundary crossing recalculation uses cache-only reads

## Key Implementation Details

### Redis psubscribe Pattern

```typescript
const pattern = candleClosePattern(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, '*', '5m');
await this.subscriber.psubscribe(pattern);

this.subscriber.on('pmessage', (_pattern, channel, message) => {
  this.handleCandleCloseEvent(channel, message).catch(error => {
    logger.error({ error, channel }, 'Error handling candle:close event');
  });
});
```

### Readiness Gate (IND-03)

```typescript
private readonly REQUIRED_CANDLES = 60;

if (candles.length < this.REQUIRED_CANDLES) {
  logger.debug({
    symbol, timeframe,
    available: candles.length,
    required: this.REQUIRED_CANDLES,
  }, 'Skipping indicator calculation - insufficient candles');
  return;
}
```

### Cache-Only Reads

```typescript
// Read from cache ONLY - no REST API calls
const candles = await this.candleCache.getRecentCandles(
  this.TEST_USER_ID,
  this.TEST_EXCHANGE_ID,
  symbol,
  timeframe,
  200
);
```

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `packages/cache/src/keys.ts` | +18 | Added candleClosePattern() |
| `apps/api/src/services/indicator-calculation.service.ts` | -243 | Event-driven refactor |
| `apps/api/src/server.ts` | -8 | Removed WebSocket-indicator wiring |

## Verification Results

- TypeScript compiles: PASS
- No REST calls in recalculation path: PASS (0 occurrences)
- psubscribe used: PASS
- REQUIRED_CANDLES = 60: PASS
- Dedicated subscriber lifecycle: PASS

## Deviations from Plan

None - plan executed exactly as written.

## Dependencies for Next Phase

Phase 07 (Startup Backfill) will need to:
1. Populate cache with initial candles before indicators can calculate
2. Use REST API for warmup (indicator service no longer does this)
3. Ensure 60+ candles are cached before indicator service can produce output

## Notes

- Constructor parameters (`apiKeyId`, `privateKeyPem`) kept for backward compatibility with `server.ts`
- REST client removed entirely (Phase 07 will handle warmup with its own client)
- Indicator service now operates purely reactively - no proactive data fetching
