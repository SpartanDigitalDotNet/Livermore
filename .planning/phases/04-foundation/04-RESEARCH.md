# Phase 04: Foundation - Research

**Researched:** 2026-01-21
**Domain:** TypeScript interface design, exchange adapter pattern, Redis cache patterns
**Confidence:** HIGH

## Summary

Phase 04 Foundation establishes the interfaces and base classes for the v2.0 exchange adapter pattern. The research confirms that the existing codebase has strong patterns to follow: Zod-first schema design with inferred types, consistent cache key naming, and a well-structured monorepo with clear package boundaries.

The key deliverables are straightforward extensions of existing patterns:
1. **IExchangeAdapter interface** - TypeScript interface defining connect/disconnect/subscribe contract
2. **UnifiedCandle schema** - Extends existing `CandleSchema` with exchange-agnostic fields
3. **ExchangeAdapterEvents** - Typed event map for the adapter's EventEmitter
4. **candleCloseChannel()** - Redis pub/sub key pattern following existing `candleChannel()` pattern
5. **BaseExchangeAdapter** - Abstract class providing shared reconnection and event logic
6. **Versioned cache writes** - Timestamp comparison before writes to prevent out-of-order updates

**Primary recommendation:** Build on existing patterns. The codebase already has CandleSchema, CandleCacheStrategy, and candleChannel() - extend these rather than creating parallel structures.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 3.24.1 | Schema validation and type inference | Already used for all schemas in @livermore/schemas |
| ioredis | 5.4.2 | Redis client with pub/sub support | Already used for caching, 100% TypeScript |
| ws | 8.18.0 | WebSocket client | Already used for Coinbase WebSocket |
| TypeScript | 5.6.3 | Type safety | Project standard |

### Supporting (No Additions Needed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| EventEmitter | Node 20+ native | Typed events | Use native with generics from @types/node |
| @types/node | 20+ | Type definitions | Native EventEmitter generics available |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native EventEmitter | typed-emitter, eventemitter3 | External dependency; native support is sufficient in Node 20+ |
| Zod schemas | TypeScript interfaces only | Lose runtime validation; Zod is project standard |

**Installation:**
```bash
# No new packages required - all dependencies already present
```

## Architecture Patterns

### Recommended Project Structure

Add new files to existing packages rather than creating new ones:

```
packages/
├── schemas/src/
│   └── adapter/
│       ├── exchange-adapter.schema.ts    # IExchangeAdapter, events, UnifiedCandle
│       └── index.ts                      # Export barrel
├── cache/src/
│   └── strategies/
│       └── candle-cache.ts               # Add versioned write method
└── coinbase-client/src/
    └── adapter/
        ├── base-adapter.ts               # BaseExchangeAdapter abstract class
        └── index.ts                      # Export barrel
```

### Pattern 1: Interface with Zod Schema Backing

**What:** Define TypeScript interfaces with Zod schemas for runtime validation
**When to use:** Any data crossing system boundaries (WebSocket messages, cache data)
**Example:**
```typescript
// Source: Existing pattern in packages/schemas/src/market/candle.schema.ts

import { z } from 'zod';

// Schema first
export const UnifiedCandleSchema = CandleSchema.extend({
  /** Exchange identifier (e.g., 'coinbase', 'binance') */
  exchange: z.string().min(1),
  /** Original exchange timestamp for debugging */
  exchangeTimestamp: z.string().optional(),
  /** Sequence number from WebSocket for gap detection */
  sequenceNum: z.number().int().nonnegative().optional(),
});

// Type inferred from schema
export type UnifiedCandle = z.infer<typeof UnifiedCandleSchema>;
```

### Pattern 2: Typed EventEmitter with Event Map

**What:** Use TypeScript generics to type-check event names and payloads
**When to use:** Any class that emits events to external listeners
**Example:**
```typescript
// Source: https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/55298

import { EventEmitter } from 'events';
import type { UnifiedCandle, Timeframe } from '@livermore/schemas';

// Define event map as type
export type ExchangeAdapterEvents = {
  'candle:close': [candle: UnifiedCandle];
  'connected': [];
  'disconnected': [reason: string];
  'error': [error: Error];
  'reconnecting': [attempt: number, delay: number];
};

// Use with EventEmitter generics (Node 20+)
export interface IExchangeAdapter extends EventEmitter<ExchangeAdapterEvents> {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(symbols: string[], timeframe: Timeframe): void;
  unsubscribe(symbols: string[], timeframe: Timeframe): void;
  isConnected(): boolean;
}
```

### Pattern 3: Abstract Base Class

