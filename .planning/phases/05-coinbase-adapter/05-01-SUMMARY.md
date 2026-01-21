---
phase: 05
plan: 01
subsystem: coinbase-adapter
tags: [websocket, coinbase, adapter, candles, heartbeats]
dependency-graph:
  requires:
    - 04-03: BaseExchangeAdapter class
    - 04-01: IExchangeAdapter interface, ExchangeAdapterEvents
  provides:
    - CoinbaseAdapter class with WebSocket connection and subscription
    - CoinbaseAdapterOptions interface
  affects:
    - 05-02: handleMessage candle processing (consumes adapter skeleton)
    - 05-03: watchdog timer (extends this adapter)
tech-stack:
  added: []
  patterns:
    - Dual channel subscription (candles + heartbeats)
    - JWT WebSocket authentication
key-files:
  created:
    - packages/coinbase-client/src/adapter/coinbase-adapter.ts
  modified:
    - packages/coinbase-client/src/adapter/index.ts
    - packages/coinbase-client/package.json
decisions: []
metrics:
  duration: 8m
  completed: 2026-01-21
---

# Phase 05 Plan 01: Coinbase Adapter Skeleton Summary

**One-liner:** CoinbaseAdapter class with WebSocket connection to native candles channel and automatic heartbeat subscription to prevent idle disconnect.

## What Was Built

Implemented the CoinbaseAdapter class that extends BaseExchangeAdapter for connecting to Coinbase Advanced Trade WebSocket API. The adapter:

1. **Connects to native candles channel** - Uses `wss://advanced-trade-ws.coinbase.com` endpoint
2. **Subscribes to heartbeats** - Prevents 60-90 second idle disconnection
3. **Implements IExchangeAdapter interface** - `connect()`, `disconnect()`, `subscribe()`, `unsubscribe()`, `isConnected()`
4. **Emits typed events** - connected, disconnected, error, reconnecting
5. **Uses JWT authentication** - Via existing CoinbaseAuth class

## Key Technical Details

**Connection flow:**
```
connect() -> open -> subscribeToHeartbeats() -> emit('connected')
                  -> on message -> handleMessage()
                  -> on close -> handleReconnect() (if not intentional)
```

**Subscription format (candles):**
```json
{
  "type": "subscribe",
  "product_ids": ["BTC-USD", "ETH-USD"],
  "channel": "candles",
  "jwt": "<token>"
}
```

**Subscription format (heartbeats):**
```json
{
  "type": "subscribe",
  "channel": "heartbeats",
  "jwt": "<token>"
}
```

**Fields set up for Plan 02:**
- `restClient` - For backfill operations
- `candleCache` - For versioned cache writes
- `redis` - For pub/sub
- `userId`, `exchangeIdNum` - For cache key scoping

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `packages/coinbase-client/src/adapter/coinbase-adapter.ts` | Created | 248 |
| `packages/coinbase-client/src/adapter/index.ts` | Added exports | +2 |
| `packages/coinbase-client/package.json` | Added @livermore/cache, ioredis | +2 deps |

## Verification Results

All checks passed:
- TypeScript compilation: PASS
- Extends BaseExchangeAdapter: PASS
- CoinbaseAdapter exported: PASS
- WS_URL correct: PASS
- Candles channel subscription: PASS
- Heartbeats channel subscription: PASS
- 'connected' event emission: PASS
- Min 100 lines: PASS (248 lines)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ioredis version mismatch**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** Different ioredis versions between packages (5.9.1 vs 5.9.2) caused type incompatibility
- **Fix:** Pinned ioredis to 5.9.1 in coinbase-client package.json to match cache package
- **Files modified:** packages/coinbase-client/package.json
- **Commit:** e3cd8b0

## Next Steps (Plan 02)

The `handleMessage()` method is currently a stub. Plan 02 will:
1. Parse candles channel messages
2. Detect candle close events (timestamp change)
3. Write to cache using `addCandleIfNewer()`
4. Publish to `candleCloseChannel()` for indicator service

## Session Notes

- No authentication gates encountered
- All dependencies already available in workspace
- WebSocket types from @types/ws worked correctly
