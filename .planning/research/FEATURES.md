# Features Research: v5.0 Multi-Exchange Architecture

**Project:** Livermore Trading Platform
**Milestone:** v5.0 Distributed Exchange Architecture
**Researched:** 2026-02-06
**Confidence:** HIGH (based on existing codebase patterns + domain research)

## Executive Summary

v5.0 transforms Livermore from a user-scoped single-exchange platform to an exchange-scoped distributed architecture enabling cross-exchange visibility. The core innovation is the "trigger remotely, buy locally" soft-arbitrage pattern where signals from one exchange (Mike's Coinbase) can inform trading decisions on another (Kaia's Binance).

Current architecture uses `candles:{userId}:{exchangeId}:{symbol}:{timeframe}` keys, coupling data to individual users. v5.0 transitions to exchange-scoped shared pools (`candles:{exchange_id}:{symbol}:{timeframe}`) for Tier 1 high-volume symbols, with user-specific overflow (`usercandles:`) for positions and manual adds.

Key features: idle startup mode (no connections until `start` command), tiered symbol management (exchange-driven Top N + user positions), and Redis pub/sub cross-exchange visibility enabling any client to subscribe to any exchange's feed.

---

## Table Stakes (Must Have)

Features required for v5.0 to function. Missing any blocks the milestone.

### Exchange Management

| Feature | Description | Complexity | Rationale |
|---------|-------------|------------|-----------|
| **EXC-01: `exchanges` metadata table** | New table with API limits, fees, geo restrictions, supported timeframes, WebSocket URLs | Medium | Foundation for all exchange-specific behavior |
| **EXC-02: `user_exchanges` FK to `exchanges`** | Refactor `user_exchanges.exchange_name` to `exchange_id` FK | Low | Normalize exchange data, enable metadata lookup |
| **EXC-03: Exchange adapter factory** | Factory that instantiates correct adapter (Coinbase/Binance) based on exchange type | Low | Support multiple exchange implementations |
| **EXC-04: Exchange connection status tracking** | Track `connected_at`, `last_heartbeat`, `connection_state` per exchange | Low | Monitor distributed instances |

### Data Architecture

| Feature | Description | Complexity | Rationale |
|---------|-------------|------------|-----------|
| **DATA-01: Exchange-scoped candle keys** | `candles:{exchange_id}:{symbol}:{timeframe}` (no userId) | Medium | Shared data pool for Tier 1 symbols |
| **DATA-02: Exchange-scoped indicator keys** | `indicator:{exchange_id}:{symbol}:{timeframe}:macdv` | Medium | Shared indicator calculations |
| **DATA-03: User overflow keys** | `usercandles:{userId}:{exchange_id}:{symbol}:{timeframe}` with TTL | Medium | User positions + manual adds with auto-cleanup |
| **DATA-04: Dual-read pattern** | Indicator service checks exchange-scoped first, falls back to user-scoped | Medium | Backward compatibility during migration |
| **DATA-05: Cross-exchange pub/sub channels** | `channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}` | Medium | Any client can subscribe to any exchange's feed |

### Symbol Management

| Feature | Description | Complexity | Rationale |
|---------|-------------|------------|-----------|
| **SYM-01: Tier 1 - Top N by volume** | Exchange-driven symbol list (Top 20-50 by 24h volume) | Medium | Shared pool covers most trading activity |
| **SYM-02: Tier 2 - User positions** | Auto-subscribe user's held positions (de-duped against Tier 1) | Low | User sees their holdings regardless of Tier 1 |
| **SYM-03: Tier 2 - Manual adds** | User-added symbols with validation + de-dupe | Low | Power user flexibility |
| **SYM-04: Symbol de-duplication** | Tier 2 entries that match Tier 1 use shared pool (no duplicate data) | Medium | Avoid redundant data storage and computation |
| **SYM-05: Symbol metrics endpoint** | 24h volume, price, market cap for add/remove decisions | Low | Informed symbol management |

### Startup/Control

| Feature | Description | Complexity | Rationale |
|---------|-------------|------------|-----------|
| **CTL-01: Idle startup mode** | API starts without WebSocket connections, awaits `start` command | Medium | Lazy initialization reduces cold start |
| **CTL-02: `start` command** | Command to initiate exchange connections (replaces auto-connect) | Low | Explicit control over resource usage |
| **CTL-03: `--autostart <exchange>` flag** | CLI parameter to bypass idle mode for specific exchange | Low | Backward compatibility, CI/CD friendly |
| **CTL-04: Connection lifecycle events** | Emit `exchange:connecting`, `exchange:connected`, `exchange:disconnected` | Low | Observable connection state |

### Cross-Exchange Visibility

