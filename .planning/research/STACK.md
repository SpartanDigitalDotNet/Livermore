# Stack Research: v2.0 Data Pipeline

**Project:** Livermore Trading Platform
**Researched:** 2026-01-19
**Scope:** Exchange adapter pattern, event-driven candle processing, background reconciliation, unified cache schema

---

## Existing Stack (Keep)

These components are validated and should remain unchanged for v2.0.

| Technology | Version | Purpose | Keep Rationale |
|------------|---------|---------|----------------|
| TypeScript | 5.6.3 | All application code | Established, type safety critical |
| Node.js | 20+ | Runtime | LTS, required for worker threads |
| Fastify | 5.2.2 | HTTP server | Already integrated with tRPC |
| tRPC | 11.0.2 | Type-safe API | Works well, no change needed |
| ioredis | 5.4.2 | Redis client | Already supports pub/sub, sorted sets |
| Pino | 9.5.0 | Structured logging | Already configured with file output |
| Zod | 3.24.1 | Runtime validation | Used throughout, essential |
| ws | 8.18.0 | WebSocket client | Already in coinbase-client package |
| Drizzle ORM | 0.36.4 | Database ORM | User settings, not candle-critical |

**Critical:** The existing `@livermore/cache` package already implements sorted set patterns for candles with the key schema `candles:{userId}:{exchangeId}:{symbol}:{timeframe}`. This is a solid foundation.

---

## Additions Needed

### 1. Type-Safe Event System

**Recommendation:** Use Node.js native `EventEmitter` with TypeScript generics (available since @types/node 20+)

**Why:** The codebase already uses callback patterns (`onCandleClose`, `onMessage`). Converting to typed EventEmitter provides:
- Compile-time event name checking
- Type-safe payload signatures
- Familiar Node.js patterns

**Implementation Pattern:**
```typescript
// No new dependency - use @types/node generics
interface ExchangeEvents {
  'candle:close': [exchange: string, symbol: string, timeframe: Timeframe, candle: Candle];
  'candle:update': [exchange: string, symbol: string, candle: Candle];
  'connection:lost': [exchange: string, reason: string];
  'connection:restored': [exchange: string];
}

// TypeScript 5.x + @types/node 20+ support this natively
class ExchangeAdapter extends EventEmitter<ExchangeEvents> { }
```

**Confidence:** HIGH (verified @types/node supports this since July 2024)

**Alternative Considered:** `typed-emitter` package - adds minimal value since native support exists.

---

### 2. Background Job Scheduler

**Recommendation:** `node-cron` ^3.0.3

**Why:**
- Lightweight (no external dependencies like Redis/MongoDB)
- Cron syntax for reconciliation intervals (e.g., `*/5 * * * *` for every 5 minutes)
- Already proven stable in Node.js ecosystem
- Reconciliation jobs are simple time-triggered tasks, not distributed workloads

**Use Case:**
```typescript
import cron from 'node-cron';

// Run gap detection every 5 minutes
cron.schedule('*/5 * * * *', () => reconciliationService.detectGaps());

// Run full reconciliation hourly
cron.schedule('0 * * * *', () => reconciliationService.fullReconcile());
```

**Confidence:** HIGH

**Alternatives Considered:**
| Library | Why Not |
|---------|---------|
| `bree` | Overkill - worker threads unnecessary for simple scheduled tasks |
| `node-schedule` | Similar to node-cron but less popular |
| `BullMQ` | Requires Redis queue, over-engineered for single-process reconciliation |

---

### 3. Exchange Adapter Abstraction

**Recommendation:** Custom adapter interface (NOT CCXT)

**Why NOT CCXT:**
- Project only needs Coinbase now, Binance later
- CCXT adds 100+ exchange abstraction overhead
- Performance penalty (45ms vs 0.05ms signing with native implementation)
- Custom Coinbase client already exists with JWT auth working
- CCXT WebSocket support is secondary to REST focus

