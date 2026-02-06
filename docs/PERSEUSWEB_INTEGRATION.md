# PerseusWeb Integration Guide

Instructions for Claude Code on Kaia's host to connect PerseusWeb to Livermore's Redis pub/sub and restricted API endpoints.

## Network Prerequisites

Livermore runs on the host machine (Spartan). PerseusWeb must have network access to:

| Service | Host | Port | Protocol |
|---------|------|------|----------|
| Redis (Hermes container) | `127.0.0.1` | `6400` | TCP |
| Livermore API | `127.0.0.1` | `API_PORT` env var (default `3000`) | HTTP/WS |

If PerseusWeb runs on the same host, use `127.0.0.1`. If on a different machine, replace with the LAN IP of the Livermore host.

---

## 1. Redis Pub/Sub Connection

### Connection Details

| Parameter | Value |
|-----------|-------|
| Host | `127.0.0.1` |
| Port | `6400` |
| Password | From `REDIS_PASSWORD` environment variable |
| Library | `ioredis` (recommended) or any Redis client with pub/sub support |

### Connection URL Format

```
redis://:${REDIS_PASSWORD}@127.0.0.1:6400
```

### Important: Dedicated Subscriber Connection

Redis requires a **separate connection** for pub/sub. A connection in subscribe mode cannot execute regular commands. Always create two clients if you need both pub/sub and key reads:

```typescript
import Redis from 'ioredis';

const REDIS_URL = `redis://:${process.env.REDIS_PASSWORD}@127.0.0.1:6400`;

// Connection for regular commands (reading cached values)
const redis = new Redis(REDIS_URL);

// Dedicated connection for pub/sub (subscribe-only)
const subscriber = new Redis(REDIS_URL);
```

### Available Pub/Sub Channels

All channels use the format `channel:{type}:{userId}:{exchangeId}:{...params}`. Currently `userId=1` and `exchangeId=1` are hardcoded.

#### Ticker Updates (Real-time price)

```
channel:ticker:1:1:{symbol}
```

Example: `channel:ticker:1:1:BTC-USD`

**Message payload** (JSON string):

```json
{
  "symbol": "BTC-USD",
  "price": 50120.4,
  "change24h": 1250.5,
  "changePercent24h": 2.55,
  "volume24h": 125000.5,
  "low24h": 48500.0,
  "high24h": 50500.0,
  "timestamp": 1707129600000
}
```

#### Indicator Updates (MACD-V calculations)

```
channel:indicator:1:1:{symbol}:{timeframe}:macd-v
```

Example: `channel:indicator:1:1:BTC-USD:1h:macd-v`

**Timeframes:** `1m`, `5m`, `15m`, `1h`, `4h`, `1d`

**Message payload** (JSON string):

```json
{
  "timestamp": 1707129600000,
  "type": "macd-v",
  "symbol": "BTC-USD",
  "timeframe": "1h",
  "value": {
    "macdV": 45.3,
    "signal": 32.1,
    "histogram": 13.2,
    "fastEMA": 45120.5,
    "slowEMA": 45000.2,
    "atr": 280.5
  },
  "params": {
    "stage": "rallying",
    "liquidity": "high",
    "gapRatio": 0.15,
    "zeroRangeRatio": 0.02,
    "seeded": true,
    "nEff": 45,
    "spanBars": 26
  }
}
```

**Stage values:** `oversold`, `rebounding`, `rallying`, `overbought`, `retracing`, `reversing`, `ranging`

**Liquidity values:** `low`, `medium`, `high`, `unknown`

#### Candle Close Events

```
channel:candle:close:1:1:{symbol}:{timeframe}
```

Example: `channel:candle:close:1:1:BTC-USD:5m`

**Message payload** (JSON string):

```json
{
  "timestamp": 1707129600000,
  "open": 50000.5,
  "high": 50250.3,
  "low": 49950.2,
  "close": 50120.4,
  "volume": 125.35,
  "symbol": "BTC-USD",
  "timeframe": "5m"
}
```

#### Alert Notifications (Redis channel)

```
channel:alerts:1
```

Scoped to user. Published when MACD-V level crossings or reversal signals are detected.

### Subscribing to Channels

**Subscribe to specific channels:**

```typescript
// Single symbol ticker
await subscriber.subscribe('channel:ticker:1:1:BTC-USD');

// Multiple channels at once
await subscriber.subscribe(
  'channel:ticker:1:1:BTC-USD',
  'channel:ticker:1:1:ETH-USD',
  'channel:indicator:1:1:BTC-USD:1h:macd-v',
  'channel:alerts:1'
);