| Feature | Description | Complexity | Rationale |
|---------|-------------|------------|-----------|
| **VIS-01: Exchange-scoped alert channels** | `channel:alerts:{exchange_id}` (not user-scoped) | Low | Any subscriber sees exchange alerts |
| **VIS-02: Cross-exchange subscription** | Client can subscribe to `channel:exchange:coinbase:*` from Binance instance | Medium | Core soft-arbitrage capability |
| **VIS-03: Alert source attribution** | Alert payloads include `source_exchange_id` field | Low | Know which exchange triggered the signal |

---

## Differentiators

Features that provide competitive advantage. Not blocking, but valuable.

| Feature | Value Proposition | Complexity | Priority |
|---------|-------------------|------------|----------|
| **DIFF-01: Soft-arbitrage signals** | "BTC moving on Coinbase" notification while viewing Binance | Medium | HIGH - Core v5.0 value prop |
| **DIFF-02: Exchange latency comparison** | Display price discrepancy between exchanges for same symbol | Medium | MEDIUM - Useful for arbitrage decisions |
| **DIFF-03: Volume-weighted symbol scoring** | Rank symbols by cross-exchange combined volume | Low | LOW - Nice-to-have for symbol discovery |
| **DIFF-04: Geographic exchange routing** | Suggest optimal exchange based on user's geo (latency, restrictions) | High | LOW - Future consideration |
| **DIFF-05: Exchange health dashboard** | Aggregate view of all connected exchanges, WebSocket health, rate limit usage | Medium | MEDIUM - Operational visibility |

---

## Anti-Features (Do NOT Build)

Features to explicitly avoid in v5.0. Common mistakes or premature optimizations.

| Anti-Feature | Reason | Alternative |
|--------------|--------|-------------|
| **Trade execution** | Monitoring-only platform; execution adds complexity, liability, regulatory burden | Display signals, let user execute manually on exchange |
| **Order book aggregation** | Full Level2 orderbook across exchanges is expensive and not needed for MACD-V signals | Keep ticker-based price feeds only |
| **Cross-exchange position netting** | Complex reconciliation, unclear value for signal platform | Each exchange maintains separate position tracking |
| **Automatic exchange failover** | Switching exchanges mid-session could confuse signal context | Manual exchange selection; alert if exchange disconnects |
| **Multi-user shared cache** | User A and User B sharing same Coinbase candle cache adds complexity | Exchange-scoped, but each API instance serves one user |
| **Azure Service Bus** | Redis pub/sub sufficient for current scale; Azure adds latency and cost | Stay with Redis Cluster pub/sub |
| **Real-time arbitrage execution** | Actual arbitrage requires sub-second execution, capital on both exchanges | Soft-arbitrage (signals only) is safer and simpler |
| **CCXT integration** | CCXT adds abstraction overhead; native adapters are faster and more controllable | Continue native adapter pattern |
| **1m candle support** | Coinbase WebSocket only provides native 5m candles; 1m requires ticker aggregation with accuracy tradeoffs | Keep 5m as minimum timeframe |

---

## User Stories

### Mike (Coinbase user with positions)

> Mike runs the Coinbase API instance. He holds BTC, ETH, and SOL.

| Story | Acceptance Criteria |
|-------|---------------------|
| As Mike, I want my positions auto-subscribed regardless of Tier 1 | Positions in `usercandles:` keys if not in Tier 1, otherwise use shared pool |
| As Mike, I want to start the API without immediate WebSocket connections | API starts in idle mode, `start` command initiates connections |
| As Mike, I want Kaia to see my Coinbase signals | Mike's signals published to exchange-scoped channel, Kaia's PerseusWeb subscribes |
| As Mike, I want to see exchange connection status | Dashboard shows `connected`, `last_heartbeat`, uptime |
| As Mike, I want to add DOGE manually even if it's not in Tier 1 | Manual add validates against Coinbase API, stores in user overflow keys |

### Kaia (Binance scalper, cross-exchange watcher)

> Kaia runs PerseusWeb frontend. She trades on Binance.com but watches Coinbase for signals.

| Story | Acceptance Criteria |
|-------|---------------------|
| As Kaia, I want to see BTC signals from Coinbase while on Binance | Subscribe to `channel:exchange:coinbase:alerts:BTC-USD` from PerseusWeb |
| As Kaia, I want to know which exchange triggered a signal | Alert payload includes `source_exchange_id: 'coinbase'` |
| As Kaia, I want to compare BTC price on both exchanges | Ticker data from both exchanges available via pub/sub |
| As Kaia, I want to buy on Binance when Coinbase signal fires | PerseusWeb displays alert with "Buy on Binance" action (manual execution) |
| As Kaia, I want to configure which exchanges I watch | Settings UI for cross-exchange subscriptions |

---

## Feature Dependencies

