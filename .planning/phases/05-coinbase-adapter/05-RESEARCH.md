# Phase 05: Coinbase Adapter - Research

**Researched:** 2026-01-21
**Domain:** Coinbase Advanced Trade WebSocket API, candles channel, connection management
**Confidence:** HIGH

## Summary

Phase 05 implements the CoinbaseAdapter that connects to Coinbase's native `candles` WebSocket channel for real-time 5-minute candle data. The research confirms that Coinbase provides exactly what we need: a dedicated candles channel that streams 5-minute OHLCV data with sequence numbers for gap detection.

The key challenges are connection reliability (WebSocket disconnects after 60-90 seconds without activity) and gap detection on reconnection. Coinbase provides the `heartbeats` channel specifically to prevent idle disconnections, and sequence numbers on messages enable gap detection. The REST API supports backfill with up to 350 candles per request at 5-minute granularity.

The existing codebase provides all necessary infrastructure:
- `BaseExchangeAdapter` abstract class with reconnection logic (Phase 04)
- `addCandleIfNewer()` for versioned cache writes (Phase 04)
- `CoinbaseRestClient.getCandles()` for REST backfill (already implemented)
- `candleCloseChannel()` for Redis pub/sub (Phase 04)

**Primary recommendation:** Implement CoinbaseAdapter by extending BaseExchangeAdapter, subscribing to both `candles` and `heartbeats` channels, and adding a watchdog timer to detect silent disconnections.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ws | 8.18.0 | WebSocket client | Already used by CoinbaseWebSocketClient |
| ioredis | 5.4.2 | Redis client for cache and pub/sub | Already used in @livermore/cache |
| jsonwebtoken | 9.x | JWT generation for WebSocket auth | Already used in CoinbaseAuth |

### Supporting (Already Available)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @livermore/schemas | local | UnifiedCandle, IExchangeAdapter | All candle normalization |
| @livermore/cache | local | CandleCacheStrategy, candleCloseChannel | Cache writes and pub/sub |
| @livermore/utils | local | timeframeToMs, getCandleTimestamp | Time calculations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual heartbeat handling | ws ping/pong | Coinbase heartbeat channel is preferred - provides counter for verification |
| setTimeout watchdog | setInterval | setTimeout is cleaner - reset on each message |

**Installation:**
```bash
# No new packages required - all dependencies already present
```

## Architecture Patterns

### Recommended Project Structure

Extend existing coinbase-client package:

```
packages/coinbase-client/src/
├── adapter/
│   ├── base-adapter.ts        # (existing) BaseExchangeAdapter
│   ├── coinbase-adapter.ts    # NEW: CoinbaseAdapter implementation
│   └── index.ts               # Updated exports
├── websocket/
│   └── client.ts              # (existing) Low-level WebSocket client
└── rest/
    └── client.ts              # (existing) CoinbaseRestClient for backfill
```

### Pattern 1: Dual Channel Subscription

**What:** Subscribe to both `candles` and `heartbeats` channels on connection
**When to use:** All Coinbase WebSocket connections to prevent idle disconnection
**Example:**
```typescript
// Source: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels

async connect(): Promise<void> {
  this.ws = new WebSocket('wss://advanced-trade-ws.coinbase.com');

  this.ws.on('open', () => {
    // Subscribe to candles for market data
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      product_ids: this.symbols,
      channel: 'candles',
      jwt: this.auth.generateToken(),
    }));

    // Subscribe to heartbeats to prevent 60-90s disconnect
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'heartbeats',
      jwt: this.auth.generateToken(),
    }));
  });
}
```

### Pattern 2: Watchdog Timer for Silent Disconnections

**What:** Reset a 30-second timer on every message; trigger reconnect if timer fires
**When to use:** Detect network failures where socket stays open but no data flows
**Example:**
```typescript
// Source: Best practice from WebSocket reliability patterns

private watchdogTimeout: NodeJS.Timeout | null = null;
private readonly WATCHDOG_INTERVAL_MS = 30_000; // 30 seconds

private resetWatchdog(): void {
  if (this.watchdogTimeout) {
    clearTimeout(this.watchdogTimeout);
  }

  this.watchdogTimeout = setTimeout(() => {
    logger.warn('Watchdog timeout - no message in 30s, forcing reconnect');
    this.forceReconnect();
  }, this.WATCHDOG_INTERVAL_MS);
}

private handleMessage(message: unknown): void {
  this.resetWatchdog(); // Reset on EVERY message including heartbeats
  // ... process message
}
```

### Pattern 3: Sequence-Based Gap Detection