**What:** Shared logic in abstract class, exchange-specific in concrete implementations
**When to use:** Multiple adapters will share reconnection, event emission, and logging logic
**Example:**
```typescript
// Source: Adapter pattern from https://refactoring.guru/design-patterns/adapter/typescript/example

import { EventEmitter } from 'events';
import type { ExchangeAdapterEvents, IExchangeAdapter } from '@livermore/schemas';

export abstract class BaseExchangeAdapter
  extends EventEmitter<ExchangeAdapterEvents>
  implements IExchangeAdapter {

  protected reconnectAttempts = 0;
  protected maxReconnectAttempts = 10;
  protected reconnectDelay = 5000;

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract subscribe(symbols: string[], timeframe: Timeframe): void;
  abstract unsubscribe(symbols: string[], timeframe: Timeframe): void;
  abstract isConnected(): boolean;

  // Shared reconnection logic
  protected async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.emit('reconnecting', this.reconnectAttempts, delay);

    await new Promise(resolve => setTimeout(resolve, delay));
    await this.connect();
  }
}
```

### Pattern 4: Versioned Cache Writes

**What:** Compare timestamps before writing to prevent out-of-order updates
**When to use:** Any cache write that could receive stale data (reconnection, race conditions)
**Example:**
```typescript
// Source: Extend existing CandleCacheStrategy pattern

/**
 * Add candle only if newer than existing
 * Returns true if written, false if skipped (older timestamp)
 */
async addCandleIfNewer(
  userId: number,
  exchangeId: number,
  candle: UnifiedCandle
): Promise<boolean> {
  const key = candleKey(userId, exchangeId, candle.symbol, candle.timeframe);

  // Get existing candle at this timestamp
  const existing = await this.redis.zrangebyscore(
    key,
    candle.timestamp,
    candle.timestamp
  );

  if (existing.length > 0) {
    // Candle exists - only update if this is actually newer data
    // (same timestamp but later sequence number, or updating in-progress candle)
    const existingCandle = JSON.parse(existing[0]) as UnifiedCandle;

    // If sequence numbers available, use them for ordering
    if (candle.sequenceNum !== undefined && existingCandle.sequenceNum !== undefined) {
      if (candle.sequenceNum <= existingCandle.sequenceNum) {
        return false; // Skip - older or same data
      }
    }
  }

  // Write candle (removes existing at same timestamp first)
  await this.redis.zremrangebyscore(key, candle.timestamp, candle.timestamp);
  await this.redis.zadd(key, candle.timestamp, JSON.stringify(candle));

  return true;
}
```

### Anti-Patterns to Avoid

- **Separate interface and schema definitions:** Don't define TypeScript interface separately from Zod schema. Use `z.infer<>` to derive types from schemas.
- **Generic event names:** Don't use `'data'` or `'message'`. Use specific names like `'candle:close'` that communicate intent.
- **Polling for candle close:** Don't use timers. Emit events when candles actually close based on WebSocket data.
- **Direct REST calls from adapter:** Adapter emits events; backfill service makes REST calls. Keep concerns separated.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Candle timestamp alignment | Custom floor logic | `getCandleTimestamp()` from `@livermore/utils` | Already handles all timeframes correctly |
| Timeframe to milliseconds | Switch statement | `timeframeToMs()` from `@livermore/utils` | Already validated and tested |
| Redis key generation | String concatenation | `candleKey()`, `candleChannel()` from `@livermore/cache` | Consistent with existing patterns |
| Gap detection | Manual iteration | `fillCandleGaps()` from `@livermore/utils` | Already handles edge cases |

**Key insight:** The existing `@livermore/utils` and `@livermore/cache` packages have solved most time-series and caching problems. Extend them rather than duplicating.

## Common Pitfalls

### Pitfall 1: Forgetting Sequence Numbers in Versioning
**What goes wrong:** Timestamp alone doesn't distinguish between candle updates during the same minute
**Why it happens:** Coinbase sends multiple updates per second for the same candle period
**How to avoid:** Include `sequence_num` from WebSocket message in UnifiedCandle schema; use it for versioning when timestamps match
**Warning signs:** Candle values jumping back and forth; latest candle close differs from expected

### Pitfall 2: EventEmitter Type Erasure
**What goes wrong:** Event names become `string | symbol`, payloads become `any[]`
**Why it happens:** Not using generic EventEmitter properly or casting incorrectly
**How to avoid:** Use Node 20+ native generic syntax: `EventEmitter<EventMap>` not `new EventEmitter() as TypedEmitter<T>`
**Warning signs:** No autocomplete for event names; payload type is `any`

### Pitfall 3: Missing Exchange Identifier in UnifiedCandle
**What goes wrong:** Can't distinguish candles from different exchanges in cache
**Why it happens:** Assuming single-exchange forever; not planning for Binance adapter
**How to avoid:** Include `exchange: string` field in UnifiedCandle from the start
**Warning signs:** Cache key collisions when adding second exchange

### Pitfall 4: Channel Name Collision with Existing candleChannel()
**What goes wrong:** New pub/sub channel pattern conflicts with existing channel
**Why it happens:** Not checking existing `keys.ts` patterns
**How to avoid:** Use distinct pattern like `candleCloseChannel()` or extend existing `candleChannel()` semantics
**Warning signs:** Existing code receives unexpected messages; tests break

