# Summary: Phase 24-01 Key Functions

**Status:** Complete
**Executed:** 2026-02-06

## What Was Built

Added exchange-scoped and user-overflow key builder functions to the cache package:

1. **Tier 1: Exchange-Scoped Keys (Shared Data)**
   - `exchangeCandleKey(exchangeId, symbol, timeframe)` → `candles:{exchangeId}:{symbol}:{timeframe}`
   - `exchangeIndicatorKey(exchangeId, symbol, timeframe, type, params?)` → `indicator:{exchangeId}:...`
   - `exchangeCandleCloseChannel(exchangeId, symbol, timeframe)` → `channel:exchange:{exchangeId}:candle:close:...`
   - `exchangeCandleClosePattern(exchangeId, symbol, timeframe)` → Pattern for psubscribe

2. **Tier 2: User-Scoped Keys (Overflow Data)**
   - `userCandleKey(userId, exchangeId, symbol, timeframe)` → `usercandles:{userId}:{exchangeId}:...`
   - `userIndicatorKey(userId, exchangeId, symbol, timeframe, type, params?)` → `userindicator:{userId}:...`

3. **Legacy Functions Deprecated**
   - `candleKey` - marked @deprecated
   - `indicatorKey` - marked @deprecated
   - `candleChannel` - marked @deprecated
   - `candleCloseChannel` - marked @deprecated
   - `candleClosePattern` - marked @deprecated

## Files Modified

- `packages/cache/src/keys.ts` - Added 6 new key functions, organized with section comments
- `packages/cache/src/index.ts` - Re-exported new key functions

## Verification

- [x] `exchangeCandleKey(1, 'BTC-USD', '5m')` returns `candles:1:BTC-USD:5m`
- [x] `exchangeIndicatorKey(1, 'BTC-USD', '5m', 'macd-v')` returns `indicator:1:BTC-USD:5m:macd-v`
- [x] `userCandleKey(42, 1, 'BTC-USD', '5m')` returns `usercandles:42:1:BTC-USD:5m`
- [x] `exchangeCandleCloseChannel(1, 'BTC-USD', '5m')` returns `channel:exchange:1:candle:close:BTC-USD:5m`
- [x] Legacy functions still work (backward compatible)
- [x] TypeScript compiles without errors

## Requirements Satisfied

- **DATA-01**: `exchangeCandleKey` produces `candles:{exchange_id}:{symbol}:{timeframe}`
- **DATA-02**: `exchangeIndicatorKey` produces `indicator:{exchange_id}:{symbol}:{timeframe}:{type}`
- **DATA-03**: `userCandleKey` produces `usercandles:{userId}:{exchange_id}:{symbol}:{timeframe}`
- **DATA-05**: `exchangeCandleCloseChannel` produces `channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}`