**What:** Track last sequence number; detect gaps on reconnection
**When to use:** After any reconnection to determine if backfill is needed
**Example:**
```typescript
// Source: Coinbase WebSocket documentation + existing codebase patterns

private lastSequenceNum = 0;

private handleCandlesMessage(message: CandlesMessage): void {
  const newSequence = message.sequence_num;

  // Check for gap (more than 1 difference indicates missed messages)
  if (this.lastSequenceNum > 0 && newSequence > this.lastSequenceNum + 1) {
    logger.warn({
      lastSequence: this.lastSequenceNum,
      newSequence,
      gap: newSequence - this.lastSequenceNum - 1,
    }, 'Sequence gap detected - triggering backfill');
    this.triggerBackfill();
  }

  this.lastSequenceNum = newSequence;
  // ... process candle
}
```

### Pattern 4: Timestamp-Based Backfill Check

**What:** Compare last cached candle timestamp with current time to determine backfill range
**When to use:** On reconnection when sequence gap is detected or timeout occurred
**Example:**
```typescript
// Source: Existing CandleCacheStrategy + CoinbaseRestClient patterns

private async checkAndBackfill(symbol: string): Promise<void> {
  const latestCached = await this.candleCache.getLatestCandle(
    this.userId, this.exchangeId, symbol, '5m'
  );

  const now = Date.now();
  const fiveMinutesMs = 5 * 60 * 1000;
  const lastTimestamp = latestCached?.timestamp ?? (now - 350 * fiveMinutesMs);

  // If gap > 5 minutes, backfill is needed
  if (now - lastTimestamp > fiveMinutesMs) {
    logger.info({ symbol, lastTimestamp, gapMs: now - lastTimestamp }, 'Backfill needed');

    const candles = await this.restClient.getCandles(
      symbol,
      '5m',
      lastTimestamp,
      now
    );

    // Use versioned writes to handle any overlap
    for (const candle of candles) {
      await this.candleCache.addCandleIfNewer(this.userId, this.exchangeId, {
        ...candle,
        exchange: 'coinbase',
      });
    }
  }
}
```

### Anti-Patterns to Avoid

- **Single channel subscription:** Subscribing only to `candles` without `heartbeats` will cause disconnection during low-activity periods
- **Polling for disconnection:** Don't use setInterval to check connection state; use watchdog timer reset on message receipt
- **Ignoring sequence numbers:** Always track sequence numbers even if not using them immediately - essential for gap detection
- **REST backfill on every reconnect:** Only backfill when gap > 5 minutes; unnecessary backfill wastes API quota

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reconnection with backoff | Custom exponential math | `BaseExchangeAdapter.handleReconnect()` | Already implemented in Phase 04 |
| Versioned cache writes | Timestamp comparison | `CandleCacheStrategy.addCandleIfNewer()` | Handles sequence number ordering |
| REST candle fetch | New REST client | `CoinbaseRestClient.getCandles()` | Already handles pagination, timeframes |
| JWT generation | Manual signing | `CoinbaseAuth.generateToken()` | Already handles ES256 signing |
| Timeframe conversion | Manual mapping | `CoinbaseRestClient.COINBASE_GRANULARITY` | Static mapping already defined |
| Candle timestamp alignment | Custom floor logic | `getCandleTimestamp()` from @livermore/utils | Already tested |

**Key insight:** The existing codebase has all the building blocks. CoinbaseAdapter is primarily composition and orchestration.

## Common Pitfalls

### Pitfall 1: Forgetting Heartbeat Subscription
**What goes wrong:** WebSocket disconnects after 60-90 seconds during quiet market periods
**Why it happens:** Coinbase closes idle connections; candles channel only sends updates when candles change
**How to avoid:** Always subscribe to `heartbeats` channel immediately after connection
**Warning signs:** Intermittent disconnections during off-hours; reconnection logs every ~90 seconds

### Pitfall 2: Watchdog Timer Not Reset on Heartbeats
**What goes wrong:** Watchdog fires even though connection is healthy
**Why it happens:** Only resetting timer on candle messages, not heartbeat messages
**How to avoid:** Reset watchdog on ANY message, including heartbeats and subscriptions
**Warning signs:** Unnecessary reconnections every 30 seconds; log spam

### Pitfall 3: Backfill During Active Trading
**What goes wrong:** REST API rate limiting, duplicate candles in cache
**Why it happens:** Triggering backfill too aggressively or not using versioned writes
**How to avoid:** Only backfill when gap > 5 minutes; always use `addCandleIfNewer()`
**Warning signs:** 429 errors from REST API; candle values oscillating

