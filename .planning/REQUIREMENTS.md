# Requirements: v5.0 Distributed Exchange Architecture

Requirements for exchange-scoped data architecture enabling cross-exchange visibility.

## v5.0 Requirements

### Exchange Management

- [ ] **EXC-01**: `exchanges` metadata table with API limits, fees, geo restrictions, supported timeframes, WebSocket URLs
- [ ] **EXC-02**: `user_exchanges` FK refactor to reference `exchanges` table (normalize exchange data)
- [ ] **EXC-03**: Exchange adapter factory that instantiates correct adapter (Coinbase/Binance) based on exchange type
- [ ] **EXC-04**: Exchange connection status tracking (`connected_at`, `last_heartbeat`, `connection_state`)

### Data Architecture

- [ ] **DATA-01**: Exchange-scoped candle keys `candles:{exchange_id}:{symbol}:{timeframe}` (shared pool for Tier 1)
- [ ] **DATA-02**: Exchange-scoped indicator keys `indicator:{exchange_id}:{symbol}:{timeframe}:{type}` (shared calculations)
- [ ] **DATA-03**: User overflow keys `usercandles:{userId}:{exchange_id}:{symbol}:{timeframe}` with TTL for positions
- [ ] **DATA-04**: Dual-read pattern (indicator service checks exchange-scoped first, falls back to user-scoped)
- [ ] **DATA-05**: Cross-exchange pub/sub channels `channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}`

### Symbol Management

- [ ] **SYM-01**: Tier 1 symbol list - Top N by 24h volume (exchange-driven, shared pool)
- [ ] **SYM-02**: Tier 2 user positions - Auto-subscribe held positions (de-duped against Tier 1)
- [ ] **SYM-04**: Symbol de-duplication logic (Tier 2 entries matching Tier 1 use shared pool)

### Startup/Control

- [ ] **CTL-01**: Idle startup mode - API starts without WebSocket connections, awaits `start` command
- [ ] **CTL-02**: `start` command to initiate exchange connections (replaces auto-connect)
- [ ] **CTL-03**: `--autostart <exchange>` CLI flag to bypass idle mode for specific exchange
- [ ] **CTL-04**: Connection lifecycle events (`exchange:connecting`, `exchange:connected`, `exchange:disconnected`)

### Cross-Exchange Visibility

- [ ] **VIS-01**: Exchange-scoped alert channels `channel:alerts:{exchange_id}` (not user-scoped)
- [ ] **VIS-02**: Cross-exchange subscription - Client can subscribe to any exchange's feed
- [ ] **VIS-03**: Alert source attribution - Alert payloads include `source_exchange_id` field

## v5.1+ Requirements (Deferred)

### Symbol Management

- [ ] **SYM-03**: Tier 2 manual adds - User-added symbols with validation + de-dupe
- [ ] **SYM-05**: Symbol metrics endpoint - 24h volume, price, market cap for add/remove decisions

### Differentiators

- [ ] **DIFF-02**: Exchange latency comparison - Display price discrepancy between exchanges
- [ ] **DIFF-03**: Volume-weighted symbol scoring - Rank symbols by cross-exchange combined volume
- [ ] **DIFF-04**: Geographic exchange routing - Suggest optimal exchange based on user's geo
- [ ] **DIFF-05**: Exchange health dashboard - Aggregate view of all connected exchanges

## Out of Scope

| Feature | Reason |
|---------|--------|
| Trade execution | Monitoring-only platform; execution adds complexity, liability, regulatory burden |
| Order book aggregation | Full Level2 orderbook across exchanges not needed for MACD-V signals |
| Cross-exchange position netting | Complex reconciliation, unclear value for signal platform |
| Automatic exchange failover | Switching exchanges mid-session could confuse signal context |
| Multi-user shared cache | Exchange-scoped but each API instance serves one user |
| Azure Service Bus | Redis pub/sub sufficient for current scale |
| Real-time arbitrage execution | Requires sub-second execution; soft-arbitrage (signals only) is safer |
| CCXT integration | Abstraction overhead; native adapters are faster and more controllable |
| 1m candle support | Coinbase WebSocket only provides native 5m; 1m requires ticker aggregation |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EXC-01 | 23 | Pending |
| EXC-02 | 23 | Pending |
| EXC-03 | 28 | Pending |
| EXC-04 | 28 | Pending |
| DATA-01 | 24 | Pending |
| DATA-02 | 24 | Pending |
| DATA-03 | 24 | Pending |
| DATA-04 | 24 | Pending |
| DATA-05 | 24 | Pending |
| SYM-01 | 25 | Pending |
| SYM-02 | 25 | Pending |
| SYM-04 | 25 | Pending |
| CTL-01 | 26 | Pending |
| CTL-02 | 26 | Pending |
| CTL-03 | 26 | Pending |
| CTL-04 | 26 | Pending |
| VIS-01 | 27 | Pending |
| VIS-02 | 27 | Pending |
| VIS-03 | 27 | Pending |

---

*Created: 2026-02-06*
*Milestone: v5.0 Distributed Exchange Architecture*
