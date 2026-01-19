# Features Research: v2.0 Data Pipeline

**Domain:** Real-time cryptocurrency data pipeline with exchange adapters
**Researched:** 2026-01-19
**Overall Confidence:** HIGH (official Coinbase documentation + existing codebase analysis)

## Coinbase WebSocket Channels

### Connection Details

| Property | Value | Source |
|----------|-------|--------|
| Market Data URL | `wss://advanced-trade-ws.coinbase.com` | [Official Docs](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview) |
| User Data URL | `wss://advanced-trade-ws-user.coinbase.com` | [Official Docs](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview) |
| Authentication | JWT (expires 2 min, regenerate per message) | Official Docs |
| Connection Timeout | Disconnect if no subscribe within 5 seconds | Official Docs |
| Idle Timeout | Closes 60-90 seconds if no updates | Official Docs |

### Rate Limits

| Limit Type | Value | Notes |
|------------|-------|-------|
| Connections | 750/second/IP | Connection establishment rate |
| Unauthenticated Messages | 8/second/IP | Subscribe/unsubscribe messages |
| Authenticated Messages | Not specified | Higher limit expected |

### Channel: Candles

**Purpose:** Real-time candle updates with native 5-minute granularity

| Property | Value |
|----------|-------|
| Granularity | 5 minutes only (fixed) |
| Update Frequency | Every second per product |
| Authentication | Not required (public channel) |

**Message Format:**
```json
{
  "type": "candles",
  "product_id": "ETH-USD",
  "start": "1673467200",
  "high": "1234.56",
  "low": "1230.00",
  "open": "1232.00",
  "close": "1233.50",
  "volume": "125.5"
}
```

**Limitations:**
- **5-minute only**: Cannot get 1m, 15m, 1h, 4h, 1d candles via WebSocket
- 1m candles must be built from ticker data (current approach)
- Higher timeframes (15m, 1h, 4h, 1d) must be aggregated from cached 1m/5m data

**Implication for v2.0:** Continue building 1m candles from ticker. Add candles channel for native 5m data. Aggregate 15m/1h/4h/1d from cached data instead of REST API.

### Channel: Ticker

**Purpose:** Real-time price updates on each trade match

| Property | Value |
|----------|-------|
| Update Frequency | Real-time (batched per trade) |
| Authentication | Not required (public channel) |
| Fields | price, volume_24_h, high_24_h, low_24_h, best_bid, best_ask, price_percent_chg_24_h |

**Use Case:** Building 1m candles, real-time price display, calculating bid-ask spread.

### Channel: Ticker Batch

**Purpose:** Throttled ticker updates (reduces message volume)

| Property | Value |
|----------|-------|
| Update Frequency | Every 5 seconds |
| Authentication | Not required |
| Fields | Same as ticker except excludes bid/ask |

**Use Case:** Lower-frequency updates where 5-second latency is acceptable.

### Channel: Level2

**Purpose:** Order book depth with guaranteed delivery

| Property | Value |
|----------|-------|
| Initial Message | Full snapshot (bids/asks arrays) |
| Updates | Incremental `l2update` messages |
| Update Format | `{side, price_level, new_quantity, event_time}` |
| Zero Quantity | Indicates price level should be removed |
| Authentication | Not required |

**Use Case:** Order book visualization, liquidity analysis, market depth.

**Note:** qty=0 in updates means remove that price level from local book.

### Channel: Level2 Batch

**Purpose:** Batched order book updates (lower message volume)

| Property | Value |
|----------|-------|
| Update Frequency | Every 50 milliseconds |
| Schema | Identical to level2 |

### Channel: Heartbeats

**Purpose:** Keep connections alive during low-activity periods

| Property | Value |
|----------|-------|
| Frequency | Every second |
| Field | `heartbeat_counter` for sequence verification |
| Authentication | Not required |

**Critical for v2.0:** Must subscribe to heartbeats alongside other channels to prevent 60-90 second idle disconnection.

### Channel: Market Trades

**Purpose:** Real-time trade execution data

| Property | Value |
|----------|-------|
| Update Frequency | Batched every 250ms |
| Fields | trade_id, product_id, price, size, side, time |
| Authentication | Not required |

### Channel: User

**Purpose:** User-specific order and position updates

| Property | Value |
|----------|-------|
| Authentication | Required |
| Connection Limit | One connection per user |
| Snapshot | Batched by 50 orders initially |
| Scope | Orders, positions (futures) |