subscriber.on('message', (channel: string, message: string) => {
  const data = JSON.parse(message);

  if (channel.startsWith('channel:ticker:')) {
    handleTickerUpdate(data);
  } else if (channel.startsWith('channel:indicator:')) {
    handleIndicatorUpdate(data);
  } else if (channel.startsWith('channel:alerts:')) {
    handleAlertNotification(data);
  }
});
```

**Subscribe with pattern matching (psubscribe):**

```typescript
// All ticker updates for all symbols
await subscriber.psubscribe('channel:ticker:1:1:*');

// All indicator updates for BTC-USD across all timeframes
await subscriber.psubscribe('channel:indicator:1:1:BTC-USD:*:macd-v');

// All candle closes
await subscriber.psubscribe('channel:candle:close:1:1:*:*');

subscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
  const data = JSON.parse(message);
  // pattern = the glob you subscribed with
  // channel = the actual channel that matched
});
```

### Reading Cached Values (Direct Key Access)

Beyond pub/sub, PerseusWeb can read current cached values directly from Redis:

| Data | Key Pattern | Type | Example |
|------|-------------|------|---------|
| Candles | `candles:1:1:{symbol}:{timeframe}` | Sorted Set (score=timestamp) | `candles:1:1:BTC-USD:1h` |
| Ticker | `ticker:1:1:{symbol}` | String (JSON) | `ticker:1:1:BTC-USD` |
| Indicator | `indicator:1:1:{symbol}:{timeframe}:macd-v` | String (JSON) | `indicator:1:1:BTC-USD:1h:macd-v` |

**Reading candles from sorted set:**

```typescript
// Get last 100 candles (sorted by timestamp)
const raw = await redis.zrange('candles:1:1:BTC-USD:1h', -100, -1);
const candles = raw.map((json) => JSON.parse(json));
```

**Reading cached indicator:**

```typescript
const raw = await redis.get('indicator:1:1:BTC-USD:1h:macd-v');
if (raw) {
  const indicator = JSON.parse(raw);
  // indicator.value.macdV, indicator.params.stage, etc.
}
```

---

## 2. WebSocket Alerts (Real-time)

Livermore exposes a native WebSocket endpoint for real-time alert broadcasts. This is the **simplest way** to receive alert notifications without Redis.

### Endpoint

```
ws://127.0.0.1:3000/ws/alerts
```

No authentication required. Connect with any WebSocket client.

### Connection Example

```typescript
const ws = new WebSocket('ws://127.0.0.1:3000/ws/alerts');

ws.onopen = () => {
  console.log('Connected to Livermore alert stream');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'alert_trigger') {
    const alert = message.data;
    console.log(`Alert: ${alert.symbol} ${alert.alertType} @ $${alert.price}`);
  }
};

ws.onclose = () => {
  console.log('Disconnected - implement reconnect logic');
};
```

### Message Format

Every message is a JSON object with `type` and `data`:

```json
{
  "type": "alert_trigger",
  "data": {
    "id": 42,
    "symbol": "BTC-USD",
    "alertType": "macdv",
    "timeframe": "1h",
    "price": 50123.45,
    "triggerValue": -175.8,
    "signalDelta": -12.3,
    "triggeredAt": "2024-02-05T12:00:00.000Z"
  }
}
```

**Field definitions:**
- `id` - Database ID of the alert record
- `symbol` - Trading pair (e.g., `"BTC-USD"`)
- `alertType` - Always `"macdv"` currently
- `timeframe` - Timeframe that triggered (e.g., `"1h"`)
- `price` - Price at trigger time
- `triggerValue` - MACD-V value at trigger time
- `signalDelta` - `macdV - signal` (positive = bullish momentum, negative = bearish momentum)
- `triggeredAt` - ISO 8601 timestamp

### WebSocket vs Redis for Alerts

| Approach | Pros | Cons |
|----------|------|------|
| **WebSocket** `/ws/alerts` | Simple, no Redis dependency, pre-formatted | Only alert triggers, no ticker/indicator streams |
| **Redis** `channel:alerts:1` | Full pub/sub ecosystem, combine with tickers/indicators | Requires Redis client, separate connection |

**Recommendation:** Use the WebSocket for alert-only UIs. Use Redis pub/sub if you also need real-time tickers and indicator updates.

---

## 3. Livermore API (tRPC)

### Base URL

```
http://127.0.0.1:3000/trpc
```

Port is configurable via the `API_PORT` environment variable on the Livermore host (default `3000`). CORS is enabled for all origins.

### Authentication

Livermore uses **Clerk** for authentication. Some endpoints are public (no auth), others require a valid Clerk JWT.

| Router | Auth | Notes |
|--------|------|-------|
| `indicator.*` | Public | No JWT required |
| `alert.*` | Public | No JWT required |
| `symbol.*` | **Protected** | Requires Clerk JWT bearer token |

For protected endpoints, include the Clerk session token:

```typescript
// With tRPC client
const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://127.0.0.1:3000/trpc',
      headers: () => ({
        Authorization: `Bearer ${clerkSessionToken}`,
      }),
    }),
  ],
});