**Recommended Pattern:**
```typescript
// packages/exchange-adapters/src/types.ts
export interface ExchangeAdapter extends EventEmitter<ExchangeEvents> {
  readonly exchangeId: string;
  readonly name: string;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // WebSocket subscriptions
  subscribeCandles(symbols: string[]): void;
  subscribeTicker(symbols: string[]): void;

  // REST backfill (startup only)
  fetchHistoricalCandles(symbol: string, timeframe: Timeframe, start: number, end: number): Promise<Candle[]>;

  // Metadata
  getSupportedTimeframes(): Timeframe[];
  normalizeSymbol(symbol: string): string;  // Exchange-specific to unified
}
```

**Confidence:** HIGH - matches existing `CoinbaseWebSocketClient` patterns

---

### 4. Coinbase Candles Channel Support

**Addition to existing WebSocket client:** Add `candles` channel type

The Coinbase WebSocket `candles` channel provides native 5-minute candles with:
- Updates every second during active trading
- OHLCV data directly from exchange
- No local aggregation needed for 5m timeframe

**Implementation:**
```typescript
// Add to CoinbaseWSMessage union type
| {
    channel: 'candles';
    timestamp: string;
    sequence_num: number;
    events: Array<{
      type: 'snapshot' | 'update';
      candles: Array<{
        start: string;      // Unix timestamp
        high: string;
        low: string;
        open: string;
        close: string;
        volume: string;
        product_id: string;
      }>;
    }>;
  }
```

**Note:** Coinbase WebSocket only provides 5m candles. 1m candles must continue to be built from ticker data. Higher timeframes (15m, 1h, 4h, 1d) must be aggregated from 5m or fetched via REST at startup.

**Confidence:** HIGH (verified via [Coinbase WebSocket docs](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels))

---

### 5. Unified Cache Schema Extension

**Keep existing pattern, add exchange dimension:**

Current: `candles:{userId}:{exchangeId}:{symbol}:{timeframe}`
This already supports multi-exchange via `exchangeId`.

**Additional keys needed:**

```typescript
// Cache metadata for reconciliation
export function candleMetaKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `candle:meta:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

// Store: { lastUpdated: timestamp, gapCount: number, lastReconciled: timestamp }

// Gap tracking for reconciliation
export function gapKey(userId: number, exchangeId: number): string {
  return `candle:gaps:${userId}:${exchangeId}`;
}
// Store as sorted set: timestamp -> JSON({ symbol, timeframe, start, end })
```

**Confidence:** HIGH - extends existing patterns

---

### 6. Redis Pub/Sub for Event Distribution

**Already supported by ioredis** - use existing infrastructure.

**Pattern for cross-service events:**
```typescript
// Publish candle close event (already partially implemented)
await redis.publish(
  `events:candle:close:${exchangeId}`,
  JSON.stringify({ symbol, timeframe, candle })
);

// Subscribe in indicator service
const subscriber = redis.duplicate();
await subscriber.subscribe(`events:candle:close:*`);
subscriber.on('message', (channel, message) => {
  // Trigger indicator recalculation
});
```

**Confidence:** HIGH (ioredis pub/sub is well-documented)

---

## Not Recommended

### CCXT Library

**Why avoid:**
- Massive dependency (100+ exchanges) when you need 2-3
- Performance overhead for latency-sensitive operations
- Existing Coinbase client already handles JWT auth correctly
- WebSocket support is less mature than REST
- Maintenance burden of tracking CCXT API changes vs exchange APIs directly

**When CCXT would make sense:** If you needed 10+ exchanges with minimal effort and didn't care about WebSocket latency.

### BullMQ / Agenda for Reconciliation

**Why avoid:**
- Requires external queue infrastructure (Redis queue or MongoDB)
- Over-engineered for single-process background jobs
- Reconciliation is not distributed workload - runs on single API server
- Adds operational complexity without benefit

**When BullMQ would make sense:** Distributed workers across multiple servers, job persistence across restarts, retry with backoff.

### Separate TypedEvent Libraries (typed-emitter, eventemitter3)

**Why avoid:**
- @types/node now supports typed EventEmitter natively
- Adding dependencies for solved problems
- Existing codebase doesn't use EventEmitter extensively (uses callbacks)

**When typed-emitter would make sense:** If stuck on Node 18 LTS without generic EventEmitter support.

### Custom Event Bus (EventEmitter2, mitt)

**Why avoid:**
- Redis pub/sub already provides cross-process event distribution
- In-process events can use native EventEmitter
- Additional abstraction layer without clear benefit

---

## Integration Notes

### How New Components Fit Together

```
                                    +-----------------+
                                    |  Indicator      |
                                    |  Service        |
                                    |  (unchanged)    |
                                    +--------+--------+
                                             |
                                             | subscribes to Redis events
                                             | reads from unified cache
                                             v
