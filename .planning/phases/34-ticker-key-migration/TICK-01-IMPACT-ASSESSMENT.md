# TICK-01: Ticker Key Migration Impact Assessment

## Current State

The ticker key functions in `packages/cache/src/keys.ts` use **user-scoped** patterns:

| Function | Pattern | Scope |
|----------|---------|-------|
| `tickerKey(userId, exchangeId, symbol)` | `ticker:{userId}:{exchangeId}:{symbol}` | User-scoped |
| `tickerChannel(userId, exchangeId, symbol)` | `channel:ticker:{userId}:{exchangeId}:{symbol}` | User-scoped |

These are the **last remaining user-scoped key patterns** in the codebase. Candles and indicators were migrated to exchange-scoped keys in v5.0.

## Target State

Migrate to **exchange-scoped** patterns (consistent with candles and indicators):

| Function | Pattern | Scope |
|----------|---------|-------|
| `tickerKey(exchangeId, symbol)` | `ticker:{exchangeId}:{symbol}` | Exchange-scoped |
| `tickerChannel(exchangeId, symbol)` | `channel:ticker:{exchangeId}:{symbol}` | Exchange-scoped |

## Affected Files

### Cache Layer (Function Definitions)

| File | Function/Usage | Current Pattern | Change Required |
|------|---------------|----------------|-----------------|
| `packages/cache/src/keys.ts` | `tickerKey()` function signature | `ticker:{userId}:{exchangeId}:{symbol}` | Remove `userId` param, return `ticker:{exchangeId}:{symbol}` |
| `packages/cache/src/keys.ts` | `tickerChannel()` function signature | `channel:ticker:{userId}:{exchangeId}:{symbol}` | Remove `userId` param, return `channel:ticker:{exchangeId}:{symbol}` |
| `packages/cache/src/strategies/ticker-cache.ts` | `TickerCacheStrategy` class (6 methods: setTicker, getTicker, getTickers, publishUpdate, deleteTicker, hasTicker) | All methods take `(userId, exchangeId, ...)` | Remove `userId` param from all 6 methods |

### Writers (Set Ticker Data + Publish Updates)

| File | Function/Usage | Current Pattern | Change Required |
|------|---------------|----------------|-----------------|
| `packages/exchange-core/src/adapter/coinbase-adapter.ts` | `setTicker(this.userId, this.exchangeIdNum, ticker)` at line 574; `publishUpdate(this.userId, this.exchangeIdNum, ticker)` at line 577 | Passes `this.userId` as first arg | Remove `this.userId` arg from both calls |
| `apps/api/src/services/coinbase-websocket.service.ts` | `setTicker(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, ticker)` at line 233; `publishUpdate(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, ticker)` at line 236 | DEPRECATED service, passes `TEST_USER_ID` | Remove `this.TEST_USER_ID` arg from both calls |

### Readers (Get Ticker Data)

| File | Function/Usage | Current Pattern | Change Required |
|------|---------------|----------------|-----------------|
| `apps/api/src/routers/indicator.router.ts` | `getTickers(TEST_USER_ID, TEST_EXCHANGE_ID, symbols)` at line 457 | Passes `TEST_USER_ID` as first arg | Remove `TEST_USER_ID` arg |
| `apps/api/src/services/position-sync.service.ts` | `getTicker(userId, exchangeId, tradingPair)` at line 246 | Passes `userId` as first arg | Remove `userId` arg |

### Subscribers (Pub/Sub Channels)

| File | Function/Usage | Current Pattern | Change Required |
|------|---------------|----------------|-----------------|
| `apps/api/src/services/alert-evaluation.service.ts` | `tickerChannel(1, this.exchangeId, symbol)` at line 140; matches on `'channel:ticker:'` prefix at line 171 | Passes hardcoded `1` as userId | Remove `1` arg; channel prefix match unchanged |

### Inline Key Strings (Already Exchange-Scoped -- NO CHANGE NEEDED)

| File | Function/Usage | Current Pattern | Change Required |
|------|---------------|----------------|-----------------|
| `apps/api/src/server.ts` | `` `ticker:${exchangeId}:${symbol}` `` at line 175 | Already exchange-scoped | **None** |
| `apps/api/src/services/control-channel.service.ts` | `` `ticker:${exchangeId}:*` `` at line 872; `` `ticker:${exchangeId}:${symbol}` `` at lines 893, 1280 | Already exchange-scoped | **None** |

## Key Observation

The inline strings in `server.ts` and `control-channel.service.ts` already use the exchange-scoped pattern (no userId segment). This confirms the codebase has been expecting exchange-scoped ticker keys -- the `tickerKey()`/`tickerChannel()` functions just never caught up. The migration aligns the function signatures with what the rest of the codebase already assumes.

## Migration Risk Assessment

**Risk Level: LOW**

- **Scope:** Signature change on 2 functions, removing 1 parameter from 6 `TickerCacheStrategy` methods, and updating 5 caller sites
- **No database changes** -- purely a Redis key format change
- **No schema changes** -- ticker data structure unchanged
- **Existing inline strings already match target pattern** -- confirms correctness
- **Candle/indicator migration precedent** -- same pattern was applied successfully in v5.0
- **Total affected files:** 9 (2 cache layer + 2 writers + 2 readers + 1 subscriber + 2 inline-already-correct)
- **Files requiring code changes:** 7 (the 2 inline-already-correct files need no changes)

## Migration Plan

| Step | Plan | Description |
|------|------|-------------|
| TICK-01 | Plan 34-01 | This impact assessment |
| TICK-02 | Plan 34-01 | Migrate `tickerKey()`, `tickerChannel()`, and `TickerCacheStrategy` in cache package |
| TICK-03 | Plan 34-02 | Update all 5 consumer call sites (coinbase-adapter, coinbase-websocket.service, indicator.router, position-sync.service, alert-evaluation.service) |