// With plain HTTP
curl -H "Authorization: Bearer <clerk-session-token>" \
  "http://127.0.0.1:3000/trpc/symbol.search?input=..."
```

### Protocol

Livermore uses **tRPC v11**. You can connect via:

1. **tRPC client** (type-safe, recommended if PerseusWeb is TypeScript)
2. **Plain HTTP** (works with any language)

#### Option A: tRPC Client

```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@livermore/api'; // If type sharing is set up

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://127.0.0.1:3000/trpc',
    }),
  ],
});

// Type-safe calls
const analysis = await trpc.indicator.getAnalysis.query({
  symbol: 'BTC-USD',
  timeframe: '1h',
});
```

#### Option B: Plain HTTP

Queries use GET with URL-encoded JSON input. Mutations use POST with JSON body.

```
GET /trpc/{router}.{procedure}?input={url_encoded_json}
POST /trpc/{router}.{procedure}  (body: JSON)
```

Example:

```bash
# Query (GET)
curl "http://127.0.0.1:3000/trpc/indicator.getAnalysis" \
  --get --data-urlencode 'input={"symbol":"BTC-USD","timeframe":"1h"}'
```

### Health Check

```
GET http://127.0.0.1:3000/health
```

Returns: `{ "status": "ok", "timestamp": "...", "services": { "database": "connected", "redis": "connected", "discord": "enabled|disabled", "controlChannel": "active" } }`

Use this to verify the API is running before connecting.

---

## 4. Allowed API Endpoints

**PerseusWeb has access ONLY to Market Data (indicator), Alert, and Symbol endpoints. Settings, Configuration, Control, User, and Logs endpoints are strictly off-limits.**

### Indicator Endpoints (Public - No Auth)

#### `indicator.getAnalysis` - Primary scalping endpoint

```
GET /trpc/indicator.getAnalysis?input={"symbol":"BTC-USD","timeframe":"1h"}
```

**Input:**
- `symbol` (string, required) - e.g. `"BTC-USD"`
- `timeframe` (string, required) - `"1m"` | `"5m"` | `"15m"` | `"1h"` | `"4h"` | `"1d"`
- `histogramCount` (number, optional, 1-50, default 5)

**Response:**

```json
{
  "result": {
    "data": {
      "success": true,
      "data": {
        "symbol": "BTC-USD",
        "timeframe": "1h",
        "timestamp": 1707129600000,
        "macdV": 45.3,
        "signal": 32.1,
        "histogram": 13.2,
        "fastEMA": 45120.5,
        "slowEMA": 45000.2,
        "atr": 280.5,
        "macd": 120.3,
        "stage": "rallying",
        "zone": "bullish",
        "scalpingBias": "long",
        "crossover": "bullish_cross",
        "divergence": null,
        "histogramPrev": 12.8,
        "histogramSeries": [
          { "timestamp": 1707126000000, "value": 8.5 },
          { "timestamp": 1707129600000, "value": 13.2 }
        ],
        "macdSeries": [
          { "timestamp": 1707126000000, "macd": 110.2, "macdV": 42.1 }
        ],
        "candleCount": 120
      }
    }
  }
}
```

#### `indicator.getMACDV` - Single indicator snapshot

```
GET /trpc/indicator.getMACDV?input={"symbol":"BTC-USD","timeframe":"1h"}
```

**Input:**
- `symbol` (string, required)
- `timeframe` (string, required)

**Response includes:** `macdV`, `signal`, `histogram`, `fastEMA`, `slowEMA`, `atr`, `stage`, `liquidity`, `gapRatio`, `zeroRangeRatio`, `seeded`, `nEff`, `spanBars`, `reason`

#### `indicator.getCurrent` - Raw cached indicator

```
GET /trpc/indicator.getCurrent?input={"symbol":"BTC-USD","timeframe":"1h"}
```

**Input:**
- `symbol` (string, required)
- `timeframe` (string, required)
- `type` (string, optional, default `"macd-v"`)

#### `indicator.calculateMACDV` - Fresh calculation from candles

```
GET /trpc/indicator.calculateMACDV?input={"symbol":"BTC-USD","timeframe":"1h"}
```

**Input:**
- `symbol` (string, required)
- `timeframe` (string, required)
- `limit` (number, optional, 1-500, default 100)

Requires at least 35 cached candles to calculate.

#### `indicator.getMACDVSeries` - Chart data series

```
GET /trpc/indicator.getMACDVSeries?input={"symbol":"BTC-USD","timeframe":"1h","limit":100}
```

**Input:**
- `symbol` (string, required)
- `timeframe` (string, required)
- `limit` (number, optional, 1-500, default 100)

**Response:** Array of `{ timestamp, macdV, signal, histogram }` for charting.

#### `indicator.getMetadata` - Indicator definitions

```
GET /trpc/indicator.getMetadata
```

No input. Returns MACD-V parameters, stage definitions, and description.

#### `indicator.getPortfolioAnalysis` - Multi-symbol overview

```
GET /trpc/indicator.getPortfolioAnalysis?input={"symbols":["BTC-USD","ETH-USD","SOL-USD"]}
```

**Input:**
- `symbols` (string[], required, 1-100 items)

**Response includes per symbol:** price, MACD-V values for all 6 timeframes, signal (`STRONG BUY`, `Bullish`, `Mixed`, `Bearish`, `STRONG SELL`, `Reversal Up?`, `Reversal Down?`), stage, liquidity. Plus `opportunities.bullish`, `opportunities.reversalUp`, `risks.bearish`, `risks.reversalDown`.

---

### Alert Endpoints (Public - No Auth)

All alert responses include a `signalDelta` field: `macdV - signal` (positive = bullish/recovering momentum, negative = bearish/falling momentum).

#### `alert.recent` - Recent alert history

```
GET /trpc/alert.recent?input={"limit":20}
```

**Input:**
- `limit` (number, optional, 1-100, default 50)

**Response:**

```json
{
  "result": {
    "data": {
      "success": true,
      "data": [
        {
          "id": 42,
          "exchangeId": 1,
          "symbol": "BTC-USD",
          "timeframe": "1h",
          "alertType": "macdv",
          "triggeredAtEpoch": 1707129600000,
          "triggeredAt": "2024-02-05T12:00:00.000Z",
          "price": 50123.45,
          "triggerValue": -175.8,
          "signalDelta": -12.3,
          "triggerLabel": "level_-150",
          "previousLabel": null,
          "details": {
            "level": -150,
            "direction": "down",
            "histogram": -12.3,
            "signal": 28.5,
            "timeframes": [
              { "timeframe": "1m", "macdV": -120, "stage": "reversing" },
              { "timeframe": "1h", "macdV": -175.8, "stage": "oversold" }
            ],
            "bias": "Bearish",
            "chartGenerated": true
          },
          "notificationSent": true,
          "notificationError": null
        }
      ]
    }
  }
}
```

**Alert types:**
- Level crossing: `triggerLabel` = `level_{n}` (e.g., `level_-150`, `level_200`)
- Reversal signal: `triggerLabel` = `reversal_oversold` or `reversal_overbought`

#### `alert.bySymbol` - Alerts for one symbol

```
GET /trpc/alert.bySymbol?input={"symbol":"BTC-USD","limit":20}
```

**Input:**
- `symbol` (string, required)
- `limit` (number, optional, 1-100, default 50)

#### `alert.byType` - Alerts by type

```
GET /trpc/alert.byType?input={"alertType":"macdv","limit":20}
```

**Input:**
- `alertType` (string, required)
- `limit` (number, optional, 1-100, default 50)

#### `alert.byId` - Single alert

```
GET /trpc/alert.byId?input={"id":42}
```

**Input:**
- `id` (number, required)

---

### Symbol Endpoints (Protected - Clerk Auth Required)

These endpoints require a valid Clerk JWT bearer token in the `Authorization` header.

#### `symbol.search` - Search available symbols

```
GET /trpc/symbol.search?input={"query":"BTC","limit":10}
```

**Input:**
- `query` (string, required, 1-20 chars) - Search term
- `limit` (number, optional, 1-100, default 20)

**Response:**

```json
{
  "result": {
    "data": {
      "results": [
        { "symbol": "BTC-USD", "baseName": "Bitcoin", "quoteName": "US Dollar" }
      ],
      "exchange": "coinbase"
    }
  }
}
```

#### `symbol.validate` - Validate a symbol

```
GET /trpc/symbol.validate?input={"symbol":"SOL-USD"}
```

**Input:**
- `symbol` (string, required, 1-20 chars) - Handles normalization (e.g., `"SOLUSD"` becomes `"SOL-USD"`)

**Response:**

```json
{
  "result": {
    "data": {
      "valid": true,
      "symbol": "SOL-USD",
      "metrics": {
        "price": 120.5,
        "priceChange24h": 3.2,
        "volume24h": 50000000,
        "baseName": "Solana",
        "quoteName": "US Dollar"
      }
    }
  }
}
```

#### `symbol.metrics` - Fetch metrics for multiple symbols

```
GET /trpc/symbol.metrics?input={"symbols":["BTC-USD","ETH-USD"]}
```

**Input:**
- `symbols` (string[], required, 1-20 items)

**Response:** Array of `{ symbol, price, priceChange24h, volume24h }` or `{ symbol, error }`.

#### `symbol.bulkValidate` - Validate multiple symbols

```
GET /trpc/symbol.bulkValidate?input={"symbols":["BTC-USD","ETH-USD","FAKECOIN-USD"]}
```

**Input:**
- `symbols` (string[], required, 1-50 items)

**Response:**

```json
{
  "result": {
    "data": {
      "results": [
        { "symbol": "BTC-USD", "status": "valid", "metrics": { "price": 50000 } },
        { "symbol": "FAKECOIN-USD", "status": "invalid", "error": "Symbol not found" }
      ],
      "summary": { "valid": 1, "invalid": 1, "duplicate": 0, "total": 2 }
    }
  }
}
```

---

## 5. Restricted Endpoints - DO NOT USE

The following routers exist in Livermore but are **strictly off-limits** to PerseusWeb. Do not call, proxy, or expose these:

- `settings.*` - User settings management
- `control.*` - Server control commands (pause, resume, restart services)
- `user.*` - User account management and sync
- `logs.*` - Server log access
- `/webhooks/clerk` - Clerk webhook handler (server-to-server only)

PerseusWeb must **never** implement or call any settings, configuration, control, or user management endpoints.

---

## 6. Recommended PerseusWeb Architecture

```
┌───────────────────────────────────────────────────┐
│                    PerseusWeb                      │
│                                                   │
│  ┌─────────────────┐  ┌──────────────────────┐   │
│  │ Redis Subscriber │  │ tRPC/HTTP Client     │   │
│  │ (ioredis)       │  │                      │   │
│  │                 │  │ indicator.* (public)  │   │
│  │ Ticker updates  │  │ alert.*    (public)   │   │
│  │ Indicator events│  │ symbol.*   (auth)     │   │
│  │ Candle closes   │  │                      │   │
│  └────────┬────────┘  └──────────┬───────────┘   │
│           │                      │               │
│  ┌────────┴────────┐            │               │
│  │ WS Alert Client │            │               │
│  │ /ws/alerts      │            │               │
│  └────────┬────────┘            │               │
│           │                      │               │
│           └──────────┬───────────┘               │
│                      │                           │
│             ┌────────▼────────┐                  │
│             │  UI / Frontend  │                  │
│             └─────────────────┘                  │
└───────────────────────────────────────────────────┘
        │              │                │
        ▼              ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌─────────────┐
