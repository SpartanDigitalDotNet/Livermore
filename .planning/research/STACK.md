# Stack Research: v5.0 Multi-Exchange Architecture

**Project:** Livermore Trading Platform - Multi-Exchange Support
**Researched:** 2026-02-06
**Confidence:** HIGH (official documentation verified)

## Executive Summary

Supporting five crypto exchanges (Coinbase, Binance.com, Binance.US, MEXC, KuCoin) requires exchange-specific adapters rather than a unified abstraction library like CCXT. Each exchange has different WebSocket protocols, rate limits, candle intervals, and geo-restrictions. The recommended approach is to extend the existing `BaseExchangeAdapter` pattern with exchange-specific implementations, using official/semi-official SDKs where available and direct API integration where not.

**Key Findings:**
- Binance.com and Binance.US share similar APIs but have separate endpoints and auth
- MEXC uses protobuf encoding for WebSocket messages (unique among targets)
- KuCoin requires a token fetch before WebSocket connection
- Coinbase's native WebSocket candles are 5m only; 1m requires trade aggregation (already implemented)
- All exchanges support native kline/candle WebSocket streams

## Exchange APIs

### Coinbase (US) - Already Implemented

**Status:** PRODUCTION (existing adapter)

| Property | Value |
|----------|-------|
| **WebSocket URL** | `wss://advanced-trade-ws.coinbase.com` |
| **REST URL** | `https://api.coinbase.com/api/v3/brokerage` |
| **Rate Limits (WS)** | 750 connections/sec/IP, 8 unauth messages/sec/IP |
| **Rate Limits (REST)** | Endpoint-specific, generally 30 req/sec |
| **Max Symbols/WS** | Unlimited (practical limit ~50 for stability) |
| **Native Candle TFs (WS)** | 5m only |
| **Native Candle TFs (REST)** | 1m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 1d |
| **Auth Method** | JWT with ES256 (CDP API key + PEM private key) |
| **Geo Restrictions** | Available in US |

**Implementation Notes:**
- WebSocket candles channel only supports 5m granularity
- 1m candles aggregated from `market_trades` channel (current implementation)
- Heartbeat subscription prevents idle disconnect (90s timeout)
- Sequence numbers for gap detection

**Documentation:**
- [WebSocket Channels](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-channels)
- [REST API Candles](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product-candles)

---

### Binance.com (Non-US, Geo-Restricted)

**Status:** TO IMPLEMENT

| Property | Value |
|----------|-------|
| **WebSocket URL** | `wss://stream.binance.com:9443` or `wss://stream.binance.com:443` |
| **REST URL** | `https://api.binance.com` |
| **Rate Limits (WS)** | 300 connections/5min/IP, 5 messages/sec inbound |
| **Rate Limits (REST)** | 1200 weight/min/IP |
| **Max Streams/WS** | 1024 |
| **Native Candle TFs** | 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M |
| **Connection Lifetime** | 24 hours max |
| **Auth Method** | HMAC-SHA256 (API key + secret) |
| **Geo Restrictions** | **BLOCKED in US and 70+ countries** |

**Implementation Notes:**
- Combined streams via `/stream?streams=btcusdt@kline_5m/ethusdt@kline_5m`
- Kline stream format: `<symbol>@kline_<interval>` (e.g., `btcusdt@kline_5m`)
- Server sends ping every 20 seconds; must respond with pong within 60s
- Symbol format: lowercase concatenated (e.g., `btcusdt` not `BTC-USDT`)

**Geo-Restriction Warning:**
Binance.com actively blocks US IPs and uses sophisticated VPN detection (GPS, IP, SIM card data). Using VPN violates ToS and risks account ban. **Only deploy on non-US infrastructure with proper compliance.**

