# Architecture Research: v2.0 Data Pipeline

**Researched:** 2026-01-19
**Confidence:** HIGH (based on existing codebase analysis + industry patterns)

## Executive Summary

This document defines the exchange adapter architecture for the v2.0 data pipeline redesign. The architecture enables multi-exchange support (Coinbase now, Binance.us and Binance.com later) while maintaining a unified indicator calculation service that is exchange-agnostic.

**Key insight:** The adapter pattern must normalize exchange-specific data formats into a unified schema, with each adapter responsible for WebSocket connection management, data transformation, and cache writes. The indicator service consumes only from cache and events - never from adapters directly.

## Component Overview

### Layer Diagram

```
                    ┌─────────────────────────────────────────────────┐
                    │              Application Layer                   │
                    │  ┌─────────────┐  ┌───────────────────────────┐ │
                    │  │   Alerts    │  │  tRPC API (existing)      │ │
                    │  └──────▲──────┘  └───────────────────────────┘ │
                    │         │                                        │
                    └─────────┼────────────────────────────────────────┘
                              │ subscribes
                    ┌─────────┼────────────────────────────────────────┐
                    │         │        Indicator Layer                 │
                    │  ┌──────┴──────────────────────────────────────┐ │
                    │  │        Indicator Calculation Service         │ │
                    │  │  - Subscribes to candle:close events        │ │
                    │  │  - Reads history from unified cache         │ │
                    │  │  - Calculates MACDV (exchange-agnostic)     │ │
                    │  │  - Publishes indicator updates              │ │
                    │  └──────▲──────────────────────────────────────┘ │
                    │         │ subscribes to events                   │
                    │         │ reads from cache                       │
                    └─────────┼────────────────────────────────────────┘
                              │
                    ┌─────────┼────────────────────────────────────────┐
                    │         │         Cache Layer                    │
                    │  ┌──────┴──────────────────────────────────────┐ │
                    │  │           Unified Candle Cache               │ │
                    │  │  Redis sorted sets by timestamp             │ │
                    │  │  Key: candles:{user}:{exchange}:{sym}:{tf}  │ │
                    │  └──────▲──────────────────────────────────────┘ │
                    │         │ writes                                 │
                    └─────────┼────────────────────────────────────────┘
                              │
                    ┌─────────┼────────────────────────────────────────┐
                    │         │        Adapter Layer                   │
                    │  ┌──────┴──────┐  ┌───────────────┐  ┌────────┐ │
                    │  │  Coinbase   │  │  Binance.us   │  │ Binance│ │
                    │  │  Adapter    │  │  Adapter      │  │ Adapter│ │
                    │  │  (v2.0)     │  │  (future)     │  │ (future│ │
                    │  └──────▲──────┘  └───────────────┘  └────────┘ │
                    │         │                                        │
                    └─────────┼────────────────────────────────────────┘
                              │
                    ┌─────────┼────────────────────────────────────────┐
                    │         │      External Data Sources             │
                    │  ┌──────┴──────┐  ┌───────────────┐  ┌────────┐ │
                    │  │  Coinbase   │  │  Binance.us   │  │ Binance│ │
                    │  │  WebSocket  │  │  WebSocket    │  │ WebSkt │ │
                    │  └─────────────┘  └───────────────┘  └────────┘ │
                    └──────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Owns |
|-----------|----------------|------|
| **Exchange Adapter** | WebSocket connection, data normalization, cache writes, event emission | Exchange-specific logic, auth, rate limits |
| **Unified Candle Cache** | Storage, retrieval, TTL management | Redis sorted sets, key patterns |
| **Indicator Service** | Calculation orchestration, event subscription | MACDV logic, calculation scheduling |
| **Event Bus** | Candle close event routing | Redis pub/sub channels |
| **Reconciliation Job** | Gap detection, backfill via REST | Periodic health checks |

## Interface Definitions

### Core Exchange Adapter Interface

```typescript
import type { Candle, Timeframe, Ticker } from '@livermore/schemas';
import type { EventEmitter } from 'events';