### Pitfall 4: Sequence Number Reset on Reconnect
**What goes wrong:** False gap detection after every reconnection
**Why it happens:** Coinbase sequence numbers are not global; they restart per connection
**How to avoid:** Reset lastSequenceNum to 0 on reconnection; use timestamp-based gap detection instead
**Warning signs:** Backfill triggered on every reconnect even when no data was missed

### Pitfall 5: Not Emitting candle:close at Correct Time
**What goes wrong:** Indicator recalculation happens on partial candles
**Why it happens:** Emitting on every candle update instead of only on candle close
**How to avoid:** Track current candle timestamp; emit only when timestamp changes (meaning previous candle closed)
**Warning signs:** Indicators updating every second; strategy signals on incomplete data

### Pitfall 6: Blocking Event Handlers
**What goes wrong:** Message processing backs up; stale data
**Why it happens:** Synchronous cache writes or async operations without proper handling
**How to avoid:** Use fire-and-forget for cache writes (errors logged but don't block); keep handlers fast
**Warning signs:** Growing latency between WebSocket timestamp and processing time

## Code Examples

Verified patterns from official sources:

### Coinbase Candles WebSocket Message Format
```typescript
// Source: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels

// Subscribe request
{
  "type": "subscribe",
  "product_ids": ["BTC-USD", "ETH-USD"],
  "channel": "candles",
  "jwt": "eyJ..." // JWT token from CoinbaseAuth.generateToken()
}

// Candle message (sent every second when candle values change)
{
  "channel": "candles",
  "client_id": "",
  "timestamp": "2023-06-09T20:19:35.39625135Z",
  "sequence_num": 42,
  "events": [
    {
      "type": "snapshot", // or "update"
      "candles": [
        {
          "start": "1688998200",      // UNIX timestamp in SECONDS
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

### Coinbase Heartbeats WebSocket Message Format
```typescript
// Source: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels

// Subscribe request (no product_ids needed)
{
  "type": "subscribe",
  "channel": "heartbeats",
  "jwt": "eyJ..."
}

// Heartbeat message (sent every second)
{
  "channel": "heartbeats",
  "client_id": "",
  "timestamp": "2023-06-23T20:31:26.122969572Z",
  "sequence_num": 0,
  "events": [{
    "current_time": "2023-06-23 20:31:56.121961769 +0000 UTC",
    "heartbeat_counter": "3049"  // Incrementing counter for verification
  }]
}
```

### Normalizing Coinbase Candle to UnifiedCandle
```typescript
// Source: Existing patterns from Phase 04 RESEARCH.md

import { UnifiedCandleSchema, type UnifiedCandle } from '@livermore/schemas';

interface CoinbaseCandle {
  start: string;    // UNIX timestamp in seconds
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  product_id: string;
}

function normalizeCandle(
  candle: CoinbaseCandle,
  sequenceNum: number
): UnifiedCandle {
  return UnifiedCandleSchema.parse({
    timestamp: parseInt(candle.start, 10) * 1000, // Convert seconds to milliseconds
    open: parseFloat(candle.open),
    high: parseFloat(candle.high),
    low: parseFloat(candle.low),
    close: parseFloat(candle.close),
    volume: parseFloat(candle.volume),
    symbol: candle.product_id,
    timeframe: '5m',  // Coinbase WebSocket candles are always 5m granularity
    exchange: 'coinbase',
    sequenceNum,
  });
}
```

### CoinbaseAdapter Skeleton
```typescript
// Source: Extends patterns from BaseExchangeAdapter (Phase 04)

import { BaseExchangeAdapter } from './base-adapter';
import { CoinbaseAuth } from '../rest/auth';
import { CoinbaseRestClient } from '../rest/client';
import { CandleCacheStrategy, candleCloseChannel } from '@livermore/cache';
import type { Timeframe, UnifiedCandle } from '@livermore/schemas';
import WebSocket from 'ws';

export class CoinbaseAdapter extends BaseExchangeAdapter {
  protected readonly exchangeId = 'coinbase';

  private ws: WebSocket | null = null;
  private auth: CoinbaseAuth;
  private restClient: CoinbaseRestClient;
  private candleCache: CandleCacheStrategy;
  private redis: Redis;

  private subscribedSymbols: string[] = [];
  private subscribedTimeframe: Timeframe = '5m';

  // Watchdog state
  private watchdogTimeout: NodeJS.Timeout | null = null;
  private readonly WATCHDOG_INTERVAL_MS = 30_000;

  // Sequence tracking
  private lastSequenceNum = 0;
  private lastCandleTimestamps = new Map<string, number>();

  // Connection state
  private isIntentionalClose = false;

  constructor(options: {
    apiKeyId: string;
    privateKeyPem: string;
    redis: Redis;
    userId: number;
    exchangeId: number;
  }) {
    super();
    this.auth = new CoinbaseAuth(options.apiKeyId, options.privateKeyPem);
    this.restClient = new CoinbaseRestClient(options.apiKeyId, options.privateKeyPem);
    this.candleCache = new CandleCacheStrategy(options.redis);
    this.redis = options.redis;
    // Store userId/exchangeId for cache keys
  }

  // ... implement connect(), disconnect(), subscribe(), unsubscribe(), isConnected()
}
```

### REST API Backfill
```typescript
// Source: Existing CoinbaseRestClient.getCandles() + official docs

// REST endpoint: GET /api/v3/brokerage/products/{product_id}/candles
// Max 350 candles per request

private async backfillCandles(symbol: string, fromTimestamp: number): Promise<void> {
  const now = Date.now();

  // Fetch candles from REST API
  const candles = await this.restClient.getCandles(
    symbol,
    '5m',
    fromTimestamp,
    now
  );

  logger.info({
    symbol,
    fromTimestamp: new Date(fromTimestamp).toISOString(),
    candleCount: candles.length,
  }, 'Backfilled candles from REST API');

  // Write to cache using versioned writes
  for (const candle of candles) {
    const unified: UnifiedCandle = {
      ...candle,
      exchange: 'coinbase',
    };
    await this.candleCache.addCandleIfNewer(this.userId, this.exchangeId, unified);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Build candles from ticker events | Native candles WebSocket channel | Always available | Accurate OHLCV, less complexity |
| Check connection with ping/pong | Coinbase heartbeats channel | Coinbase recommendation | Provides counter for verification |
| Poll for disconnection | Watchdog timer pattern | Best practice | Immediate detection of silent failures |
| Full backfill on every reconnect | Timestamp-based gap detection | Optimization | Reduces REST API usage |

**Deprecated/outdated:**
- Building candles from ticker events: Inaccurate volume, misses trades, complex state management
- Using only ws ping/pong: Doesn't prevent Coinbase's idle disconnect

## Open Questions

Things that couldn't be fully resolved:

1. **Multiple timeframe support**
   - What we know: Coinbase WebSocket only provides 5m candles; REST API supports all granularities
   - What's unclear: Should adapter support subscribe('5m') only, or aggregate to other timeframes?
   - Recommendation: Start with 5m only (native); document that other timeframes require separate infrastructure (indicator service aggregation)

2. **Maximum products per connection**
   - What we know: Coinbase docs say "accepts multiple product IDs" but don't specify limit
   - What's unclear: Is there a practical limit before performance degrades?
   - Recommendation: Start with needed symbols (BTC-USD, ETH-USD, etc.); monitor message rate; split connections if needed

3. **Heartbeat counter usage**
   - What we know: Heartbeat messages include incrementing `heartbeat_counter`
   - What's unclear: Should we track this counter for additional verification?
   - Recommendation: Initially ignore counter; watchdog timer is sufficient; add counter tracking if issues arise

## Sources

### Primary (HIGH confidence)
- [Coinbase WebSocket Channels Documentation](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels) - candles and heartbeats channel format
- [Coinbase WebSocket Overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview) - connection URL, 5-second subscribe requirement
- [Get Product Candles REST API](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product-candles) - backfill endpoint, max 350 candles
- Existing codebase: `CoinbaseWebSocketClient`, `CoinbaseRestClient`, `BaseExchangeAdapter`, `CandleCacheStrategy`

### Secondary (MEDIUM confidence)
- [WebSocket Reconnection Strategies](https://dev.to/hexshift/robust-websocket-reconnection-strategies-in-javascript-with-exponential-backoff-40n1) - exponential backoff best practices
- [Node.js WebSocket Reconnect Guide](https://www.w3tutorials.net/blog/nodejs-websocket-reconnect/) - watchdog timer patterns

### Tertiary (LOW confidence)
- GitHub issues about Coinbase WebSocket disconnections - community reports of 60-90s idle timeout

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use
- Architecture: HIGH - extends existing patterns, Coinbase API well-documented
- Pitfalls: HIGH - based on official docs (heartbeat requirement) and existing codebase patterns
- Connection management: MEDIUM - watchdog timeout value (30s) is a reasonable default but may need tuning

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (30 days - Coinbase API is stable)
