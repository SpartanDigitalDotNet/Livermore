# Phase 10: Ticker Publisher - Research

**Researched:** 2026-01-23
**Domain:** Coinbase WebSocket ticker channel + Redis pub/sub integration
**Confidence:** HIGH

## Summary

This phase addresses a regression from the v2.0 Data Pipeline Redesign: alert notifications display "$0.00" because the new CoinbaseAdapter does not publish ticker events like the legacy CoinbaseWebSocketService did. The fix requires adding ticker channel subscription and Redis pub/sub publishing to CoinbaseAdapter.

The research examined four key files:
1. **Legacy service** (coinbase-websocket.service.ts) - DID publish tickers via `tickerCache.publishUpdate()`
2. **AlertEvaluationService** - Subscribes to `channel:ticker:{userId}:{exchangeId}:{symbol}` and expects Ticker objects
3. **CoinbaseAdapter** - Currently handles only `candles` and `heartbeats` channels, missing ticker entirely
4. **TickerCacheStrategy** - Provides `setTicker()` and `publishUpdate()` methods for Redis caching/pub/sub

**Primary recommendation:** Add ticker channel subscription to CoinbaseAdapter with minimal changes - the infrastructure (TickerCacheStrategy, channel patterns) already exists and works correctly.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | (existing) | Redis client for pub/sub | Already used throughout codebase |
| @livermore/cache | (existing) | TickerCacheStrategy | Provides ticker caching and pub/sub methods |
| @livermore/schemas | (existing) | Ticker type definition | Validates ticker data structure |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ws | (existing) | WebSocket client | Already used by CoinbaseAdapter |

### Alternatives Considered
None. All required infrastructure already exists in the codebase.

## Architecture Patterns

### Current Data Flow (Missing Ticker)

```
CoinbaseAdapter
    |
    | WebSocket: candles, heartbeats channels only
    | (NO ticker channel)
    v
+-------------------+
| CandleCacheStrategy |
+-------------------+
    |
    | candle:close events
    v
IndicatorService
    |
    v
AlertEvaluationService
    |
    X NO PRICE DATA (currentPrices map is empty)
    v
Discord: Alert shows "$0.00"
```

### Target Data Flow (With Ticker)

```
CoinbaseAdapter
    |
    | WebSocket: candles, heartbeats, ticker channels
    |
    +------------------------+
    |                        |
    v                        v
CandleCacheStrategy    TickerCacheStrategy
    |                        |
    | candle:close           | ticker:* pub/sub
    v                        v
IndicatorService       AlertEvaluationService
    |                        |
    v                        | currentPrices populated
AlertEvaluationService <-----+
    |
    v
Discord: Alert shows "$12,345.67"
```

### Pattern 1: Ticker Channel Message Structure

**What:** Coinbase WebSocket ticker channel message format
**When to use:** When parsing incoming ticker messages in CoinbaseAdapter

From `packages/coinbase-client/src/websocket/client.ts`:
```typescript
// Source: packages/coinbase-client/src/websocket/client.ts (lines 8-22)
interface CoinbaseTickerEvent {
  type: 'ticker';
  product_id: string;
  price: string;
  volume_24_h: string;
  low_24_h: string;
  high_24_h: string;
  low_52_w: string;
  high_52_w: string;
  price_percent_chg_24_h: string;
  best_bid: string;
  best_ask: string;
  best_bid_quantity: string;
  best_ask_quantity: string;
}

// Message envelope (line 39)
{ channel: 'ticker'; timestamp: string; sequence_num: number; events: Array<{ type: 'update'; tickers: CoinbaseTickerEvent[] }> }
```

### Pattern 2: Ticker Transformation (Legacy Service)

**What:** How legacy service converted Coinbase ticker to Livermore Ticker
**When to use:** As reference for CoinbaseAdapter implementation

From `apps/api/src/services/coinbase-websocket.service.ts`:
```typescript
// Source: apps/api/src/services/coinbase-websocket.service.ts (lines 207-236)
private async handleTicker(message: CoinbaseWSMessage & { channel: 'ticker' }): Promise<void> {
  for (const event of message.events) {
    if (event.type !== 'update') continue;

    for (const tickerData of event.tickers) {
      const price = parseFloat(tickerData.price);
      const timestamp = new Date(message.timestamp).getTime();
      const changePercent24h = parseFloat(tickerData.price_percent_chg_24_h);
      // Calculate absolute change from percentage: change = price - (price / (1 + pct/100))
      const change24h = price - (price / (1 + changePercent24h / 100));

      const ticker: Ticker = {
        symbol: tickerData.product_id,
        price,
        change24h,
        changePercent24h,
        volume24h: parseFloat(tickerData.volume_24_h),
        low24h: parseFloat(tickerData.low_24_h),
        high24h: parseFloat(tickerData.high_24_h),
        timestamp,
      };

      // Cache ticker in Redis
      await this.tickerCache.setTicker(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, ticker);

      // Publish update via Redis pub/sub
      await this.tickerCache.publishUpdate(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, ticker);
    }
  }
}
```