**Documentation:**
- [WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [Rate Limits](https://developers.binance.com/docs/binance-spot-api-docs/websocket-api/rate-limits)

---

### Binance.US (US)

**Status:** TO IMPLEMENT

| Property | Value |
|----------|-------|
| **WebSocket URL** | `wss://stream.binance.us:9443` |
| **REST URL** | `https://api.binance.us` |
| **Rate Limits (WS)** | 5 messages/sec inbound |
| **Max Streams/WS** | 1024 |
| **Native Candle TFs** | 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M |
| **Connection Lifetime** | 24 hours max |
| **Ping/Pong** | Server ping every 3 min, must respond within 10 min |
| **Auth Method** | HMAC-SHA256 (API key + secret) |
| **Geo Restrictions** | US only |

**Implementation Notes:**
- API structure nearly identical to Binance.com
- Can share adapter code with Binance.com using configurable base URLs
- Different auth keys required (separate account)
- Smaller selection of trading pairs than Binance.com

**Documentation:**
- [WebSocket Streams (GitHub)](https://github.com/binance-us/binance-us-api-docs/blob/master/web-socket-streams.md)
- [Official Docs](https://docs.binance.us/)

---

### MEXC (Non-US)

**Status:** TO IMPLEMENT

| Property | Value |
|----------|-------|
| **WebSocket URL** | `wss://wbs.mexc.com/ws` |
| **REST URL** | `https://api.mexc.com` |
| **Rate Limits (WS)** | 100 messages/sec |
| **Max Subscriptions/WS** | 30 |
| **Native Candle TFs** | Min1, Min5, Min15, Min30, Min60, Hour4, Hour8, Day1, Week1, Month1 |
| **Connection Lifetime** | 24 hours max |
| **Connection Timeout** | 30s without subscription, 60s without data |
| **Message Format** | **Protobuf** (not JSON) |
| **Auth Method** | HMAC-SHA256 (API key + secret) |
| **Geo Restrictions** | Not available in US |

**Implementation Notes:**
- **Unique: Uses protobuf encoding** - requires protobuf parser
- Kline subscription: `spot@public.kline.v3.api.pb@<SYMBOL>@<INTERVAL>`
- Symbol format: uppercase concatenated (e.g., `BTCUSDT`)
- Interval format: `Min1`, `Min5`, `Min15`, etc.
- Low subscription limit (30) means multiple connections for many symbols
- Protobuf definitions at: https://github.com/mexcdevelop/websocket-proto

**Documentation:**
- [WebSocket Market Streams](https://www.mexc.com/api-docs/spot-v3/websocket-market-streams)
- [Introduction](https://www.mexc.com/api-docs/spot-v3/introduction)

---

### KuCoin (Non-US)

**Status:** TO IMPLEMENT

| Property | Value |
|----------|-------|
| **WebSocket URL** | Dynamic (obtained via REST token request) |
| **REST URL** | `https://api.kucoin.com` |
| **Rate Limits (WS)** | 100 subscriptions/10sec batch |
| **Max Subscriptions/WS** | 300 |
| **Max Connections/User** | 500 (recently increased from 150) |
| **Native Candle TFs** | 1min, 3min, 5min, 15min, 30min, 1hour, 2hour, 4hour, 6hour, 8hour, 12hour, 1day, 1week |
| **Push Frequency** | Up to 1 push/sec per kline |
| **Auth Method** | KC-API-KEY + KC-API-SIGN + KC-API-PASSPHRASE |
| **Geo Restrictions** | Not officially available in US |

**Implementation Notes:**
- **Unique: Must request WebSocket token first** via `POST /api/v1/bullet-public`
- Token returns dynamic WebSocket URL with connection ID
- Kline topic format: `/market/candles:<SYMBOL>_<INTERVAL>` (e.g., `/market/candles:BTC-USDT_1hour`)
- Symbol format: hyphenated (e.g., `BTC-USDT`)
- Ping/pong required every 60 seconds

**Documentation:**
- [WebSocket Klines](https://www.kucoin.com/docs/websocket/spot-trading/public-channels/klines)
- [Rate Limits](https://www.kucoin.com/docs/basic-info/request-rate-limit/websocket)

---

## Libraries

### Recommended Stack

| Exchange | Library | Version | Notes |
|----------|---------|---------|-------|
| Coinbase | Direct API | N/A | Already implemented in `packages/coinbase-client` |
| Binance.com | `binance` | ^2.x | tiagosiebler SDK - TypeScript, actively maintained, full WS support |
| Binance.US | `binance` | ^2.x | Same library, different config (base URLs) |
| MEXC | Direct API + protobuf | N/A | Official SDK lacks TypeScript; use `protobufjs` for message parsing |
| KuCoin | `kucoin-universal-sdk` | latest | Official new SDK (old `kucoin-node-sdk` archived March 2025) |

### Alternative Options

| Exchange | Alternative | Why Not Primary |
|----------|-------------|-----------------|
| Binance | `@binance/connector` | Official but less ergonomic than tiagosiebler's TypeScript SDK |
| KuCoin | `kucoin-api` | Community SDK by tiagosiebler - excellent but prefer official for support |
| MEXC | `@theothergothamdev/mexc-sdk` | Unofficial fork, prefer direct implementation for control |

### Supporting Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| `ioredis` | ^5.x | Redis client with Cluster support (already in use) |
| `protobufjs` | ^7.x | Required for MEXC WebSocket message parsing |
| `ws` | ^8.x | WebSocket client (already in use) |
| `zod` | ^3.x | Schema validation (already in use) |

---

## What NOT to Use

### CCXT - Do Not Use

**Reasons:**
1. **Already rejected by project** - explicitly noted in project context
2. **Abstraction overhead** - Hides exchange-specific behaviors needed for optimization
3. **Performance concerns** - WebSocket message parsing not optimized for latency
4. **Dependency bloat** - Pulls in code for 100+ exchanges when we need 5
5. **Breaking changes** - Large library with frequent API changes
6. **Control loss** - Can't optimize for specific exchange quirks (MEXC protobuf, KuCoin token flow)

### node-binance-api - Do Not Use

**Reasons:**
1. Inconsistent maintenance history
2. Less TypeScript support than `binance` package
3. Issues with recent Binance API changes

### Legacy kucoin-node-sdk - Do Not Use

**Reasons:**
1. Archived by KuCoin on March 4, 2025
2. No longer receiving updates
3. Use `kucoin-universal-sdk` instead

---

## Redis Considerations

### Key Structure Recommendations

Current key structure is user-scoped:
```
candles:{userId}:{exchangeId}:{symbol}:{timeframe}
```

For v5.0 exchange-scoped architecture, recommend two tiers:

**Exchange-scoped (shared, no user prefix):**
```
candles:{exchangeId}:{symbol}:{timeframe}
```
- Shared by all users
- No TTL (persistent)
- For commonly-watched symbols

**User-overflow (user-specific, with TTL):**
```
usercandles:{exchangeId}:{userId}:{symbol}:{timeframe}
```
- User-specific subscriptions
- TTL-based expiration (e.g., 24h of inactivity)
- For personal watchlists

### Pub/Sub Channel Design

**Candle close events (cross-exchange visibility):**
```
channel:candle:close:{exchangeId}:{symbol}:{timeframe}
```
- No user scoping for cross-exchange visibility
- Allows soft-arbitrage detection across exchanges

**Per-user filtered channels (optional):**
```
channel:user:{userId}:candle:close
```
- Aggregated feed for user's subscriptions
- Reduces subscription complexity on client

### TTL Strategies

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Exchange candles (shared) | None | Persistent cache for common pairs |
| User overflow candles | 24 hours | Clean up inactive subscriptions |
| Tickers | 60 seconds | Real-time, high churn |
| Indicators | Match candle TTL | Derived from candle data |

### Cluster Considerations

Azure Redis Cluster (already in use) requires:
- No multi-key operations across slots
- Use `deleteKeysClusterSafe()` (already implemented)
- Hash tags `{symbol}` can keep related keys on same slot if needed

---

## Installation Commands

```bash
# Core exchange libraries
npm install binance                    # Binance.com + Binance.US
npm install kucoin-universal-sdk       # KuCoin official

# MEXC dependencies (direct implementation)
npm install protobufjs                 # For MEXC protobuf parsing

# Already installed (verify versions)
npm list ioredis ws zod
```

---

## Adapter Architecture Recommendation

Extend existing pattern from `packages/coinbase-client`:

```
packages/
  exchange-adapters/
    src/
      base/
        base-adapter.ts           # From coinbase-client (refactor to shared)
      coinbase/
        coinbase-adapter.ts       # Move from coinbase-client
        coinbase-rest-client.ts
      binance/
        binance-adapter.ts        # New - works for .com and .us
        binance-rest-client.ts
      mexc/
        mexc-adapter.ts           # New - includes protobuf handling
        mexc-rest-client.ts
        proto/                    # Protobuf definitions
      kucoin/
        kucoin-adapter.ts         # New - includes token flow
        kucoin-rest-client.ts
```

**Shared interface:** `IExchangeAdapter` (already defined in `@livermore/schemas`)

---

## Sources

### Official Documentation
- [Binance WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [Binance Rate Limits](https://developers.binance.com/docs/binance-spot-api-docs/websocket-api/rate-limits)
- [Binance.US API Docs](https://docs.binance.us/)
- [Binance.US WebSocket (GitHub)](https://github.com/binance-us/binance-us-api-docs/blob/master/web-socket-streams.md)
- [MEXC WebSocket Market Streams](https://www.mexc.com/api-docs/spot-v3/websocket-market-streams)
- [MEXC Protobuf Definitions](https://github.com/mexcdevelop/websocket-proto)
- [KuCoin WebSocket Klines](https://www.kucoin.com/docs/websocket/spot-trading/public-channels/klines)
- [KuCoin Rate Limits](https://www.kucoin.com/docs/basic-info/request-rate-limit/websocket)
- [Coinbase WebSocket Channels](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-channels)

### Libraries
- [binance npm (tiagosiebler)](https://www.npmjs.com/package/binance)
- [kucoin-universal-sdk GitHub](https://github.com/Kucoin/kucoin-universal-sdk)
- [@binance/connector npm](https://www.npmjs.com/package/@binance/connector)

### Geo-Restrictions
- [Binance Restricted Countries](https://www.datawallet.com/crypto/binance-restricted-countries)