/**
 * Exchange identifier enum
 * Used for cache key scoping and adapter selection
 */
export type ExchangeId = 'coinbase' | 'binance-us' | 'binance';

/**
 * Connection state for adapter lifecycle management
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Events emitted by exchange adapters
 * Using TypeScript declaration merging for type-safe EventEmitter
 */
export interface ExchangeAdapterEvents {
  'candle:close': (candle: UnifiedCandle) => void;
  'candle:update': (candle: UnifiedCandle) => void;  // For live candle updates
  'ticker:update': (ticker: Ticker) => void;
  'connection:state': (state: ConnectionState) => void;
  'error': (error: ExchangeAdapterError) => void;
}

/**
 * Unified candle schema - exchange-agnostic
 * All adapters must transform exchange-specific data to this format
 */
export interface UnifiedCandle {
  /** Unix timestamp in milliseconds (candle open time) */
  timestamp: number;
  /** Opening price */
  open: number;
  /** Highest price during period */
  high: number;
  /** Lowest price during period */
  low: number;
  /** Closing price */
  close: number;
  /** Trading volume in base currency */
  volume: number;
  /** Trading pair symbol in unified format (e.g., 'BTC-USD') */
  symbol: string;
  /** Candle timeframe */
  timeframe: Timeframe;
  /** Source exchange */
  exchange: ExchangeId;
  /** True if candle is closed/finalized */
  isClosed: boolean;
}

/**
 * Standardized error type for consistent error handling across adapters
 */
export interface ExchangeAdapterError {
  code: 'CONNECTION_FAILED' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'PARSE_ERROR' | 'UNKNOWN';
  message: string;
  exchange: ExchangeId;
  retryable: boolean;
  originalError?: unknown;
}

/**
 * Adapter capabilities - what each exchange supports
 */
export interface ExchangeCapabilities {
  /** Supported candle timeframes */
  supportedTimeframes: Timeframe[];
  /** Whether WebSocket provides native candles (vs building from tickers) */
  hasNativeCandles: boolean;
  /** Native candle granularity if hasNativeCandles is true */
  nativeCandleTimeframe?: Timeframe;
  /** Maximum symbols per WebSocket connection */
  maxSymbolsPerConnection: number;
  /** REST API rate limits (requests per second) */
  restRateLimit: number;
}

/**
 * Base interface all exchange adapters must implement
 */
export interface IExchangeAdapter extends EventEmitter {
  /** Exchange identifier */
  readonly exchangeId: ExchangeId;

  /** Exchange capabilities */
  readonly capabilities: ExchangeCapabilities;

  /** Current connection state */
  readonly connectionState: ConnectionState;

  /**
   * Initialize adapter with credentials
   */
  initialize(config: ExchangeAdapterConfig): Promise<void>;

  /**
   * Start WebSocket connection and subscribe to symbols
   * @param symbols - Array of symbols in exchange-native format
   */
  start(symbols: string[]): Promise<void>;

  /**
   * Stop WebSocket connection and cleanup
   */
  stop(): Promise<void>;

  /**
   * Subscribe to additional symbols (while connected)
   */
  subscribeSymbols(symbols: string[]): Promise<void>;

  /**
   * Unsubscribe from symbols (while connected)
   */
  unsubscribeSymbols(symbols: string[]): Promise<void>;

  /**
   * Fetch historical candles via REST API (for backfill)
   * @param symbol - Symbol to fetch
   * @param timeframe - Candle timeframe
   * @param start - Start timestamp (ms)
   * @param end - End timestamp (ms)
   */
  fetchHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    start: number,
    end: number
  ): Promise<UnifiedCandle[]>;

  /**
   * Get adapter health status
   */
  getHealth(): AdapterHealth;
}

/**
 * Adapter configuration
 */