### Pattern 3: AlertEvaluationService Ticker Subscription

**What:** How AlertEvaluationService subscribes to and uses ticker data
**When to use:** Understanding the consumer of ticker pub/sub

From `apps/api/src/services/alert-evaluation.service.ts`:
```typescript
// Source: apps/api/src/services/alert-evaluation.service.ts (lines 127-129)
// Subscribe to ticker channels for all symbols (for price tracking)
for (const symbol of this.symbols) {
  channels.push(tickerChannel(1, this.TEST_EXCHANGE_ID, symbol));
}

// Source: lines 172-175
private async handleTickerUpdate(ticker: Ticker): Promise<void> {
  const { symbol, price } = ticker;
  this.currentPrices.set(symbol, price);
}

// Source: lines 407, 493
const price = this.currentPrices.get(symbol) || 0;  // <-- Returns 0 when no ticker received
```

### Pattern 4: Channel Subscription in CoinbaseAdapter

**What:** How to subscribe to additional channels (already done for heartbeats)
**When to use:** Adding ticker channel subscription

From `packages/coinbase-client/src/adapter/coinbase-adapter.ts`:
```typescript
// Source: packages/coinbase-client/src/adapter/coinbase-adapter.ts (lines 291-303)
private subscribeToHeartbeats(): void {
  if (!this.isConnected()) return;

  const token = this.auth.generateToken();
  const subscribeMessage = {
    type: 'subscribe',
    channel: 'heartbeats',
    jwt: token,
  };

  this.ws!.send(JSON.stringify(subscribeMessage));
  logger.info('Subscribed to heartbeats channel');
}
```

### Anti-Patterns to Avoid

- **Creating new pub/sub patterns:** The `tickerChannel()` pattern in `@livermore/cache` already exists. Use it.
- **Re-implementing TickerCacheStrategy:** Already exists and works. Import and use.
- **Skipping event.type check:** Coinbase sends both 'update' and 'snapshot' events. Only process 'update'.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ticker caching | Custom Redis string operations | `TickerCacheStrategy.setTicker()` | Already handles TTL (60s), Zod validation |
| Pub/sub publishing | Custom `redis.publish()` calls | `TickerCacheStrategy.publishUpdate()` | Consistent channel naming via `tickerChannel()` |
| Channel patterns | String concatenation | `tickerChannel()` from `@livermore/cache` | Type-safe, consistent naming convention |
| Change calculation | Manual calculation | Copy from legacy service | Already handles edge cases |

**Key insight:** The entire ticker publishing infrastructure exists and works. The only missing piece is calling it from CoinbaseAdapter.

## Common Pitfalls

### Pitfall 1: Subscribing to ticker channel without product_ids

**What goes wrong:** Coinbase ticker channel requires product_ids in subscription message (unlike heartbeats which is global)
**Why it happens:** Heartbeats subscription doesn't need product_ids, might assume ticker is same
**How to avoid:** Include `product_ids: this.subscribedSymbols` in ticker subscribe message
**Warning signs:** No ticker messages received despite successful subscription confirmation

### Pitfall 2: Processing ticker events before symbols are subscribed

**What goes wrong:** `subscribeToTicker()` called with empty `subscribedSymbols` array
**Why it happens:** Ticker subscription happens in `connect()` but symbols aren't set until `subscribe()`
**How to avoid:** Call ticker subscription inside the existing `subscribe()` method, not in `connect()`
**Warning signs:** Ticker subscription shows empty product_ids array in logs

### Pitfall 3: Forgetting to add TickerCacheStrategy dependency

**What goes wrong:** `tickerCache` is undefined when handleTickerMessage is called
**Why it happens:** CoinbaseAdapter constructor doesn't create TickerCacheStrategy
**How to avoid:** Add `private tickerCache: TickerCacheStrategy` and initialize in constructor
**Warning signs:** Runtime error "Cannot read property 'setTicker' of undefined"

### Pitfall 4: Not handling ticker message type in handleMessage

**What goes wrong:** Ticker messages are logged as "Unknown WebSocket channel"
**Why it happens:** The existing `handleMessage()` switch doesn't include ticker channel
**How to avoid:** Add `if (message.channel === 'ticker')` case to `handleMessage()`
**Warning signs:** Log entries "Unknown WebSocket channel: ticker"