**Not needed for v2.0:** We're focused on market data, not order management.

### Sequence Numbers and Gap Detection

From official docs: "Sequence numbers that are greater than one integer value from the previous number indicate that a message has been dropped."

**Implication:** Consumer must track sequence numbers and detect gaps. When gap detected, either:
1. Request re-subscription (get new snapshot)
2. Trigger reconciliation via REST API

---

## Exchange Adapter Features

### Table Stakes (Must Have for v2.0)

| Feature | Description | Rationale |
|---------|-------------|-----------|
| **Unified Interface** | Single interface for all exchange adapters | Indicator service must not know exchange specifics |
| **WebSocket Connection Management** | Connect, disconnect, reconnect with exponential backoff | Coinbase disconnects idle connections after 60-90s |
| **Heartbeat Subscription** | Auto-subscribe to heartbeats on connect | Prevents idle disconnection |
| **Candle Normalization** | Convert exchange-specific candle format to unified schema | Current `CandleSchema` already defines this |
| **Event Emission** | Emit standardized events (candleClose, tickerUpdate) | Indicator service subscribes to these |
| **Cache Writing** | Write candles directly to Redis cache | Core v2.0 requirement - cache as source of truth |
| **Sequence Tracking** | Track message sequence numbers per channel | Gap detection per Coinbase docs |
| **Gap Detection** | Detect dropped messages via sequence gaps | Trigger reconciliation when gaps found |
| **Startup Backfill** | Fetch historical candles on startup | 60-candle minimum for MACD-V accuracy |
| **Symbol Management** | Subscribe/unsubscribe to specific symbols dynamically | Support adding/removing symbols without restart |
| **Error Handling** | Handle 429s, connection drops, invalid messages gracefully | Production resilience |
| **Logging** | Structured logging with exchange context | Debugging and monitoring |

### Adapter Interface (Recommended Design)

```typescript
interface ExchangeAdapter {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Subscription management
  subscribeSymbols(symbols: string[]): Promise<void>;
  unsubscribeSymbols(symbols: string[]): Promise<void>;

  // Events emitted
  on('candleClose', handler: (candle: Candle) => void): void;
  on('tickerUpdate', handler: (ticker: Ticker) => void): void;
  on('error', handler: (error: AdapterError) => void): void;
  on('gapDetected', handler: (gap: GapInfo) => void): void;

  // Status
  isConnected(): boolean;
  getSubscribedSymbols(): string[];

  // Backfill (REST)
  backfillCandles(symbol: string, timeframe: Timeframe, count: number): Promise<Candle[]>;
}
```

### Differentiators (Nice to Have)

| Feature | Description | Value |
|---------|-------------|-------|
| **Connection Health Metrics** | Track latency, message rate, error rate | Observability for production |
| **Automatic Reconnection** | Exponential backoff with jitter | Prevents thundering herd on reconnect |
| **Circuit Breaker** | Stop reconnect attempts after N failures | Prevent resource exhaustion |
| **Message Deduplication** | Detect and drop duplicate messages | Coinbase can send duplicates on reconnect |
| **Batched Cache Writes** | Buffer candles, write in batches | Reduce Redis operations |
| **Backpressure Handling** | Handle slow consumers without memory growth | Production stability |
| **Multi-Product Subscription** | Single connection for multiple symbols | Current approach, efficient |

### Anti-Features (Skip for v2.0)

| Anti-Feature | Why Skip |
|--------------|----------|
| **Full Order Book Management** | Only need ticker/candles for MACD-V. Level2 is future scope. |
| **Trade Execution** | v2.0 is monitoring only, not trading |
| **Multiple Connection Pools** | Single connection per exchange sufficient for current scale |
| **WebSocket Compression** | Coinbase handles this, no client-side needed |
| **Custom Serialization** | JSON is fine, no need for protobuf/msgpack |
| **Hot Symbol Migration** | Can restart to change symbols, live migration unnecessary |
| **Cross-Exchange Arbitrage Data** | Out of scope, single exchange focus per adapter |

---

## Cache Management Features

### Table Stakes

