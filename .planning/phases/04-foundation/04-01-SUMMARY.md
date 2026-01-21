---
# Identification
phase: 04-foundation
plan: 01
subsystem: schemas
tags: [typescript, zod, interfaces, event-emitter]

# Dependency graph (what this plan provides to the system)
requires: []
provides:
  - UnifiedCandle schema extending CandleSchema
  - ExchangeAdapterEvents typed event map
  - IExchangeAdapter interface for adapter contract
affects:
  - 05-coinbase-adapter (implements IExchangeAdapter)
  - 06-indicator-refactor (consumes UnifiedCandle events)

# Tech tracking
tech-stack:
  added:
    - "@types/node@^25.0.9 (to schemas package for EventEmitter generics)"
  patterns:
    - Zod schema extension with .extend()
    - Node 20+ typed EventEmitter generics
    - Interface extending EventEmitter<EventMap>

# File tracking
key-files:
  created:
    - packages/schemas/src/adapter/exchange-adapter.schema.ts
    - packages/schemas/src/adapter/index.ts
  modified:
    - packages/schemas/src/index.ts
    - packages/schemas/package.json
    - pnpm-lock.yaml

# Decisions
decisions:
  - id: "04-01-D1"
    choice: "Add @types/node to schemas package"
    why: "Required for EventEmitter generic syntax in Node 20+. Schemas package is Zod-focused but needs Node types for adapter interface."

# Metrics
duration: "~4.5 minutes"
completed: "2026-01-21"
---

# Phase 04 Plan 01: Exchange Adapter Interfaces Summary

TypeScript interfaces and Zod schemas defined for exchange adapter pattern.

## What Was Delivered

### UnifiedCandleSchema
Extended `CandleSchema` with exchange-specific metadata:
- `exchange: string` - Exchange identifier (e.g., 'coinbase', 'binance')
- `exchangeTimestamp: string?` - Original exchange timestamp for debugging
- `sequenceNum: number?` - Sequence number for gap detection

### ExchangeAdapterEvents
Typed event map for adapter EventEmitter:
```typescript
type ExchangeAdapterEvents = {
  'candle:close': [candle: UnifiedCandle];
  'connected': [];
  'disconnected': [reason: string];
  'error': [error: Error];
  'reconnecting': [attempt: number, delay: number];
};
```

### IExchangeAdapter
Interface contract for all exchange adapters:
- `connect(): Promise<void>` - Establish WebSocket connection
- `disconnect(): void` - Gracefully close connection
- `subscribe(symbols, timeframe): void` - Subscribe to candle updates
- `unsubscribe(symbols, timeframe): void` - Unsubscribe from updates
- `isConnected(): boolean` - Check connection status

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @types/node to schemas package**
- **Found during:** Task 1
- **Issue:** TypeScript compilation failed with "Cannot find module 'events'" - schemas package lacked Node type definitions required for EventEmitter generics
- **Fix:** Added `@types/node` as devDependency to packages/schemas
- **Files modified:** packages/schemas/package.json, pnpm-lock.yaml
- **Commit:** c3686e6

## Verification Results

All checks passed:
- `npx tsc --noEmit -p packages/schemas/tsconfig.json` - compiles without errors
- `npx tsc --noEmit -p packages/cache/tsconfig.json` - compiles without errors
- `pnpm run build` in schemas package - builds successfully
- Exports verified in dist/index.d.ts - all 4 exports present

## Success Criteria Status

- [x] UnifiedCandleSchema extends CandleSchema with 3 new fields
- [x] UnifiedCandle type inferred from schema (not manually defined)
- [x] ExchangeAdapterEvents defines typed event map for 5 events
- [x] IExchangeAdapter extends EventEmitter<ExchangeAdapterEvents>
- [x] All types exported from @livermore/schemas package
- [x] TypeScript compilation succeeds across monorepo

## Commits

| Hash | Message | Files |
|------|---------|-------|
| c3686e6 | feat(04-01): add UnifiedCandle schema and IExchangeAdapter interface | exchange-adapter.schema.ts, package.json, pnpm-lock.yaml |
| 1c55edf | feat(04-01): create barrel export and update schemas index | adapter/index.ts, index.ts |

## Next Phase Readiness

Phase 04-02 (Base Adapter Class) can now proceed:
- IExchangeAdapter interface available for BaseExchangeAdapter to implement
- UnifiedCandle type available for event emission
- ExchangeAdapterEvents type available for typed EventEmitter

No blockers identified.
