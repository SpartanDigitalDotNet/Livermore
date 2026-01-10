# @livermore/cache

Redis caching strategies and client for the Livermore trading system.

## Overview

This package provides:
- Redis client configuration with connection management
- Caching strategies for different data types
- Redis pub/sub support for real-time updates
- Consistent cache key naming

## Caching Strategies

### Candle Cache Strategy

Stores OHLCV candles in Redis sorted sets for efficient time-range queries:

```typescript
import { createRedisClient, CandleCacheStrategy } from '@livermore/cache';
import { validateEnv } from '@livermore/utils';

const config = validateEnv();
const redis = createRedisClient(config);
const candleCache = new CandleCacheStrategy(redis);

// Add a candle
await candleCache.addCandle({
  symbol: 'BTC-USD',
  timeframe: '1h',
  timestamp: Date.now(),
  open: 50000,
  high: 51000,
  low: 49500,
  close: 50500,
  volume: 100.5,
});

// Get recent candles
const candles = await candleCache.getRecentCandles('BTC-USD', '1h', 100);

// Get candles in time range
const rangeCandles = await candleCache.getCandlesInRange(
  'BTC-USD',
  '1h',
  startTimestamp,
  endTimestamp
);

// Publish update to subscribers
await candleCache.publishUpdate(candle);
```

### Ticker Cache Strategy

Stores real-time ticker data with short TTL (60 seconds):

```typescript
import { TickerCacheStrategy } from '@livermore/cache';

const tickerCache = new TickerCacheStrategy(redis);

// Set ticker data
await tickerCache.setTicker({
  symbol: 'ETH-USD',
  price: 3000,
  change24h: 50,
  changePercent24h: 1.7,
  high24h: 3100,
  low24h: 2950,
  volume24h: 1000000,
  timestamp: Date.now(),
});

// Get ticker
const ticker = await tickerCache.getTicker('ETH-USD');

// Get multiple tickers
const tickers = await tickerCache.getTickers(['BTC-USD', 'ETH-USD', 'SOL-USD']);
```

### Orderbook Cache Strategy

Stores orderbook snapshots with short TTL (30 seconds):

```typescript
import { OrderbookCacheStrategy } from '@livermore/cache';

const orderbookCache = new OrderbookCacheStrategy(redis);

// Set orderbook
await orderbookCache.setOrderbook({
  symbol: 'BTC-USD',
  bids: [
    { price: 49900, size: 1.5 },
    { price: 49800, size: 2.0 },
  ],
  asks: [
    { price: 50100, size: 1.2 },
    { price: 50200, size: 1.8 },
  ],
  timestamp: Date.now(),
});

// Get orderbook
const orderbook = await orderbookCache.getOrderbook('BTC-USD');
```

## Cache Keys

The package provides consistent key builders:

```typescript
import { candleKey, tickerKey, orderbookKey, indicatorKey } from '@livermore/cache';

// Build cache keys
const key1 = candleKey('BTC-USD', '1h'); // "candles:BTC-USD:1h"
const key2 = tickerKey('ETH-USD'); // "ticker:ETH-USD"
const key3 = orderbookKey('SOL-USD'); // "orderbook:SOL-USD"
const key4 = indicatorKey('BTC-USD', '1h', 'ema', { period: 9 }); // "indicator:BTC-USD:1h:ema:period=9"
```

## Pub/Sub Channels

Subscribe to real-time updates:

```typescript
import { candleChannel, createRedisPubSubClient } from '@livermore/cache';

const pubsubClient = createRedisPubSubClient(config);

// Subscribe to candle updates
const channel = candleChannel('BTC-USD', '1h');
await pubsubClient.subscribe(channel);

pubsubClient.on('message', (ch, message) => {
  if (ch === channel) {
    const candle = JSON.parse(message);
    console.log('New candle:', candle);
  }
});
```

## TTL (Time To Live)

Different data types have different TTLs:
- **Candles**: 24 hours (configurable in `HARDCODED_CONFIG`)
- **Tickers**: 60 seconds
- **Orderbooks**: 30 seconds

## Development

```bash
# Build the package
pnpm build

# Watch mode for development
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint
```

## Why Redis?

- **In-memory performance**: Microsecond latency for cache operations
- **Data structures**: Sorted sets perfect for time-series data
- **Pub/Sub**: Built-in support for real-time updates
- **TTL support**: Automatic expiration of stale data
- **Atomic operations**: Thread-safe operations out of the box