| Feature | Description | Implementation Notes |
|---------|-------------|---------------------|
| **Sorted Set Storage** | Candles in Redis sorted sets by timestamp | Already implemented in `CandleCacheStrategy` |
| **TTL Management** | 24-hour expiration for candle data | Current: `HARDCODED_CONFIG.cache.candleTtlHours * 3600` |
| **Duplicate Prevention** | Remove existing candle before adding new | Current: `zremrangebyscore` before `zadd` |
| **Bulk Operations** | Pipeline for batch candle writes | Current: `addCandles()` method |
| **Recent Candle Query** | Get last N candles efficiently | Current: `getRecentCandles()` |
| **Time Range Query** | Get candles between timestamps | Current: `getCandlesInRange()` |
| **Pub/Sub for Updates** | Publish candle updates to subscribers | Current: `publishUpdate()` |

### New Features Required for v2.0

| Feature | Description | Priority |
|---------|-------------|----------|
| **Gap Detection Query** | Find missing timestamps in candle sequence | HIGH |
| **Last Update Timestamp** | Track when cache was last updated per symbol/timeframe | HIGH |
| **Staleness Detection** | Check if latest candle is older than expected | HIGH |
| **Cache Warmup Status** | Track if 60-candle minimum is met | HIGH |
| **Aggregation Support** | Aggregate 1m candles to higher timeframes | HIGH |
| **Exchange-Agnostic Keys** | Key pattern supports multiple exchanges | Already implemented |

### Gap Detection Strategy

```typescript
interface GapDetectionResult {
  hasGaps: boolean;
  gaps: Array<{
    expectedTimestamp: number;
    previousTimestamp: number;
    timeframeSec: number;
  }>;
  latestTimestamp: number;
  oldestTimestamp: number;
  totalCandles: number;
}

// Implementation approach:
// 1. Get all candle timestamps from sorted set
// 2. Calculate expected interval based on timeframe
// 3. Walk through timestamps, identify gaps > interval
// 4. Return gap info for reconciliation
```

### TTL Strategy by Data Type

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| 1m Candles | 24 hours | High volume, only need recent for aggregation |
| 5m Candles | 48 hours | Medium volume, aggregation source |
| 15m+ Candles | 72 hours | Lower volume, longer history useful |
| Tickers | 5 minutes | Very high volume, only need current |
| Indicators | 1 hour | Recalculated frequently |

### Staleness Detection

```typescript
// A candle is stale if:
// - Latest candle timestamp + timeframe interval + tolerance < now
// - Tolerance allows for WebSocket latency (e.g., 30 seconds)

function isStale(latestTimestamp: number, timeframeSec: number): boolean {
  const expectedNextCandle = latestTimestamp + timeframeSec;
  const tolerance = 30; // seconds
  return Date.now() / 1000 > expectedNextCandle + tolerance;
}
```

### Anti-Features for Cache

| Anti-Feature | Why Skip |
|--------------|----------|
| **Write-Through to Database** | PostgreSQL for alerts only, not candle persistence |
| **Multi-Region Replication** | Single-region deployment for now |
| **Cache Warming on Startup** | Backfill handles this, separate warming unnecessary |
| **Compression** | Redis handles this, not application concern |

---

## Reconciliation Features

### Table Stakes

| Feature | Description | Priority |
|---------|-------------|----------|
| **Periodic Gap Scan** | Scan cache for gaps on schedule | HIGH |
| **On-Demand Gap Fill** | Fill gaps when detected via WebSocket sequence | HIGH |
| **REST API Backfill** | Fetch missing candles from Coinbase REST | HIGH |
| **Rate Limit Respect** | Stagger REST calls to avoid 429s | HIGH |
| **Gap Event Emission** | Notify indicator service when gaps filled | MEDIUM |

### Reconciliation Strategy

**Trigger Conditions:**
1. **Startup**: Always reconcile on service start
2. **Sequence Gap**: When WebSocket sequence gap detected
3. **Periodic**: Every 5 minutes as safety net
4. **Stale Data**: When staleness detection fires

**Reconciliation Flow:**
```
1. For each symbol/timeframe:
   a. Get latest candle timestamp from cache
   b. Calculate expected candles since last update
   c. If gaps exist OR cache count < 60:
      - Fetch missing candles via REST API (batched)
      - Write to cache
      - Emit reconciliation event
   d. Mark reconciliation timestamp

2. Rate limiting:
   - Max 5 REST calls per batch
   - 1 second delay between batches
   - Prioritize shorter timeframes (1m, 5m) over longer
```

### Gap Fill Priority Order

| Priority | Timeframe | Rationale |
|----------|-----------|-----------|
| 1 | 1m | Building block for all aggregations |
| 2 | 5m | Native WebSocket granularity, cross-validate |
| 3 | 15m | First aggregation level |
| 4 | 1h | Common trading timeframe |
| 5 | 4h | High-impact signals |
| 6 | 1d | Lowest frequency, can tolerate delays |

