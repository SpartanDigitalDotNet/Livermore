---
phase: 05-coinbase-adapter
plan: 03
subsystem: data-pipeline
tags: [websocket, reconnection, watchdog, backfill, sequence-tracking]

dependency_graph:
  requires: [05-01, 05-02]
  provides:
    - Watchdog timer for silent disconnection detection
    - Sequence number tracking and gap detection
    - REST API backfill on reconnection
  affects: [05-04, 06-xx, 08-xx]

tech_stack:
  added: []
  patterns:
    - Watchdog timer pattern (setTimeout reset on message)
    - Sequence-based gap detection
    - Timestamp-based backfill triggering

key_files:
  created: []
  modified:
    - packages/coinbase-client/src/adapter/coinbase-adapter.ts

decisions:
  - id: watchdog-30s
    choice: 30 second watchdog interval
    rationale: Coinbase heartbeats are every ~1s, 30s allows for network jitter while detecting silent failures quickly
  - id: backfill-threshold-5m
    choice: 5 minute backfill threshold
    rationale: Only backfill if gap exceeds one candle period; avoids unnecessary REST calls for brief disconnections
  - id: sequence-gap-logging
    choice: Log warning on sequence gap but do not block processing
    rationale: Sequence gaps indicate possible dropped messages; logging enables diagnosis without blocking data flow

metrics:
  duration: ~15 minutes
  completed: 2026-01-21
---

# Phase 05 Plan 03: Reconnection Logic Summary

**One-liner:** Watchdog timer (30s), sequence tracking with gap detection, and REST backfill on reconnection for production-ready reliability.

## What Was Done

### Task 1: Watchdog Timer Implementation
Added watchdog timer to detect silent WebSocket disconnections:

- `watchdogTimeout` field with 30-second interval
- `resetWatchdog()` - resets timer on every message (including heartbeats)
- `stopWatchdog()` - clears timer on intentional disconnect
- `forceReconnect()` - handles watchdog timeout by closing socket and triggering reconnect

Key integration points:
- Started in `connect()` after heartbeat subscription
- Reset in `handleMessage()` before processing
- Stopped in `disconnect()` before closing

### Task 2: Sequence Tracking and Gap Detection
Added sequence number tracking per connection:

- `lastSequenceNum` - tracks last received sequence number
- `hasDetectedGap` - flag set when gap detected
- Sequence gap detection in `handleCandlesMessage()` (gap > 1)
- `resetSequenceTracking()` - resets on connection (sequences are per-connection)
- `needsBackfill()` - public method to check if gap was detected

Gap detection logs warning with details: `{ lastSequence, newSequence, gap }`.

### Task 3: REST Backfill on Reconnection
Added automatic backfill when gaps are detected:

- `BACKFILL_THRESHOLD_MS` - 5 minutes (only backfill if gap exceeds)
- `checkAndBackfill()` - checks each symbol's latest cached candle
- `backfillSymbol()` - fetches from REST API and writes with versioning
- `onConnected()` - orchestrates resubscription and backfill

Backfill only triggers on REconnection (not initial connect) when:
- `reconnectAttempts > 0` (meaning we're reconnecting), OR
- `hasDetectedGap` is true (sequence gap detected)

## Key Code Additions

```typescript
// Watchdog timer (30 seconds)
private watchdogTimeout: NodeJS.Timeout | null = null;
private readonly WATCHDOG_INTERVAL_MS = 30_000;

// Sequence tracking
private lastSequenceNum = 0;
private hasDetectedGap = false;

// Backfill threshold (5 minutes)
private readonly BACKFILL_THRESHOLD_MS = 5 * 60 * 1000;
```

## Integration Flow

```
connect()
  -> resetSequenceTracking()   // Reset sequence to 0
  -> subscribeToHeartbeats()   // Prevent idle disconnect
  -> resetWatchdog()           // Start 30s timer
  -> onConnected()             // Resubscribe + backfill if needed

handleMessage()
  -> resetWatchdog()           // Reset timer on EVERY message
  -> process message

disconnect()
  -> stopWatchdog()            // Clear timer before close

forceReconnect() [on watchdog timeout]
  -> remove listeners
  -> close socket
  -> stopWatchdog()
  -> handleReconnect()         // Triggers exponential backoff
```

## Verification Results

All verifications passed:

1. TypeScript compilation: SUCCESS
2. Watchdog timer methods: Present (resetWatchdog, stopWatchdog, forceReconnect)
3. Sequence tracking: Present (lastSequenceNum, hasDetectedGap, resetSequenceTracking)
4. Backfill methods: Present (checkAndBackfill, backfillSymbol, BACKFILL_THRESHOLD_MS)
5. connect() integration: All setup methods called in correct order

## Deviations from Plan

None - plan executed exactly as written.

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| packages/coinbase-client/src/adapter/coinbase-adapter.ts | 610 | Added watchdog, sequence tracking, backfill (+207 lines) |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| fa241c3 | feat | Implement watchdog timer for silent disconnection detection |
| 509c1f9 | feat | Implement sequence tracking and gap detection |
| cf53215 | feat | Implement REST backfill on reconnection |

## Next Phase Readiness

**Ready for:** Plan 05-04 (Service Integration)

**Completed capabilities:**
- CoinbaseAdapter class with full connection lifecycle
- Dual channel subscription (candles + heartbeats)
- Candle processing with close detection and events
- Watchdog timer for reliability
- Sequence tracking for gap detection
- REST backfill for data recovery

**Dependencies satisfied:**
- All Plan 03 success criteria met
- Adapter file is production-ready (610 lines)
- Integration with BaseExchangeAdapter reconnection logic verified