### Pitfall 5: Blocking EventEmitter Listeners
**What goes wrong:** Slow listeners block the adapter from processing new messages
**Why it happens:** Synchronous processing in event handlers
**How to avoid:** Document that listeners should not await long operations; consider async event pattern
**Warning signs:** Message backlog; stale candle data

## Code Examples

Verified patterns from official sources:

### Coinbase WebSocket Candles Message Format
```typescript
// Source: https://docs.cdp.coinbase.com/advanced-trade/docs/ws-channels

// Subscribe request
{
  "type": "subscribe",
  "product_ids": ["BTC-USD", "ETH-USD"],
  "channel": "candles",
  "jwt": "..."  // Optional for public channels
}

// Response message
{
  "channel": "candles",
  "client_id": "",
  "timestamp": "2023-06-09T20:19:35.39625135Z",
  "sequence_num": 0,
  "events": [
    {
      "type": "snapshot",  // or "update"
      "candles": [
        {
          "start": "1688998200",  // UNIX timestamp (seconds)
          "high": "1867.72",
          "low": "1865.63",
          "open": "1867.38",
          "close": "1866.81",
          "volume": "0.20269406",
          "product_id": "ETH-USD"
        }
      ]
    }
  ]
}
```

### Normalizing Coinbase Candle to UnifiedCandle
```typescript
// Pattern for adapter normalization

function normalizeCandle(
  event: CoinbaseCandleEvent,
  sequenceNum: number
): UnifiedCandle {
  return UnifiedCandleSchema.parse({
    timestamp: parseInt(event.start) * 1000,  // Convert to milliseconds
    open: parseFloat(event.open),
    high: parseFloat(event.high),
    low: parseFloat(event.low),
    close: parseFloat(event.close),
    volume: parseFloat(event.volume),
    symbol: event.product_id,
    timeframe: '5m',  // Coinbase WebSocket candles are always 5m
    exchange: 'coinbase',
    sequenceNum,
  });
}
```

### Redis Pub/Sub Channel Pattern
```typescript
// Source: Extend existing pattern in packages/cache/src/keys.ts

/**
 * Build a Redis pub/sub channel for candle close events
 * Used by indicator service to subscribe to candle finalizations
 */
export function candleCloseChannel(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:candle:close:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

// Wildcard subscription for all symbols
export function candleClosePatternChannel(
  userId: number,
  exchangeId: number,
  timeframe: Timeframe
): string {
  return `channel:candle:close:${userId}:${exchangeId}:*:${timeframe}`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| typed-emitter package | Native EventEmitter generics | Node 20 / @types/node July 2024 | One less dependency |
| Separate interface + validation | Zod schema with z.infer | Zod 3.0+ (2021) | Single source of truth |
| Manual candle building from tickers | Native candles WebSocket channel | Always available | Accurate data, less complexity |

**Deprecated/outdated:**
- Building candles from ticker messages: Causes data gaps, inaccurate OHLCV
- eventemitter3 for types: Native support is now sufficient

## Open Questions

Things that couldn't be fully resolved:

1. **Should UnifiedCandle extend existing Candle or be separate?**
   - What we know: Existing `Candle` type works, adding `exchange` field is the main difference
   - What's unclear: Will this cause type conflicts in existing code expecting `Candle`?
   - Recommendation: Extend with `.extend()` and use `UnifiedCandle` for adapter layer, keep `Candle` for indicator calculations

2. **Heartbeat channel subscription location**
   - What we know: Heartbeats prevent 60-90s disconnect; should subscribe on connect
   - What's unclear: Should heartbeat logic be in BaseExchangeAdapter or CoinbaseAdapter?
   - Recommendation: Keep in CoinbaseAdapter since heartbeat channel is Coinbase-specific; document in interface that adapters must handle keep-alive

3. **Error event payload type**
   - What we know: `'error'` event needs payload
   - What's unclear: Should it be `Error` or custom `AdapterError` with context?
   - Recommendation: Start with `Error`, extend if needed; avoid premature abstraction

## Sources

### Primary (HIGH confidence)
- Coinbase WebSocket Channels Documentation - candles channel format, subscribe request
- Existing codebase patterns in `@livermore/schemas`, `@livermore/cache`, `@livermore/utils`
- [ioredis GitHub](https://github.com/redis/ioredis) - pub/sub patterns

### Secondary (MEDIUM confidence)
- [@types/node EventEmitter generics discussion](https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/55298) - native typed events
- [Refactoring.guru Adapter Pattern](https://refactoring.guru/design-patterns/adapter/typescript/example) - TypeScript adapter pattern
- [MakerX Type-safe EventEmitter](https://blog.makerx.com.au/a-type-safe-event-emitter-in-node-js/) - typed event patterns

### Tertiary (LOW confidence)
- WebSearch results for Redis versioning patterns - general guidance only

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use
- Architecture: HIGH - extends existing codebase patterns
- Pitfalls: MEDIUM - some based on anticipated issues rather than documented failures

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (30 days - stable patterns)