## Code Examples

Verified patterns from existing codebase:

### Adding TickerCacheStrategy to CoinbaseAdapter

```typescript
// Source: Pattern from constructor (lines 160-168) - add tickerCache
import { TickerCacheStrategy, tickerChannel } from '@livermore/cache';
import type { Ticker } from '@livermore/schemas';

// In constructor:
this.tickerCache = new TickerCacheStrategy(options.redis);
```

### Ticker Channel Subscription (follows heartbeats pattern)

```typescript
// Source: Pattern from subscribeToHeartbeats (lines 291-303)
private subscribeToTicker(): void {
  if (!this.isConnected() || this.subscribedSymbols.length === 0) return;

  const token = this.auth.generateToken();
  const subscribeMessage = {
    type: 'subscribe',
    channel: 'ticker',
    product_ids: this.subscribedSymbols,  // Required for ticker
    jwt: token,
  };

  this.ws!.send(JSON.stringify(subscribeMessage));
  logger.info({ symbols: this.subscribedSymbols }, 'Subscribed to ticker channel');
}
```

### Ticker Message Handler (from legacy service)

```typescript
// Source: apps/api/src/services/coinbase-websocket.service.ts (lines 207-239)
private async handleTickerMessage(message: TickerMessage): Promise<void> {
  for (const event of message.events) {
    if (event.type !== 'update') continue;

    for (const tickerData of event.tickers) {
      const price = parseFloat(tickerData.price);
      const timestamp = new Date(message.timestamp).getTime();
      const changePercent24h = parseFloat(tickerData.price_percent_chg_24_h);
      const change24h = price - (price / (1 + changePercent24h / 100));

      const ticker: Ticker = {
        symbol: tickerData.product_id,
        price,
        change24h,
        changePercent24h,
        volume24h: parseFloat(tickerData.volume_24_h),
        low24h: parseFloat(tickerData.low_24_h),
        high24h: parseFloat(tickerData.high_24_h),
        timestamp,
      };

      // Cache and publish
      await this.tickerCache.setTicker(this.userId, this.exchangeIdNum, ticker);
      await this.tickerCache.publishUpdate(this.userId, this.exchangeIdNum, ticker);
    }
  }
}
```

### Adding to handleMessage switch

```typescript
// Source: Pattern from handleMessage (lines 405-443)
// Add this case before the "Unknown channel" warning:
if (message.channel === 'ticker') {
  this.handleTickerMessage(message as TickerMessage).catch(error => {
    logger.error({ error }, 'Error processing ticker message');
  });
  return;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy CoinbaseWebSocketService | CoinbaseAdapter | v2.0 (2026-01-23) | Ticker publishing lost in migration |

**Deprecated/outdated:**
- `CoinbaseWebSocketService`: Deprecated in v2.0, replaced by CoinbaseAdapter. Still functional but marked for removal in v2.1.

## Open Questions

None. The implementation path is clear:

1. Add TickerCacheStrategy to CoinbaseAdapter
2. Add ticker channel subscription (called from existing `subscribe()` method)
3. Add ticker message type definition
4. Add handleTickerMessage method
5. Route ticker messages in handleMessage

## Sources

### Primary (HIGH confidence)
- `packages/coinbase-client/src/adapter/coinbase-adapter.ts` - Current adapter, missing ticker
- `apps/api/src/services/coinbase-websocket.service.ts` - Legacy service with working ticker implementation
- `apps/api/src/services/alert-evaluation.service.ts` - Consumer of ticker events
- `packages/cache/src/strategies/ticker-cache.ts` - TickerCacheStrategy implementation
- `packages/cache/src/keys.ts` - Channel pattern definitions

### Secondary (MEDIUM confidence)
- `packages/coinbase-client/src/websocket/client.ts` - Ticker message type definitions
- `packages/schemas/src/market/ticker.schema.ts` - Ticker schema/type

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All infrastructure already exists in codebase
- Architecture: HIGH - Clear pattern from legacy service
- Pitfalls: HIGH - Analyzed actual code behavior and potential issues

**Research date:** 2026-01-23
**Valid until:** Indefinite - This is codebase-specific research, not external library research

## Implementation Estimate

**Complexity:** LOW - This is a surgical addition of ~60 lines to CoinbaseAdapter
**Risk:** LOW - Following proven pattern from legacy service
**Files to modify:** 1 (`coinbase-adapter.ts`)
**New dependencies:** 0 (TickerCacheStrategy already exported from @livermore/cache)
