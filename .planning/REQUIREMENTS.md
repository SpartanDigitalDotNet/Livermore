# Requirements: Livermore v7.0 Smart Warmup & Binance Adapter

**Defined:** 2026-02-13
**Core Value:** Data accuracy and timely alerts

## v1 Requirements

Requirements for v7.0 release. Each maps to roadmap phases.

### Smart Warmup

- [ ] **WARM-01**: Before backfilling, an Exchange Candle Status Scan checks each symbol from largest to smallest timeframe (1d, 4h, 1h, 15m, 5m, 1m) to identify which symbol/timeframe pairs already have sufficient cached data
- [ ] **WARM-02**: Scan results are compiled into an Exchange Warmup Schedule listing which symbols need which timeframes fetched (skipping pairs with enough cached candles)
- [ ] **WARM-03**: Warmup schedule is persisted to Redis at `exchange:<exchange_id>:warm-up-schedule:symbols` so other services can read it
- [ ] **WARM-04**: Warmup execution follows the schedule, only fetching missing symbol/timeframe pairs instead of brute-force backfilling everything
- [ ] **WARM-05**: Warmup progress stats (ETA, percent complete, symbols remaining, failures) are written to `exchange:<exchange_id>:warm-up-schedule:stats` in Redis and updated as warmup progresses
- [ ] **WARM-06**: Admin UI subscribes to warmup stats for the lifetime of the warmup process, displaying real-time progress (percent, ETA, current symbol, failures)

### Ticker Key Migration

- [ ] **TICK-01**: Impact assessment documents all services that read/write ticker keys and pub/sub channels affected by removing user_id
- [ ] **TICK-02**: Ticker key pattern changed from `ticker:{userId}:{exchangeId}:{symbol}` to `ticker:{exchangeId}:{symbol}` (exchange-scoped, consistent with candle/indicator keys)
- [ ] **TICK-03**: Ticker pub/sub channel updated to match new exchange-scoped key pattern

### Binance Adapter

- [ ] **BIN-01**: BinanceAdapter implements IExchangeAdapter interface with WebSocket streaming for real-time candle data
- [ ] **BIN-02**: BinanceAdapter supports both binance.com and binance.us using wsUrl/restUrl from the exchanges table (only URL difference)
- [ ] **BIN-04**: ExchangeAdapterFactory creates BinanceAdapter when exchange name is 'binance' or 'binance_us' (no longer commented out)
- [ ] **BIN-05**: BinanceAdapter handles Binance WebSocket message format, heartbeat/ping-pong, and automatic reconnection

### Admin Connect & Exchange Setup

- [ ] **ADM-01**: Admin Network page shows a "Connect" button for exchanges that are offline or idle
- [ ] **ADM-02**: Connect button checks if exchange is already running on another machine and shows a warning modal with lock holder info (hostname, IP, connected since) before proceeding
- [ ] **ADM-03**: Exchange Setup Modal allows creating and updating user_exchanges records (API key env var names, display name)
- [ ] **ADM-04**: Exchange Setup Modal correctly handles is_active/is_default orchestration (only one default exchange per user, toggling default updates previous default)

### Test Harness

- [ ] **TST-01**: Subscription Test Harness performs BTC 1d warmup to validate REST candle fetching works for an exchange
- [ ] **TST-02**: Subscription Test Harness runs a 2-second WebSocket subscription test to validate live streaming data is received
- [ ] **TST-03**: Binance.us warmup tested end-to-end with real exchange data confirming candles cache correctly
- [ ] **TST-04**: Handoff documentation prepared for Kaia to configure and run the Binance exchange on her machine

## v2 Requirements (Deferred)

### Standby and Failover

- **STBY-01**: Passive/standby instance registration (subscribe as backup for an exchange)
- **STBY-02**: Graceful handoff protocol (notify, takeover, confirm, shutdown)
- **STBY-03**: Automatic standby promotion when primary heartbeat expires

### Remote Administration

- **RMOT-01**: Remote Admin control -- send commands to another instance's API via Redis
- **RMOT-02**: Ngrok tunnel for remote Admin UI access, URL published to Redis
- **RMOT-03**: Authorization schema for remote operations

### Enhanced Monitoring

- **MON-01**: WebSocket-based real-time network view (replace polling)
- **MON-02**: Historical uptime percentage (24h/7d/30d)
- **MON-03**: Connection state timeline visualization

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-exchange simultaneous warmup | Warmup runs for one exchange at a time on one instance |
| Binance futures/margin API | Spot trading only, consistent with Coinbase scope |
| CCXT library | Performance overhead unnecessary, direct API integration preferred |
| Aggregated candle building from trades | Binance provides native kline WebSocket streams |
| Automatic exchange failover | Foundation first, failover deferred to standby/failover milestone |
| REST-only Binance mode | WebSocket streaming is required for real-time data |
| Symbol normalization (BTCUSDT to BTC-USD) | exchange_symbols table stores native format per exchange; normalization only needed for future user custom symbol lists |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| WARM-01 | Phase 35 | Pending |
| WARM-02 | Phase 35 | Pending |
| WARM-03 | Phase 35 | Pending |
| WARM-04 | Phase 35 | Pending |
| WARM-05 | Phase 35 | Pending |
| WARM-06 | Phase 37 | Pending |
| TICK-01 | Phase 34 | Pending |
| TICK-02 | Phase 34 | Pending |
| TICK-03 | Phase 34 | Pending |
| BIN-01 | Phase 36 | Pending |
| BIN-02 | Phase 36 | Pending |
| BIN-04 | Phase 36 | Pending |
| BIN-05 | Phase 36 | Pending |
| ADM-01 | Phase 37 | Pending |
| ADM-02 | Phase 37 | Pending |
| ADM-03 | Phase 37 | Pending |
| ADM-04 | Phase 37 | Pending |
| TST-01 | Phase 38 | Pending |
| TST-02 | Phase 38 | Pending |
| TST-03 | Phase 38 | Pending |
| TST-04 | Phase 38 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-02-13*
*Last updated: 2026-02-13 -- traceability updated with phase assignments*