```
EXC-01 (exchanges table)
    |
    +---> EXC-02 (user_exchanges FK)
    |         |
    |         +---> DATA-01 (exchange-scoped candle keys)
    |         |         |
    |         |         +---> DATA-02 (exchange-scoped indicator keys)
    |         |         |
    |         |         +---> DATA-04 (dual-read pattern)
    |         |
    |         +---> DATA-03 (user overflow keys)
    |
    +---> EXC-03 (adapter factory)
    |         |
    |         +---> CTL-01 (idle startup)
    |                   |
    |                   +---> CTL-02 (start command)
    |                   |
    |                   +---> CTL-03 (--autostart flag)
    |
    +---> DATA-05 (cross-exchange pub/sub)
              |
              +---> VIS-01 (exchange-scoped alerts)
              |
              +---> VIS-02 (cross-exchange subscription)
              |
              +---> DIFF-01 (soft-arbitrage signals)

SYM-01 (Tier 1 volume) ----+
                           |
SYM-02 (user positions) ---+---> SYM-04 (de-duplication)
                           |
SYM-03 (manual adds) ------+
```

---

## MVP Recommendation

For v5.0 MVP, prioritize these features in order:

### Phase 1: Schema Foundation
1. **EXC-01**: `exchanges` metadata table
2. **EXC-02**: `user_exchanges` FK refactor

### Phase 2: Data Architecture
3. **DATA-01**: Exchange-scoped candle keys
4. **DATA-02**: Exchange-scoped indicator keys
5. **DATA-03**: User overflow keys
6. **DATA-04**: Dual-read pattern (backward compat)

### Phase 3: Symbol Management
7. **SYM-01**: Tier 1 Top N by volume
8. **SYM-02**: Tier 2 user positions
9. **SYM-04**: De-duplication logic

### Phase 4: Startup Control
10. **CTL-01**: Idle startup mode
11. **CTL-02**: `start` command
12. **CTL-03**: `--autostart` flag

### Phase 5: Cross-Exchange Visibility
13. **DATA-05**: Cross-exchange pub/sub channels
14. **VIS-01**: Exchange-scoped alert channels
15. **VIS-02**: Cross-exchange subscription
16. **VIS-03**: Alert source attribution

### Defer to v5.1+
- **DIFF-02**: Exchange latency comparison
- **DIFF-03**: Volume-weighted symbol scoring
- **DIFF-04**: Geographic exchange routing
- **DIFF-05**: Exchange health dashboard
- **SYM-03**: Manual symbol adds (Tier 2 positions is sufficient for MVP)

---

## Technical Considerations

### Redis Key Migration

Current keys (v4.0):
```
candles:{userId}:{exchangeId}:{symbol}:{timeframe}
indicator:{userId}:{exchangeId}:{symbol}:{timeframe}:{type}
channel:candle:close:{userId}:{exchangeId}:{symbol}:{timeframe}
```

New keys (v5.0):
```
# Tier 1 (shared pool)
candles:{exchange_id}:{symbol}:{timeframe}
indicator:{exchange_id}:{symbol}:{timeframe}:{type}
channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}

# Tier 2 (user overflow)
usercandles:{userId}:{exchange_id}:{symbol}:{timeframe}
userindicator:{userId}:{exchange_id}:{symbol}:{timeframe}:{type}
```

### Backward Compatibility

During migration:
1. Indicator service implements dual-read: check exchange-scoped first, fall back to user-scoped
2. Cache strategies accept optional `userId` parameter (null = exchange-scoped)
3. Existing server.ts continues working until explicitly switched to new mode

### Pub/Sub Channel Design

Cross-exchange visibility requires careful channel naming:
```
# Exchange-level (any subscriber can listen)
channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}
channel:exchange:{exchange_id}:alerts:{symbol}

# User-level (only that user's clients)
channel:user:{identity_sub}:alerts
```

---

## Sources

Research based on:
- Existing codebase analysis (v4.0 shipped patterns)
- PROJECT.md v5.0 milestone goals
- Domain research:
  - [Multi-Exchange Platform Architecture](https://www.hashcodex.com/cryptocurrency-exchange-architecture)
  - [Gate CrossEx Institutional Trading](https://beincrypto.com/gate-crossex-institutional-trading-platform/)
  - [Crypto Arbitrage Data Requirements](https://www.coinapi.io/blog/crypto-arbitrage-explained-coinapi-profit-opportunities-2025)
  - [Redis Pub/Sub Scaling](https://ably.com/blog/scaling-pub-sub-with-websockets-and-redis)
  - [Multi-Instance Node.js with Redis](https://code.tutsplus.com/multi-instance-nodejs-app-in-paas-using-redis-pubsub--cms-22239t)
  - [Trading Platform Watchlist Best Practices](https://uk.finance.yahoo.com/news/how-to-build-a-winning-crypto-watchlist-with-advanced-trader-tools-170858414.html)
  - [Lazy Initialization Patterns](https://learn.microsoft.com/en-us/dotnet/framework/performance/lazy-initialization)

---

*Researched: 2026-02-06*
*Researcher: Claude (gsd-researcher)*
