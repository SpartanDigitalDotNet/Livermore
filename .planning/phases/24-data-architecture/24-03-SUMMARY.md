# Summary: Phase 24-03 Exchange-Scoped Pub/Sub Channels

**Status:** Complete
**Executed:** 2026-02-06

## What Was Built

Updated pub/sub channels to use exchange-scoped patterns for cross-user visibility:

1. **CoinbaseAdapter** dual-publish:
   - Publishes to exchange-scoped channel first: `channel:exchange:{exchangeId}:candle:close:{symbol}:{timeframe}`
   - Then publishes to legacy user-scoped channel for backward compatibility
   - Both `onCandleClose` and 1m candle close use dual-publish

2. **IndicatorCalculationService** updated subscription:
   - Subscribes to exchange-scoped pattern: `channel:exchange:{exchangeId}:candle:close:*:*`
   - Channel parsing updated for new format (symbol at index 5, timeframe at index 6)

## Files Modified

- `packages/coinbase-client/src/adapter/coinbase-adapter.ts` - Added exchangeCandleCloseChannel import, dual-publish in both close handlers
- `apps/api/src/services/indicator-calculation.service.ts` - Updated subscription pattern and channel parsing

## Verification

- [x] CoinbaseAdapter imports and uses `exchangeCandleCloseChannel`
- [x] Both candle close handlers dual-publish (exchange-scoped + legacy)
- [x] IndicatorCalculationService subscribes to `channel:exchange:1:candle:close:*:*`
- [x] Channel parsing extracts correct indices (symbol=5, timeframe=6)
- [x] Full turbo build passes

## Requirements Satisfied

- **DATA-05**: Candle close events publish to `channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}`
- Indicator service subscribes to exchange-scoped pattern (no userId)
- Legacy channels still published for backward compatibility
