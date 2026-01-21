---
# Identification
phase: 04-foundation
plan: 03
subsystem: coinbase-client
tags: [typescript, abstract-class, event-emitter, reconnection]

# Dependency graph (what this plan provides to the system)
requires:
  - 04-01 (IExchangeAdapter, ExchangeAdapterEvents, Timeframe from schemas)
provides:
  - BaseExchangeAdapter abstract class with shared reconnection logic
  - Exponential backoff reconnection handling
affects:
  - 05-coinbase-adapter (extends BaseExchangeAdapter)
  - Future Binance adapter (will extend BaseExchangeAdapter)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Abstract class extending typed EventEmitter
    - Exponential backoff reconnection pattern
    - Protected method inheritance for shared behavior

# File tracking
key-files:
  created:
    - packages/coinbase-client/src/adapter/base-adapter.ts
    - packages/coinbase-client/src/adapter/index.ts
  modified:
    - packages/coinbase-client/src/index.ts

# Decisions
decisions:
  - id: "04-03-D1"
    choice: "Use abstract readonly exchangeId property"
    why: "Allows concrete adapters to define their exchange name while ensuring it exists for logging and UnifiedCandle population"

# Metrics
duration: "~3 minutes"
completed: "2026-01-21"
---

# Phase 04 Plan 03: Base Adapter Class Summary

Abstract base class implementing shared reconnection logic with exponential backoff for exchange adapters.

## What Was Delivered

### BaseExchangeAdapter Abstract Class

Located at `packages/coinbase-client/src/adapter/base-adapter.ts`.

**Class hierarchy:**
```typescript
abstract class BaseExchangeAdapter
  extends EventEmitter<ExchangeAdapterEvents>
  implements IExchangeAdapter
```

**Abstract members (must be implemented by concrete adapters):**
- `exchangeId: string` - Exchange identifier for logging
- `connect(): Promise<void>` - Establish WebSocket connection
- `disconnect(): void` - Gracefully close connection
- `subscribe(symbols, timeframe): void` - Subscribe to candle updates
- `unsubscribe(symbols, timeframe): void` - Unsubscribe from updates
- `isConnected(): boolean` - Check connection status

**Shared infrastructure:**
- `handleReconnect()` - Protected method with exponential backoff
- `resetReconnectAttempts()` - Reset counter after successful connection
- `reconnectAttempts` - Current attempt counter
- `maxReconnectAttempts = 10` - Maximum attempts before giving up
- `reconnectDelay = 5000` - Base delay (5 seconds)

**Reconnection behavior:**
1. Emits `reconnecting` event with attempt number and delay
2. Exponential backoff: delay * 2^(attempt-1)
3. Attempts reconnection up to maxReconnectAttempts
4. Emits `error` event if max attempts reached
5. Resets counter on successful reconnect

### Barrel Export

BaseExchangeAdapter is now importable from `@livermore/coinbase-client`:
```typescript
import { BaseExchangeAdapter } from '@livermore/coinbase-client';
```

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All checks passed:
- `npx tsc --noEmit -p packages/coinbase-client/tsconfig.json` - compiles without errors
- `npx tsc --noEmit -p packages/schemas/tsconfig.json` - compiles without errors
- BaseExchangeAdapter exported from @livermore/coinbase-client

## Success Criteria Status

- [x] BaseExchangeAdapter abstract class created in adapter/base-adapter.ts
- [x] Class extends EventEmitter<ExchangeAdapterEvents>
- [x] Class implements IExchangeAdapter interface
- [x] 5 abstract methods declared (connect, disconnect, subscribe, unsubscribe, isConnected)
- [x] handleReconnect() protected method with exponential backoff
- [x] exchangeId abstract property defined
- [x] Barrel export created and main index updated
- [x] TypeScript compilation succeeds

## Commits

| Hash | Message | Files |
|------|---------|-------|
| 6ccaa00 | feat(04-03): create BaseExchangeAdapter abstract class | adapter/base-adapter.ts |
| 3429a30 | feat(04-03): create barrel export for adapter module | adapter/index.ts, index.ts |

## Next Phase Readiness

Phase 05 (Coinbase Adapter) can now proceed:
- BaseExchangeAdapter available for CoinbaseAdapter to extend
- handleReconnect() provides shared reconnection infrastructure
- Typed event emission ready via EventEmitter<ExchangeAdapterEvents>

No blockers identified.