export interface ExchangeAdapterConfig {
  /** API credentials */
  apiKey: string;
  apiSecret: string;
  /** Optional passphrase (some exchanges require this) */
  passphrase?: string;
  /** User ID for cache scoping */
  userId: number;
  /** Exchange ID for cache scoping */
  exchangeDbId: number;
}

/**
 * Health status for monitoring
 */
export interface AdapterHealth {
  exchange: ExchangeId;
  connected: boolean;
  lastMessageAt: number | null;
  subscribedSymbols: string[];
  errorCount: number;
  lastError: string | null;
}
```

### Candle Close Event Schema

```typescript
/**
 * Event payload for candle close events
 * Published to Redis pub/sub when a candle finalizes
 */
export interface CandleCloseEvent {
  /** Event type identifier */
  type: 'candle:close';
  /** The closed candle */
  candle: UnifiedCandle;
  /** Timestamp when event was emitted */
  emittedAt: number;
}

/**
 * Redis channel naming for candle events
 * Pattern: channel:candle:close:{userId}:{exchangeId}:{symbol}:{timeframe}
 */
export function candleCloseChannel(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:candle:close:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Wildcard channel for all candle closes (for indicator service)
 * Pattern: channel:candle:close:{userId}:*
 */
export function candleCloseWildcard(userId: number): string {
  return `channel:candle:close:${userId}:*`;
}
```

### Indicator Service Interface (Refactored)

```typescript
/**
 * Refactored indicator service that consumes from cache only
 * No direct REST API calls during normal operation
 */
export interface IIndicatorService {
  /**
   * Start the indicator service
   * - Subscribes to candle close events
   * - Performs initial warmup from cache
   */
  start(configs: IndicatorConfig[]): Promise<void>;

  /**
   * Stop the service
   */
  stop(): void;

  /**
   * Handle candle close event (called by event subscription)
   * Reads from cache, calculates indicators, publishes results
   */
  onCandleClose(event: CandleCloseEvent): Promise<void>;

  /**
   * Get current indicator value
   */
  getIndicator(
    symbol: string,
    timeframe: Timeframe,
    type: string
  ): Promise<CachedIndicatorValue | null>;
}
```

## Data Flow

### Normal Operation (WebSocket-Driven)

```
1. WEBSOCKET MESSAGE RECEIVED
   ┌──────────────────────────────────────────────────────────────┐
   │ Coinbase WebSocket sends candle update:                      │
   │ {                                                            │
   │   "channel": "candles",                                      │
   │   "events": [{                                               │
   │     "type": "update",                                        │
   │     "candles": [{ start: "1705600800", open: "42000", ... }] │
   │   }]                                                         │
   │ }                                                            │
   └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
2. ADAPTER TRANSFORMS TO UNIFIED FORMAT
   ┌──────────────────────────────────────────────────────────────┐
   │ CoinbaseAdapter.handleCandleMessage():                       │
   │                                                              │
   │ const unifiedCandle: UnifiedCandle = {                       │
   │   timestamp: parseInt(raw.start) * 1000,  // Convert to ms   │
   │   open: parseFloat(raw.open),                                │
   │   high: parseFloat(raw.high),                                │
   │   low: parseFloat(raw.low),                                  │
   │   close: parseFloat(raw.close),                              │
   │   volume: parseFloat(raw.volume),                            │
   │   symbol: raw.product_id,  // Already in correct format      │
   │   timeframe: '5m',         // Coinbase native granularity    │
   │   exchange: 'coinbase',                                      │
   │   isClosed: this.isCandleClosed(raw.start)                   │
   │ };                                                           │
   └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
3. ADAPTER WRITES TO CACHE
   ┌──────────────────────────────────────────────────────────────┐
   │ // Write to Redis sorted set                                 │
   │ await this.candleCache.addCandle(                            │
   │   this.config.userId,                                        │
   │   this.config.exchangeDbId,                                  │
   │   unifiedCandle                                              │
   │ );                                                           │
   │                                                              │
   │ // Key: candles:1:1:BTC-USD:5m                              │
   │ // Score: 1705600800000 (timestamp)                          │
   │ // Value: JSON.stringify(unifiedCandle)                      │
   └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
4. IF CANDLE CLOSED, EMIT EVENT
   ┌──────────────────────────────────────────────────────────────┐
   │ if (unifiedCandle.isClosed) {                                │
   │   // Emit locally for same-process consumers                 │
   │   this.emit('candle:close', unifiedCandle);                  │
   │                                                              │
   │   // Publish to Redis for distributed consumers              │
   │   const event: CandleCloseEvent = {                          │
   │     type: 'candle:close',                                    │
   │     candle: unifiedCandle,                                   │
   │     emittedAt: Date.now()                                    │
   │   };                                                         │
   │   await redis.publish(                                       │
   │     candleCloseChannel(userId, exchangeId, symbol, tf),      │
   │     JSON.stringify(event)                                    │
   │   );                                                         │
   │ }                                                            │
   └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
5. INDICATOR SERVICE RECEIVES EVENT
   ┌──────────────────────────────────────────────────────────────┐
   │ // Via local EventEmitter (same process)                     │
   │ coinbaseAdapter.on('candle:close', (candle) => {             │
   │   indicatorService.onCandleClose(candle);                    │
   │ });                                                          │
   │                                                              │
   │ // Or via Redis pub/sub (distributed)                        │
   │ subscriber.psubscribe(candleCloseWildcard(userId));          │
   └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
6. INDICATOR SERVICE READS FROM CACHE
   ┌──────────────────────────────────────────────────────────────┐
   │ async onCandleClose(candle: UnifiedCandle): Promise<void> {  │
   │   // Read 60+ candles from cache (NOT from REST API)         │
   │   const history = await this.candleCache.getRecentCandles(   │
   │     this.userId,                                             │
   │     candle.exchange === 'coinbase' ? 1 : 2, // exchangeDbId  │
   │     candle.symbol,                                           │
   │     candle.timeframe,                                        │
   │     200 // Buffer for calculations                           │
   │   );                                                         │
   │                                                              │
   │   if (history.length < 60) {                                 │
   │     logger.warn('Insufficient history for MACDV');           │
   │     return;                                                  │
   │   }                                                          │
   │                                                              │
   │   // Calculate MACDV                                         │
   │   const result = macdVWithStage(history);                    │
   │   await this.indicatorCache.setIndicator(..., result);       │
   │   await this.indicatorCache.publishUpdate(..., result);      │
   │ }                                                            │
   └──────────────────────────────────────────────────────────────┘
```

### Startup Backfill Flow

```
1. ADAPTER STARTUP
   ┌────────────────────────────────────────────────────────────┐
   │ async start(symbols: string[]): Promise<void> {            │
   │   // Phase 1: Historical backfill via REST                 │
   │   await this.backfillHistoricalCandles(symbols);           │
   │                                                            │
   │   // Phase 2: Connect WebSocket for live updates           │
   │   await this.connectWebSocket();                           │
   │   await this.subscribeChannels(symbols);                   │
   │ }                                                          │
   └────────────────────────────────────────────────────────────┘
                              │
                              ▼
2. HISTORICAL BACKFILL (REST API)
   ┌────────────────────────────────────────────────────────────┐
   │ async backfillHistoricalCandles(symbols: string[]) {       │
   │   for (const timeframe of this.capabilities.supportedTfs) {│
   │     // Process in batches to respect rate limits           │
   │     for (const batch of chunk(symbols, BATCH_SIZE)) {      │
   │       await Promise.all(batch.map(async (symbol) => {      │
   │         const candles = await this.fetchHistoricalCandles( │
   │           symbol,                                          │
   │           timeframe,                                       │
   │           now - (MIN_CANDLES * timeframeToMs(timeframe)),  │
   │           now                                              │
   │         );                                                 │
   │         await this.candleCache.addCandles(..., candles);   │
   │       }));                                                 │
   │       await sleep(BATCH_DELAY_MS); // Rate limit           │
   │     }                                                      │
   │   }                                                        │
   │ }                                                          │
   └────────────────────────────────────────────────────────────┘
                              │
                              ▼
3. INDICATOR SERVICE WARMUP
   ┌────────────────────────────────────────────────────────────┐
   │ // After backfill, indicator service initializes           │
   │ // from cache (no additional REST calls)                   │
   │                                                            │
   │ async start(configs: IndicatorConfig[]): Promise<void> {   │
   │   for (const config of configs) {                          │
   │     const candles = await this.candleCache.getRecentCandles│
   │       ..., config.symbol, config.timeframe, 200            │
   │     );                                                     │
   │     if (candles.length >= MIN_CANDLES) {                   │
   │       await this.calculateIndicators(config, candles);     │
   │     }                                                      │
   │   }                                                        │
   │ }                                                          │
   └────────────────────────────────────────────────────────────┘
