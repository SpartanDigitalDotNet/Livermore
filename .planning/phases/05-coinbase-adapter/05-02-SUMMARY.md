---
phase: 05-coinbase-adapter
plan: 02
subsystem: exchange-adapter
tags: [coinbase, websocket, candles, redis, cache, events]

dependency-graph:
  requires: ["05-01", "04-02"]
  provides: ["candle-processing-pipeline", "redis-pubsub-integration"]
  affects: ["05-03", "06-01"]

tech-stack:
  added: []
  patterns: ["fire-and-forget-async", "discriminated-unions", "timestamp-based-close-detection"]

key-files:
  created: []
  modified:
    - packages/coinbase-client/src/adapter/coinbase-adapter.ts

decisions:
  - id: "05-02-001"
    decision: "Fire-and-forget candle processing"
    rationale: "Prevents WebSocket message queue backup; errors logged but don't block"
  - id: "05-02-002"
    decision: "Emit close on new candle arrival"
    rationale: "Coinbase sends finalized OHLCV in the new candle when old one closes"

metrics:
  duration: "6 minutes"
  completed: "2026-01-21"
---

# Phase 05 Plan 02: Message Processing Summary

**One-liner:** Complete candle processing pipeline with normalization, timestamp-based close detection, Redis cache writes, and dual event emission.

## What Was Built

### Type Definitions
Added TypeScript interfaces for Coinbase WebSocket messages:
- `CoinbaseWebSocketCandle` - Raw candle format (strings, UNIX seconds)
- `CandleEvent` - Snapshot or update event containing candles
- `CandlesMessage` - Full candles channel message with sequence number
- `HeartbeatsMessage` - Heartbeats channel message
- `CoinbaseWSMessage` - Discriminated union of all message types

### Candle Normalization
`normalizeCandle()` converts Coinbase format to UnifiedCandle:
- Timestamps: UNIX seconds -> milliseconds
- Prices/volume: string -> number via parseFloat
- Adds exchange identifier and sequence number
- Hardcoded to 5m timeframe (WebSocket limitation)

### Close Detection
`handleCandlesMessage()` tracks candle timestamps per symbol:
- Maintains `lastCandleTimestamps` Map
- When timestamp changes, previous candle is considered closed
- Emits close event for the NEW candle (contains finalized data)

### Cache Integration
Each candle written to Redis via `addCandleIfNewer()`:
- Versioned writes prevent out-of-order overwrites
- Errors logged but don't block processing

### Event Emission
`onCandleClose()` provides dual notification:
1. Local: `this.emit('candle:close', candle)` for in-process subscribers
2. Distributed: Redis pub/sub on `candleCloseChannel` for indicator service

### Message Routing
Updated `handleMessage()` for proper routing:
- Candles -> `handleCandlesMessage()` (fire-and-forget)
- Heartbeats -> debug logging
- Subscriptions -> info logging
- Errors -> error logging
- Unknown -> warning logging

## Commits

| Hash | Description |
|------|-------------|
| f7e5216 | Add Coinbase WebSocket message type definitions |
| 2f69825 | Implement candle normalization and close detection |
| 7a23f35 | Update handleMessage to route candles to processor |

## Key Code Patterns

```typescript
// Close detection via timestamp change
if (previousTimestamp !== undefined && previousTimestamp !== candle.timestamp) {
  await this.onCandleClose(candle);
}

// Fire-and-forget async to avoid blocking
this.handleCandlesMessage(message).catch(error => {
  logger.error({ error }, 'Error processing candles message');
});
```

## Verification Results

- [x] TypeScript compilation succeeds
- [x] normalizeCandle() exists and converts format
- [x] handleCandlesMessage() processes and detects close
- [x] onCandleClose() emits event and publishes to Redis
- [x] addCandleIfNewer() called for cache writes
- [x] candleCloseChannel used for pub/sub
- [x] File exceeds 200 lines (404 lines)

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

**Ready for 05-03:** Reconnection and resubscription logic
- Candle processing pipeline is complete
- WebSocket message handling is production-ready
- Cache and pub/sub integration is in place

**Blocked:** None

**Concerns:** None
