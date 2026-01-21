# Requirements: v2.0 Data Pipeline Redesign

**Defined:** 2026-01-21
**Core Value:** Data accuracy and timely alerts — indicators must calculate on complete, accurate candle data

## v2.0 Requirements

Requirements for eliminating 429 errors and data gaps through cache-first, event-driven architecture.

### Adapter

- [x] **ADPT-01**: Exchange adapter interface abstracts exchange-specific logic from indicator service
- [x] **ADPT-02**: Coinbase adapter subscribes to native `candles` WebSocket channel (5m granularity)
- [x] **ADPT-03**: Adapter normalizes exchange candles to unified `UnifiedCandle` schema
- [x] **ADPT-04**: Adapter emits standardized `candle:close` events when candles finalize

### WebSocket

- [x] **WS-01**: WebSocket connection auto-reconnects with exponential backoff on disconnect
- [x] **WS-02**: Heartbeat channel subscription prevents 60-90s idle disconnection
- [x] **WS-03**: Watchdog timer detects silent disconnections (no message > 30s = force reconnect)
- [x] **WS-04**: Sequence numbers tracked to detect dropped messages
- [x] **WS-05**: Reconnection triggers gap detection and REST backfill before resuming

### Cache

- [x] **CACHE-01**: Candles written directly to Redis sorted sets from WebSocket events
- [x] **CACHE-02**: Timestamp-based versioning prevents out-of-order writes (only accept if timestamp > existing)
- [ ] **CACHE-03**: Cache is single source of truth — indicator service never calls REST API during normal operation
- [ ] **CACHE-04**: Gap detection query finds missing timestamps in candle sequences

### Indicators

- [ ] **IND-01**: Indicator service subscribes to `candle:close` events (no timer-based polling)
- [ ] **IND-02**: Indicator calculations read exclusively from Redis cache
- [ ] **IND-03**: Readiness check ensures 60+ candles before calculating (MACD-V minimum)
- [ ] **IND-04**: Higher timeframes (15m, 1h, 4h, 1d) read from cache (populated by Phase 07 backfill)

### Backfill

- [ ] **BKFL-01**: Startup backfill fetches 60+ historical candles via REST per symbol/timeframe
- [ ] **BKFL-02**: Backfill uses rate limiting (5 requests/batch, 1s delay) to avoid 429s
- [ ] **BKFL-03**: Priority order fills shorter timeframes (1m, 5m) before longer ones
- [ ] **BKFL-04**: Progress tracking logs backfill status during startup

### Reconciliation

- [ ] **RECON-01**: Background job scans for candle gaps every 5 minutes
- [ ] **RECON-02**: Hourly full reconciliation compares cached candles to REST API
- [ ] **RECON-03**: Detected gaps trigger rate-limited REST backfill
- [ ] **RECON-04**: `node-cron` schedules reconciliation jobs

## v2.1 Requirements (Deferred)

Deferred to future release. Tracked but not in current roadmap.

### Multi-Exchange

- **MEXCH-01**: Binance.us adapter implementation
- **MEXCH-02**: Binance.com adapter implementation
- **MEXCH-03**: Exchange health dashboard

### Observability

- **OBS-01**: Connection health metrics for production monitoring
- **OBS-02**: Circuit breaker stops reconnect attempts after N failures
- **OBS-03**: TTL jitter prevents cache stampede at expiration

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Full Order Book (Level2) | Not needed for MACD-V calculation |
| Trade Execution | v2.0 is monitoring only |
| CCXT Library | Performance overhead, 100+ exchange abstraction unnecessary |
| Cross-Region Replication | Single-region deployment sufficient |
| Historical Backfill > 60 Candles | 60 is sufficient for MACD-V accuracy |
| Binance Adapter Implementation | Architecture ready, implementation deferred to v2.1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ADPT-01 | Phase 04 | Complete |
| ADPT-02 | Phase 05 | Complete |
| ADPT-03 | Phase 05 | Complete |
| ADPT-04 | Phase 05 | Complete |
| WS-01 | Phase 05 | Complete |
| WS-02 | Phase 05 | Complete |
| WS-03 | Phase 05 | Complete |
| WS-04 | Phase 05 | Complete |
| WS-05 | Phase 05 | Complete |
| CACHE-01 | Phase 04 | Complete |
| CACHE-02 | Phase 04 | Complete |
| CACHE-03 | Phase 3 | Pending |
| CACHE-04 | Phase 5 | Pending |
| IND-01 | Phase 3 | Pending |
| IND-02 | Phase 3 | Pending |
| IND-03 | Phase 3 | Pending |
| IND-04 | Phase 3 | Pending |
| BKFL-01 | Phase 4 | Pending |
| BKFL-02 | Phase 4 | Pending |
| BKFL-03 | Phase 4 | Pending |
| BKFL-04 | Phase 4 | Pending |
| RECON-01 | Phase 5 | Pending |
| RECON-02 | Phase 5 | Pending |
| RECON-03 | Phase 5 | Pending |
| RECON-04 | Phase 5 | Pending |

**Coverage:**
- v2.0 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-21*
*Last updated: 2026-01-21 after initial definition*