```

### Higher Timeframe Aggregation

```
┌────────────────────────────────────────────────────────────────┐
│ TIMEFRAME AGGREGATION STRATEGY                                  │
│                                                                 │
│ Coinbase provides native 5m candles via WebSocket.              │
│ Higher timeframes (15m, 1h, 4h, 1d) are aggregated from 5m.     │
│ 1m candles are still built from ticker events (existing logic). │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Source      │ Timeframe │ Method                           │ │
│ ├─────────────┼───────────┼──────────────────────────────────┤ │
│ │ WS ticker   │ 1m        │ Aggregate from tick data         │ │
│ │ WS candles  │ 5m        │ Native from Coinbase             │ │
│ │ Cache       │ 15m       │ Aggregate 3x 5m candles          │ │
│ │ Cache       │ 30m       │ Aggregate 6x 5m candles          │ │
│ │ Cache       │ 1h        │ Aggregate 12x 5m candles         │ │
│ │ Cache       │ 4h        │ Aggregate 48x 5m candles         │ │
│ │ Cache       │ 1d        │ Aggregate 288x 5m candles        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ Aggregation runs in indicator service when 5m candle closes:    │
│                                                                 │
│ async aggregate5mToHigherTf(candle: UnifiedCandle) {            │
│   const now = candle.timestamp;                                 │
│   for (const tf of ['15m', '30m', '1h', '4h', '1d']) {          │
│     if (this.isTimeframeBoundary(now, tf)) {                    │
│       const sourceCandles = await this.candleCache.getCandles   │
│         InRange(..., now - timeframeToMs(tf), now);             │
│       const aggregated = this.aggregateCandles(sourceCandles);  │
│       await this.candleCache.addCandle(..., aggregated);        │
│       this.emit('candle:close', aggregated);                    │
│     }                                                           │
│   }                                                             │
│ }                                                               │
└────────────────────────────────────────────────────────────────┘
```

## Exchange-Specific Considerations

### Coinbase

| Aspect | Details |
|--------|---------|
| WebSocket URL | `wss://advanced-trade-ws.coinbase.com` |
| Native candles | Yes, 5m granularity via `candles` channel |
| Candle message | `{ channel: "candles", events: [{ type: "snapshot"|"update", candles: [...] }] }` |
| Symbol format | `BTC-USD` (hyphenated) |
| Auth | JWT token per subscription |
| Timeframes | 1m, 5m, 15m, 30m, 1h, 2h, 6h, 1d (no 4h!) |
| Rate limits | ~100 REST requests/second |