### Coinbase REST API Candle Endpoints

| Timeframe | Granularity Param | Max Candles |
|-----------|-------------------|-------------|
| 1m | ONE_MINUTE | 300 per request |
| 5m | FIVE_MINUTE | 300 per request |
| 15m | FIFTEEN_MINUTE | 300 per request |
| 1h | ONE_HOUR | 300 per request |
| 6h | SIX_HOUR | 300 per request |
| 1d | ONE_DAY | 300 per request |

**Note:** 4h is not natively supported. Must aggregate from 1h candles.

### Backfill Calculation

For 60-candle minimum:
| Timeframe | Data Needed | REST Calls |
|-----------|-------------|------------|
| 1m | 60 minutes | 1 |
| 5m | 300 minutes (5h) | 1 |
| 15m | 900 minutes (15h) | 1 |
| 1h | 60 hours (2.5d) | 1 |
| 4h | 240 hours (10d) | 1 (fetch 1h, aggregate) |
| 1d | 60 days | 1 |

**Total per symbol:** 6 REST calls for full backfill
**For 25 symbols:** 150 REST calls (batched: 30 batches * 5 calls = 30 seconds)

### Anti-Features for Reconciliation

| Anti-Feature | Why Skip |
|--------------|----------|
| **Real-Time REST Fallback** | Defeats purpose of WebSocket-first |
| **Cross-Exchange Reconciliation** | Each adapter handles its own |
| **Historical Backfill Beyond 60** | 60 is sufficient for MACD-V |
| **Reconciliation Persistence** | State in memory, rebuilt on restart |

---

## Feature Summary Matrix

### v2.0 Table Stakes

| Area | Feature | Complexity | Existing? |
|------|---------|------------|-----------|
| WebSocket | Candles channel subscription | Low | No |
| WebSocket | Heartbeat subscription | Low | No |
| WebSocket | Sequence tracking | Medium | No |
| Adapter | Unified interface | Medium | No |
| Adapter | Connection management with backoff | Medium | Partial |
| Adapter | Event emission (candleClose) | Low | Yes |
| Adapter | Cache writing | Low | No (key change) |
| Cache | Gap detection query | Medium | No |
| Cache | Staleness detection | Low | No |
| Cache | Timeframe aggregation | Medium | No |
| Reconciliation | Periodic gap scan | Medium | No |
| Reconciliation | REST backfill with rate limiting | Medium | Yes (needs refactor) |

### v2.0 Differentiators

| Area | Feature | Complexity | Value |
|------|---------|------------|-------|
| Adapter | Connection health metrics | Medium | Observability |
| Adapter | Circuit breaker | Medium | Stability |
| Cache | TTL jitter (prevent stampede) | Low | Reliability |
| Reconciliation | Priority-based gap fill | Low | Efficiency |

### Deferred to Future

| Area | Feature | Why Defer |
|------|---------|-----------|
| Adapter | Binance adapter | Architecture only, implementation later |
| WebSocket | Level2 order book | Not needed for MACD-V |
| WebSocket | Market trades | Not needed for MACD-V |
| Cache | Cross-region replication | Single-region sufficient |
| Reconciliation | Historical analysis beyond 60 | Not required for current use case |

---

## Sources

**Official Coinbase Documentation:**
- [WebSocket Channels](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels)
- [WebSocket Overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview)
- [WebSocket Rate Limits](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-rate-limits)

**Architecture Patterns:**
- [Adapter Design Pattern in TypeScript](https://medium.com/@robinviktorsson/a-guide-to-the-adapter-design-pattern-in-typescript-and-node-js-with-practical-examples-f11590ace581)
- [Exchange Architecture Patterns](https://deepwiki.com/akenshaw/flowsurface/5.1-exchange-architecture)
- [Cache Invalidation Strategies](https://leapcell.io/blog/cache-invalidation-strategies-time-based-vs-event-driven)
- [WebSocket Reconnection Best Practices](https://ably.com/topic/websocket-architecture-best-practices)
- [Cryptocurrency Data Reconciliation](https://www.osfin.ai/blog/crypto-reconciliation)

**Existing Codebase:**
- `packages/cache/src/strategies/candle-cache.ts` - Current cache implementation
- `packages/cache/src/keys.ts` - Cache key patterns
- `.planning/COINBASE-API-OPTIMIZATION.md` - Problem analysis and architecture proposal