+------------------+              +----------+----------+
| Coinbase Adapter |  events      |                     |
| (extends base)   +------------->|   Redis             |
+------------------+    writes    |   - Sorted Sets     |
                        candles   |   - Pub/Sub Events  |
+------------------+              |   - Gap Metadata    |
| Binance Adapter  |              |                     |
| (future)         +------------->|                     |
+------------------+              +----------+----------+
                                             ^
                                             |
                                  +----------+----------+
                                  | Reconciliation      |
                                  | Service             |
                                  | (node-cron)         |
                                  +---------------------+
```

### Migration Path

1. **Phase 1:** Add `candles` channel to existing Coinbase WebSocket client
2. **Phase 2:** Create `ExchangeAdapter` interface, wrap existing Coinbase client
3. **Phase 3:** Update cache keys to use Redis pub/sub for candle events
4. **Phase 4:** Modify indicator service to subscribe to events instead of polling
5. **Phase 5:** Add reconciliation service with node-cron
6. **Phase 6:** Remove REST API calls from indicator recalculation path

### Version Compatibility Matrix

| Component | Min Version | Reason |
|-----------|-------------|--------|
| Node.js | 20.0.0 | Generic EventEmitter types |
| TypeScript | 5.0.0 | Satisfies modifier, const type params |
| @types/node | 20.0.0 | EventEmitter generics |
| ioredis | 5.0.0 | TypeScript native, pub/sub improvements |
| node-cron | 3.0.0 | ESM support, TypeScript types |

---

## Installation

```bash
# New dependency only
pnpm add node-cron

# Dev dependency for types
pnpm add -D @types/node-cron
```

**Total new dependencies:** 1 runtime, 1 dev

---

## Sources

### Official Documentation (HIGH confidence)
- [Coinbase WebSocket Channels](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels) - Candles channel specification
- [ioredis GitHub](https://github.com/redis/ioredis) - Pub/sub patterns, TypeScript support
- [@types/node EventEmitter generics](https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/55298) - Native typed events

### Comparison Research (MEDIUM confidence)
- [Better Stack: Node.js Schedulers Comparison](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/) - node-cron vs bree vs node-schedule
- [LogRocket: Node.js Schedulers](https://blog.logrocket.com/comparing-best-node-js-schedulers/) - Feature comparison
- [CCXT GitHub](https://github.com/ccxt/ccxt) - Multi-exchange library (not recommended)

### Architecture Patterns (MEDIUM confidence)
- [Event-Driven Architecture in JavaScript 2025](https://dev.to/hamzakhan/event-driven-architecture-in-javascript-applications-a-2025-deep-dive-4b8g) - EDA patterns
- [Redis Multi-Tenant Patterns](https://medium.com/@okan.yurt/multi-tenant-caching-strategies-why-redis-alone-isnt-enough-hybrid-pattern-f404877632e5) - Key prefixing strategies

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| Event System | HIGH | Native @types/node support verified |
| Background Jobs | HIGH | node-cron is mature, well-documented |
| Exchange Adapter | HIGH | Matches existing patterns, custom approach proven |
| Candles Channel | HIGH | Official Coinbase docs verified |
| Cache Schema | HIGH | Extends existing implementation |
| Avoid CCXT | MEDIUM | Performance claims from CCXT docs, tradeoffs situational |

---

*Stack research complete. Ready for roadmap phase structure.*