**Coinbase quirk:** No native 4h timeframe. Must aggregate from 1h or use 6h.

### Binance.us (Future)

| Aspect | Details |
|--------|---------|
| WebSocket URL | `wss://stream.binance.us:9443/ws/<stream>` |
| Native candles | Yes, all timeframes via kline streams |
| Candle message | `{ e: "kline", k: { t, T, o, h, l, c, v, x, ... } }` |
| Symbol format | `BTCUSD` (no separator) |
| Auth | Not required for public streams |
| Timeframes | 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M |
| Rate limits | 5 WebSocket messages/second, 1200 REST requests/minute |

**Binance.us advantage:** Native 4h timeframe available.

### Symbol Normalization

```typescript
/**
 * Normalize symbols to unified format (Coinbase style: BASE-QUOTE)
 */
export function normalizeSymbol(symbol: string, exchange: ExchangeId): string {
  switch (exchange) {
    case 'coinbase':
      return symbol; // Already in BASE-QUOTE format
    case 'binance-us':
    case 'binance':
      // BTCUSD -> BTC-USD, ETHUSDT -> ETH-USDT
      return symbol.replace(/([A-Z]+)(USD[T]?|BTC|ETH|BNB)$/, '$1-$2');
    default:
      return symbol;
  }
}

/**
 * Convert unified symbol to exchange-native format
 */
export function toExchangeSymbol(symbol: string, exchange: ExchangeId): string {
  switch (exchange) {
    case 'coinbase':
      return symbol;
    case 'binance-us':
    case 'binance':
      return symbol.replace('-', ''); // BTC-USD -> BTCUSD
    default:
      return symbol;
  }
}
```