│ Redis:6400   │ │ API :3000    │ │ WS :3000    │
│ (Hermes)     │ │ /trpc        │ │ /ws/alerts  │
└──────────────┘ └──────────────┘ └─────────────┘
```

**Pattern: Use Redis pub/sub for real-time streaming, WebSocket for alert-only, API for on-demand queries.**

- **Real-time market data** (tickers, indicator updates, candle closes): Subscribe via Redis pub/sub
- **Real-time alerts only**: Connect via WebSocket at `/ws/alerts`
- **Historical data** (alert history, chart series): Query via tRPC API
- **Initial state** (current indicators, portfolio overview): Query via tRPC API, then maintain via pub/sub
- **Symbol search/validation**: Query via tRPC API (requires Clerk auth)

---

## 7. Environment Variables for PerseusWeb

```bash
# Redis connection (same instance as Livermore)
REDIS_PASSWORD=<same password as Livermore host>
REDIS_HOST=127.0.0.1
REDIS_PORT=6400

# Livermore API
LIVERMORE_API_URL=http://127.0.0.1:3000

# Clerk (for protected endpoints like symbol.*)
CLERK_PUBLISHABLE_KEY=<your-clerk-publishable-key>
CLERK_SECRET_KEY=<your-clerk-secret-key>
```

---

## 8. Monitored Symbols

Livermore dynamically determines which symbols to monitor based on Coinbase account holdings with position value >= $2 USD. PerseusWeb does not control this list.

To discover which symbols are currently active, use the portfolio analysis endpoint with known symbols, or subscribe to `channel:ticker:1:1:*` via psubscribe and observe which symbols emit updates.

**Supported timeframes for all indicators:** `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
