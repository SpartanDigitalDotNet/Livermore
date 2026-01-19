# Coinbase API Optimization Analysis

**Date:** 2026-01-19
**Issue:** 429 (Too Many Requests) errors from Coinbase REST API

## Problem Summary

The indicator calculation service hits Coinbase REST API on every candle recalculation, causing rate limit errors at timeframe boundaries (especially :00, :15, :30, :45 marks).

## Evidence

```
2026-01-19T03:16:00 - Multiple 429s at 5m + 15m boundary
2026-01-19T03:31:01 - Multiple 429s at 5m + 15m boundary
```

Affected symbols: LRDS, PENGU, BONK, WLD, SYRUP, MATH, ETH, BTC, SPK

## Current Architecture (Broken)

```
WebSocket (ticker)
    → Build 1m candle locally
    → Emit candleClose event
    → Indicator service receives event
    → REST API call (getCandles) ← PROBLEM!
    → Save to Redis cache
    → Calculate indicators
```

**API call frequency (25 symbols):**
- Every minute: 25 REST calls (1m recalc)
- Every 5 min: +25 calls (5m boundary)
- Every 15 min: +25 calls (15m boundary)
- Every hour: +25 calls (1h boundary)
- Worst case at 4h boundary: 125+ calls in burst

## Root Causes

### 1. WebSocket candles not saved to Redis
File: `apps/api/src/services/coinbase-websocket.service.ts`
- Line 93-122: Builds 1m candles from ticker data
- Line 103: Emits candleClose event
- **Missing:** Never saves candle to Redis cache (only saves tickers at line 196)

### 2. Indicator service always calls REST API
File: `apps/api/src/services/indicator-calculation.service.ts`
- Line 408: `const recentCandles = await this.fetchRecentCandles(symbol, timeframe, 3);`
- Every recalculation hits REST API instead of reading from cache

### 3. Not using WebSocket candles channel
File: `apps/api/src/services/coinbase-websocket.service.ts`
- Line 68: Only subscribes to `['ticker', 'level2']`
- Coinbase WebSocket supports `candles` channel (5m granularity)

## Coinbase WebSocket Candles Channel

**Confirmed available:** Line 114 in `packages/coinbase-client/src/websocket/client.ts`:
```typescript
* Public channels (ticker, level2, candles, market_trades) don't require JWT
```

**Subscription:**
```json
{
  "type": "subscribe",
  "product_ids": ["ETH-USD"],
  "channel": "candles",
  "jwt": "XYZ"
}
```

**Capabilities:**
- 5-minute buckets
- Updates every second
- Provides: start, high, low, open, close, volume

**REST API timeframes:** 1m, 5m, 15m, 1h, 6h, 1d

## Proposed Architecture

```
WebSocket (ticker) → Build 1m candle → SAVE TO REDIS CACHE
WebSocket (candles) → Receive 5m candle → SAVE TO REDIS CACHE

On candleClose event:
    → READ FROM REDIS CACHE (no REST API!)
    → Aggregate higher timeframes from cached 1m/5m data
    → Calculate indicators
    → Cache indicator results

REST API usage:
    → ONLY at startup for historical backfill
    → NEVER during normal operation
```

## Changes Required

### 1. WebSocket service: Save candles to Redis
```typescript
// In aggregateTickerToCandle(), after closing candle:
await this.candleCache.addCandle(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, candleData);
```

### 2. WebSocket service: Subscribe to candles channel
```typescript
// In start():
this.wsClient.subscribe(['ticker', 'level2', 'candles'], products);
```

### 3. Add candles message handler
```typescript
// Handle 5m candles from WebSocket
private async handleCandles(message: CoinbaseWSMessage): Promise<void> {
  // Parse candle data and save to Redis cache
}
```

### 4. Indicator service: Read from cache, not REST API
```typescript
// In recalculateForConfig():
// REMOVE: const recentCandles = await this.fetchRecentCandles(symbol, timeframe, 3);
// REPLACE WITH: Read from Redis cache only
```

### 5. Aggregate higher timeframes from cached data
```typescript
// For 15m, 1h, 4h, 1d: aggregate from cached 1m or 5m candles
// No REST API needed
```

## Expected Outcome

- **Zero REST API calls** during normal operation
- **REST API only at startup** for historical backfill
- **No more 429 errors**
- **Lower latency** (cache reads vs API calls)
- **Reduced Coinbase API usage** (better rate limit headroom)

## Files to Modify

1. `apps/api/src/services/coinbase-websocket.service.ts`
   - Save 1m candles to Redis
   - Subscribe to candles channel
   - Handle candles messages

2. `packages/coinbase-client/src/websocket/client.ts`
   - Add CoinbaseCandleEvent interface
   - Add candles to CoinbaseWSMessage type

3. `apps/api/src/services/indicator-calculation.service.ts`
   - Remove REST API calls in recalculateForConfig()
   - Read from Redis cache only
   - Add aggregation logic for higher timeframes

## References

- [Coinbase WebSocket Channels](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-channels)
- [Coinbase WebSocket Overview](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-overview)