## Build Order

### Recommended Implementation Sequence

```
Phase 1: Foundation (No Breaking Changes)
├── 1.1 Define interfaces (IExchangeAdapter, UnifiedCandle, etc.)
├── 1.2 Add candle:close event channel to cache/keys.ts
├── 1.3 Create base adapter abstract class
└── 1.4 Write tests for symbol normalization

Phase 2: Coinbase Adapter (Parallel to Existing)
├── 2.1 Implement CoinbaseAdapter extending base
├── 2.2 Add WebSocket candles channel subscription
├── 2.3 Handle candle message parsing and normalization
├── 2.4 Write candles to cache on update
├── 2.5 Emit candle:close events when candle finalizes
└── 2.6 Integration test: verify cache writes

Phase 3: Indicator Service Refactor
├── 3.1 Add candle:close event subscription
├── 3.2 Remove REST API calls from recalculateForConfig()
├── 3.3 Read exclusively from cache
├── 3.4 Add higher timeframe aggregation logic
└── 3.5 Integration test: verify indicator calculation from cache

Phase 4: Startup Backfill
├── 4.1 Implement backfill in CoinbaseAdapter
├── 4.2 Add progress tracking and logging
├── 4.3 Respect rate limits during backfill
└── 4.4 Integration test: verify 60+ candles in cache

Phase 5: Reconciliation Job
├── 5.1 Create ReconciliationService
├── 5.2 Periodic gap detection logic
├── 5.3 REST API calls to fill gaps
└── 5.4 Health monitoring and alerting

Phase 6: Cleanup
├── 6.1 Remove REST calls from existing WebSocket service
├── 6.2 Deprecate old CoinbaseWebSocketService
├── 6.3 Update server.ts to use new adapter
└── 6.4 End-to-end testing
```

### Dependency Graph

```
┌──────────────────┐
│  1.1 Interfaces  │◄──────────────────────────────────────┐
└────────┬─────────┘                                       │
         │                                                 │
         ▼                                                 │
┌──────────────────┐     ┌──────────────────┐             │
│  1.2 Cache Keys  │     │  1.3 Base Class  │             │
└────────┬─────────┘     └────────┬─────────┘             │
         │                        │                        │
         └───────────┬────────────┘                        │
                     ▼                                     │
         ┌───────────────────────┐                        │
         │  2.x Coinbase Adapter │────────────────────────┤
         └───────────┬───────────┘                        │
                     │                                     │
                     ▼                                     │
         ┌───────────────────────┐                        │
         │ 3.x Indicator Refactor│────────────────────────┘
         └───────────┬───────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ 4.x Backfill    │     │ 5.x Reconcile   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │    6.x Cleanup        │
         └───────────────────────┘
```

## Integration with Existing Code

### Files to Modify

