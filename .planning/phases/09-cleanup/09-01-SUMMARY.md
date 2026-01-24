---
phase: 09-cleanup
plan: 01
subsystem: data-pipeline
tags: [migration, websocket, candles, adapter, deprecation]
dependency_graph:
  requires:
    - 05-01 (CoinbaseAdapter base infrastructure)
    - 05-02 (Candle message handling)
    - 05-03 (Reconnection and backfill)
    - 08-03 (Server integration with BoundaryRestService)
  provides:
    - Server using CoinbaseAdapter for native 5m WebSocket candles
    - Legacy CoinbaseWebSocketService deprecated but preserved
    - Clean indicator hot path with zero REST calls
  affects:
    - Production runtime (now using CoinbaseAdapter)
    - Future maintenance (deprecated service can be removed in v2.1)
tech_stack:
  added: []
  patterns:
    - Adapter pattern for exchange connectivity
    - Deprecation with migration guidance
key_files:
  created: []
  modified:
    - apps/api/src/server.ts
    - apps/api/src/services/coinbase-websocket.service.ts
decisions:
  - id: CLEANUP-PRESERVE-LEGACY
    description: Deprecate but preserve CoinbaseWebSocketService for rollback
    reason: Safety net if issues discovered with CoinbaseAdapter in production
metrics:
  duration: 5m
  completed: 2026-01-23
---

# Phase 09 Plan 01: Cleanup - Service Switchover Summary

**One-liner:** Server switched from ticker-based 1m candle building (CoinbaseWebSocketService) to native 5m WebSocket candles (CoinbaseAdapter), eliminating data gaps from low-liquidity symbols.

## What Was Built

### Task 1: Replace CoinbaseWebSocketService with CoinbaseAdapter in server.ts

**Status:** Complete

Migrated server.ts to use the new CoinbaseAdapter:

1. **Import update** (line 9):
   ```typescript
   import { CoinbaseRestClient, StartupBackfillService, BoundaryRestService, DEFAULT_BOUNDARY_CONFIG, CoinbaseAdapter } from '@livermore/coinbase-client';
   ```

2. **Service instantiation** (lines 263-271):
   ```typescript
   const coinbaseAdapter = new CoinbaseAdapter({
     apiKeyId: config.Coinbase_ApiKeyId,
     privateKeyPem: config.Coinbase_EcPrivateKeyPem,
     redis,
     userId: 1,
     exchangeId: 1,
   });
   await coinbaseAdapter.connect();
   coinbaseAdapter.subscribe(monitoredSymbols, '5m');
   ```

3. **Shutdown handler** (line 304):
   ```typescript
   coinbaseAdapter.disconnect();
   ```

### Task 2: Deprecate CoinbaseWebSocketService

**Status:** Complete

Marked the legacy service as deprecated while preserving it for potential rollback:

1. **File-level deprecation** (line 1-4):
   ```typescript
   /**
    * @deprecated This entire module is deprecated as of v2.0.
    * Use packages/coinbase-client/src/adapter/coinbase-adapter.ts instead.
    */
   ```

2. **Class-level deprecation** (before class definition):
   ```typescript
   /**
    * @deprecated Use CoinbaseAdapter from @livermore/coinbase-client instead.
    * This service builds 1m candles from ticker data which causes data gaps
    * for low-liquidity symbols. CoinbaseAdapter uses native 5m candles channel.
    *
    * Kept for rollback purposes - scheduled for removal in v2.1.
    */
   ```

3. **Constructor warning** (inside constructor):
   ```typescript
   logger.warn(
     'CoinbaseWebSocketService is deprecated. Use CoinbaseAdapter from @livermore/coinbase-client instead.'
   );
   ```

### Task 3: Verify no REST calls in indicator hot path

**Status:** Complete (verification only)

Confirmed the indicator service has zero REST API calls in its recalculation path:

| Search Term | Matches |
|-------------|---------|
| `restClient` | 0 |
| `CoinbaseRestClient` | 0 |
| `getCandles` | 0 |
| `fetch(` | 0 |

**Data source:** `candleCache.getRecentCandles()` (line 142) - cache-only reads.

## Code Changes

### Files Modified
- `apps/api/src/server.ts` - CoinbaseAdapter integration
- `apps/api/src/services/coinbase-websocket.service.ts` - Deprecation annotations

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 4468837 | feat | Replace CoinbaseWebSocketService with CoinbaseAdapter in server.ts |
| 47555ec | chore | Deprecate CoinbaseWebSocketService |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compiles | PASS |
| CoinbaseAdapter import | PASS |
| new CoinbaseAdapter instantiation | PASS |
| coinbaseAdapter.connect() called | PASS |
| coinbaseAdapter.subscribe() called | PASS |
| coinbaseAdapter.disconnect() in shutdown | PASS |
| CoinbaseWebSocketService NOT in server.ts | PASS |
| CoinbaseWebSocketService @deprecated | PASS |
| No REST in indicator hot path | PASS |

## Architecture Summary

The v2.0 data pipeline is now complete:

```
WebSocket Layer (CoinbaseAdapter)
    |
    | Native 5m candles from Coinbase candles channel
    v
+-------------------+
|   Redis Cache     |<-- Backfill Service (startup)
+-------------------+<-- BoundaryRestService (15m/1h/4h/1d at boundaries)
    |
    | candle:close events
    v
Indicator Service (cache-only reads)
    |
    v
Alert Evaluation
```

**Key improvements over v1.0:**
- No data gaps from low-liquidity symbols (native 5m candles, not ticker-built 1m)
- Zero REST calls in indicator hot path (eliminates 429 errors during calculation)
- Event-driven higher timeframe fetching (no cron, no aggregation)

## Next Steps

**v2.0 complete.** All phases (04-09) are now finished.

**Future work (v2.1):**
- Remove deprecated CoinbaseWebSocketService after production validation
- Consider removing 1m timeframe from supported list (WebSocket only provides 5m)