| File | Changes |
|------|---------|
| `packages/cache/src/keys.ts` | Add `candleCloseChannel()` function |
| `packages/schemas/src/market/candle.schema.ts` | Add `exchange` field, `isClosed` field |
| `apps/api/src/services/indicator-calculation.service.ts` | Remove REST calls, add event subscription |
| `apps/api/src/server.ts` | Initialize CoinbaseAdapter, wire up events |

### New Files to Create

| File | Purpose |
|------|---------|
| `packages/schemas/src/exchange/adapter.schema.ts` | Interface definitions |
| `packages/coinbase-client/src/adapter/coinbase-adapter.ts` | Coinbase implementation |
| `packages/coinbase-client/src/adapter/base-adapter.ts` | Abstract base class |
| `apps/api/src/services/reconciliation.service.ts` | Gap detection job |

### Incremental Migration Strategy

The existing `CoinbaseWebSocketService` continues to work during migration:

```
Week 1: Build CoinbaseAdapter in parallel
        - Both services run simultaneously
        - CoinbaseAdapter writes to cache
        - Existing service still handles indicators

Week 2: Wire indicator service to new events
        - Indicator service subscribes to candle:close
        - Falls back to REST if cache miss (safety net)

Week 3: Remove REST fallback
        - Indicator service reads cache only
        - Monitor for gaps/issues

Week 4: Deprecate old service
        - Remove CoinbaseWebSocketService
        - CoinbaseAdapter is sole data source
```

## Anti-Patterns to Avoid

### 1. Indicator Service Calling Exchange APIs

**Wrong:**
```typescript
// In IndicatorCalculationService
async onCandleClose(candle: UnifiedCandle) {
  // DON'T DO THIS - breaks exchange-agnostic principle
  const history = await this.coinbaseClient.getCandles(candle.symbol, ...);
}
```

**Right:**
```typescript
async onCandleClose(candle: UnifiedCandle) {
  // Read from unified cache - no knowledge of exchange
  const history = await this.candleCache.getRecentCandles(...);
}
```

### 2. Polling for Candle Updates

**Wrong:**
```typescript
// Timer-based polling
setInterval(async () => {
  const candle = await this.fetchLatestCandle();
  if (candle.isClosed) this.processCandle(candle);
}, 1000);
```

**Right:**
```typescript
// Event-driven
this.adapter.on('candle:close', (candle) => {
  this.processCandle(candle);
});
```

### 3. Tight Coupling Between Adapter and Indicator Service

**Wrong:**
```typescript
class CoinbaseAdapter {
  private indicatorService: IndicatorCalculationService;

  async handleCandle(candle) {
    // Direct method call - tight coupling
    await this.indicatorService.recalculate(candle);
  }
}
```

**Right:**
```typescript
class CoinbaseAdapter extends EventEmitter {
  async handleCandle(candle) {
    // Event emission - loose coupling
    this.emit('candle:close', candle);
  }
}

// Wired in server.ts
coinbaseAdapter.on('candle:close', indicatorService.onCandleClose);
```

## Sources

- [CCXT Library - Unified Exchange Interface](https://github.com/ccxt/ccxt) - Reference for adapter pattern
- [Flowsurface Exchange Architecture](https://deepwiki.com/akenshaw/flowsurface/5.1-exchange-architecture) - Multi-exchange adapter design
- [Coinbase WebSocket Channels](https://docs.cloud.coinbase.com/advanced-trade/docs/ws-channels) - Candles channel format
- [Binance.us WebSocket Streams](https://github.com/binance-us/binance-us-api-docs/blob/master/web-socket-streams.md) - Kline stream format
- [Node.js EventEmitter](https://nodejs.org/api/events.html) - Event-driven patterns
- [Type-Safe EventEmitter in TypeScript](https://blog.makerx.com.au/a-type-safe-event-emitter-in-node-js/) - TypeScript patterns
- [Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/) - Event distribution
- [ioredis](https://github.com/redis/ioredis) - Redis client for Node.js

---

*Architecture research: 2026-01-19*
