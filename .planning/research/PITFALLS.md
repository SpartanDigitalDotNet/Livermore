# Pitfalls Research: v5.0 Multi-Exchange Architecture

**Researched:** 2026-02-06
**Confidence:** HIGH (based on codebase analysis + current documentation)

## Executive Summary

The v5.0 refactor from user-scoped to exchange-scoped data architecture introduces significant migration complexity. The current codebase has 13+ files with hardcoded `userId:exchangeId` patterns in Redis keys, all cache strategies accept userId/exchangeId parameters, and the CoinbaseAdapter has userId/exchangeId embedded in its constructor options.

Key risk areas:
1. **Key migration with live data** - Cannot atomically migrate keys while WebSocket produces new data
2. **Symbol normalization gaps** - BTC-USD (Coinbase) vs BTCUSDT (Binance) will cause data silos
3. **Redis Cluster cross-slot operations** - Existing code already handles this, but new shared keys increase MOVED error risk
4. **Azure Redis pipeline constraints** - Comment in `candle-cache.ts:44` documents this existing limitation
5. **Geo-restriction blind spots** - Binance.com API blocked in US; Binance.US has state-level restrictions

## Critical Pitfalls (HIGH severity)

### Pitfall 1: Key Migration During Live Data Production

**Impact:** Data loss or duplication during migration. Old keys receive new WebSocket updates while migration runs, resulting in stale data in new keys or missing recent candles.

**Warning signs:**
- WebSocket reconnection during migration
- Candle timestamps older than expected after migration completes
- Indicator calculations produce NaN (missing candles in time series)

**Prevention:**
1. **Dual-write phase first:** Modify all write paths to write to BOTH old AND new key formats before migrating existing data
2. **Stop-the-world alternative:** Use pause command to stop CoinbaseAdapter, migrate, resume with new key format
3. **Validation script:** Compare candle counts and latest timestamps between old and new keys before cutover

**Phase to address:** Phase 1 (Key Migration) - Must be the first phase. Migration strategy determines all subsequent work.

**Codebase references:**
- `packages/cache/src/keys.ts` - All key builders need dual-write variants
- `packages/cache/src/strategies/candle-cache.ts` - addCandle/addCandleIfNewer need dual-write
- `packages/coinbase-client/src/adapter/coinbase-adapter.ts:497-506` - Cache writes here

---

### Pitfall 2: Symbol Normalization Across Exchanges

**Impact:** Same asset tracked separately on different exchanges, doubling storage and preventing cross-exchange analysis. BTC-USD from Coinbase and BTCUSD from Binance.US stored as separate symbols.

**Warning signs:**
- Dashboard shows "BTC-USD" and "BTCUSD" as different assets
- Cross-exchange arbitrage detection fails (comparing apples to oranges)
- User adds symbol on one exchange, expects to see data from another

**Prevention:**
1. **Canonical symbol format:** Define one format (recommend `BASE-QUOTE` with dash separator)
2. **Exchange-specific mapping table:** Store original symbol per exchange
3. **Normalize at adapter boundary:** Each adapter converts to canonical format before cache write

**Phase to address:** Phase 2 (Exchange Metadata) - exchanges table should include symbol_format and normalization rules

**Technical detail:**
```typescript
// Coinbase: BTC-USD (already canonical)
// Binance.com/US: BTCUSD -> normalize to BTC-USD
// Kraken: XXBTZUSD -> normalize to BTC-USD

interface ExchangeMetadata {
  symbolFormat: 'dash' | 'concat' | 'kraken';
  normalizeFn: (raw: string) => string;
}
```

---

### Pitfall 3: Redis Cluster Cross-Slot Pipeline Failures

**Impact:** MOVED errors crash batch operations. Current code already works around this (see `candle-cache.ts:43-80`), but new shared keys could regress.

**Warning signs:**
- "All keys in the pipeline should belong to the same slots allocation group" errors in logs
- Batch operations silently drop keys
- High latency on multi-key operations

**Prevention:**
1. **Preserve existing pattern:** Keep the per-key loop pattern from `candle-cache.ts:62-80`
2. **Hash tag strategy:** Consider `{exchange}:candles:...` prefix to force same slot (requires testing)
3. **Test with Azure Redis Cluster:** Local Redis doesn't exhibit cluster behavior

**Phase to address:** Phase 1 (Key Migration) - Key format decision affects slot distribution

**Codebase reference:**
```typescript
// From candle-cache.ts:43-44
// Note: Uses individual commands instead of pipeline for Azure Redis Cluster compatibility.
// Pipeline batches commands across different keys which causes MOVED errors in cluster mode.
```

---

### Pitfall 4: Geo-Restriction Detection Failure

**Impact:** API connection attempts to Binance.com from US IP fail silently or ban the IP. Users configure exchange, see "connected" status, but receive no data.

**Warning signs:**
- Exchange adapter connects but receives no candle events
- 403/451 errors in exchange REST calls
- Account suspension notices from exchange

**Prevention:**
1. **IP geolocation check at startup:** Use external service to determine server location
2. **Exchange metadata includes geo_allowed regions:** `exchanges` table stores allowed countries
3. **Graceful failure with clear message:** "Binance.com not available in your region. Use Binance.US."
4. **Never use VPN workarounds:** Account suspension and legal risk

**Phase to address:** Phase 2 (Exchange Metadata) - exchanges table should include `geo_allowed: string[]`

**Geo-restriction facts:**
- Binance.com: Blocked in USA entirely
- Binance.US: Blocked in AK, HI, ME, NY, TX, VT, and paused in CT, FL, GA, MN, NC, OH, OR, WA
- Coinbase: Available in most US states, some restrictions exist

---

### Pitfall 5: Exchange Rate Limit Divergence

**Impact:** Binance rate limit patterns differ from Coinbase. Code tuned for Coinbase (100ms throttle in `coinbase-adapter.ts:889`) may trigger 429s on Binance.

**Warning signs:**
- 429 errors after adding Binance adapter
- Escalating bans (2 minutes -> 30 minutes -> 3 days)
- `X-MBX-USED-WEIGHT` header not being monitored

**Prevention:**
1. **Per-exchange rate limiter:** Don't use global throttle
2. **Monitor weight headers:** Binance returns used weight in response headers
3. **Exponential backoff on 429:** Respect `Retry-After` header
4. **WebSocket over REST:** Binance WebSocket limits are more generous

**Phase to address:** Phase 3 (Binance Adapter) - Rate limiter configuration per exchange

**Binance specifics:**
- 300 WebSocket connections per 5 minutes per IP
- 5-10 incoming messages per second per connection
- 1024 streams per connection maximum
- Weight-based REST limits (varies by endpoint)

---

## Moderate Pitfalls (MEDIUM severity)

### Pitfall 6: Orphaned User-Scoped Keys After Migration

**Impact:** Old `candles:1:1:BTC-USD:5m` keys remain after migration, consuming Redis memory indefinitely.

**Warning signs:**
- Redis memory usage doesn't decrease after migration
- `KEYS candles:*:*:*:*` returns old format keys
- TTL not set on old keys (they never expire)

**Prevention:**
1. **Post-migration cleanup script:** Delete old format keys after validation
2. **Set aggressive TTL on old keys during dual-write phase:** 24h TTL so they self-expire
3. **Monitor key count:** Track `dbsize` before and after migration

**Phase to address:** Phase 1 (Key Migration) - Cleanup step after cutover

---

### Pitfall 7: Pub/Sub Channel Migration Breaks Subscribers

**Impact:** Indicator service subscribed to `channel:candle:close:1:1:BTC-USD:5m` stops receiving events when adapter publishes to `channel:candle:close:1:BTC-USD:5m`.

**Warning signs:**
- Indicator values stop updating after migration
- BoundaryRestService doesn't trigger higher timeframe fetches
- Alert service misses signals

**Prevention:**
1. **Migrate publishers before subscribers:** Or dual-publish during transition
2. **Update all `candleCloseChannel` and `candleClosePattern` usages:** 8+ call sites identified
3. **Wildcard pattern test:** Verify psubscribe patterns work with new format

**Phase to address:** Phase 1 (Key Migration) - Part of key format change

**Codebase references:**
- `packages/cache/src/keys.ts:74-81,127-134` - Channel builders
- `apps/api/src/services/indicator-calculation.service.ts` - Subscriber
- `packages/coinbase-client/src/reconciliation/boundary-rest-service.ts` - Subscriber

---

### Pitfall 8: Idle Startup Race Condition

**Impact:** Control channel receives `start` command before service registry is populated, causing null reference errors.

**Warning signs:**
- "Services not initialized" errors on first `start` command
- Startup command works on second try but not first
- Race between API ready and Redis subscription active

**Prevention:**
1. **Explicit ready state:** Don't subscribe to control channel until all services initialized
2. **Command queue during init:** Buffer commands, process after ready
3. **Startup state machine:** INIT -> READY -> STARTED (only accept commands in READY)

**Phase to address:** Phase 4 (Idle Startup) - Requires state machine for startup flow

**Current code reference:**
```typescript
// server.ts:70-72 - Current pattern with lazy init
let controlChannelService: ControlChannelService | null = null;
let controlChannelInitPromise: Promise<void> | null = null;
let globalServiceRegistry: ServiceRegistry | null = null;
```

---

### Pitfall 9: Exchange Metadata Stale After Deployment

**Impact:** Hardcoded exchange metadata (rate limits, fees, supported symbols) becomes outdated. Binance changes limits, code continues with old values.

**Warning signs:**
- Unexpected 429 errors after exchange updates their limits
- Fee calculations incorrect
- New symbols not appearing

**Prevention:**
1. **Metadata in database, not code:** `exchanges` table stores configurable values
2. **Admin UI for updates:** Allow editing exchange metadata without redeployment
3. **Periodic validation:** Scheduled check against exchange API for supported pairs

**Phase to address:** Phase 2 (Exchange Metadata) - Design for mutability

---

### Pitfall 10: Shared Candle Pool Starvation

**Impact:** With user-scoped keys, each user backfills their own data. With shared pool, if no active user monitors a symbol, the shared pool has gaps.

**Warning signs:**
- User enables symbol, no candles available
- Shared pool has spotty coverage for low-volume symbols
- First user to request symbol waits for full backfill

**Prevention:**
1. **Tier 1 always backfilled:** Top N symbols by volume always maintained
2. **On-demand backfill for Tier 2:** User adds symbol, triggers backfill
3. **Background warmup:** Idle periods used to pre-populate likely symbols

**Phase to address:** Phase 5 (Symbol Sourcing) - Tier 1/Tier 2 strategy implementation

---

## Low Pitfalls (LOW severity)

### Pitfall 11: TypeScript Type Breakage

**Impact:** Changing function signatures (removing userId parameter) breaks compilation across 13+ files.

**Warning signs:**
- TypeScript compilation errors in CI
- IDE errors during development

**Prevention:**
1. **Optional parameter first:** Make userId optional with default before removing
2. **One-file-at-a-time refactor:** Don't batch all changes
3. **CI runs before merge:** Catch type errors before main branch

**Phase to address:** Phase 1 (Key Migration) - Part of code refactor

---

### Pitfall 12: Hardcoded userId=1 Throughout Codebase

**Impact:** Multiple files have `userId = 1` hardcoded. Refactor might miss some, leaving inconsistent behavior.

**Warning signs:**
- Some operations work, others fail
- Logs show inconsistent userId values

**Locations found:**
- `apps/api/src/server.ts:192-193` - cleanupExcludedSymbols
- `apps/api/src/server.ts:394-395` - CoinbaseAdapter options
- `apps/api/src/services/control-channel.service.ts:558-559` - handleClearCache
- `apps/api/src/services/control-channel.service.ts:968-970` - cleanupSymbolCache

**Prevention:**
1. **Search and catalog:** Find all `userId = 1` occurrences before starting
2. **Single refactor pass:** Address all in one PR
3. **Remove or replace with exchangeId logic**

**Phase to address:** Phase 1 (Key Migration) - Code cleanup

---

### Pitfall 13: Binance WebSocket Message Volume

**Impact:** Binance market_trades channel produces far more messages than Coinbase. Current synchronous `handleMarketTradesMessage` may lag.

**Warning signs:**
- Sequence gap count increases rapidly
- Memory usage grows
- Watchdog timeouts despite connection being alive

**Prevention:**
1. **Message batching:** Aggregate multiple trades before cache write
2. **Async processing with backpressure:** Don't block event loop
3. **Selective subscription:** Only subscribe to needed symbols

**Phase to address:** Phase 3 (Binance Adapter) - Performance tuning

**Current code reference:**
```typescript
// coinbase-adapter.ts:581-595 - SYNCHRONOUS to avoid blocking
private handleMarketTradesMessage(message: MarketTradesMessage): void {
  // Synchronous in-memory aggregation - no await!
```

---

## Migration-Specific Pitfalls

### Key Migration

| Pitfall | Severity | Mitigation |
|---------|----------|------------|
| Live data production during migration | HIGH | Dual-write or stop-the-world |
| Old keys not cleaned up | MEDIUM | TTL during transition, cleanup script |
| Key format change breaks cluster slots | HIGH | Test with Azure Redis, consider hash tags |
| Type signature changes break builds | LOW | Optional params first, gradual refactor |

### Schema Migration

| Pitfall | Severity | Mitigation |
|---------|----------|------------|
| Atlas migration fails on FK constraint | MEDIUM | Order: exchanges table before user_exchanges FK |
| user_exchanges.exchangeId type mismatch | LOW | Atlas will validate, but test locally first |
| Drizzle schema out of sync | LOW | Run `drizzle-kit pull` after Atlas migration |

### Service Migration

| Pitfall | Severity | Mitigation |
|---------|----------|------------|
| Pub/sub channels break during transition | MEDIUM | Dual-publish, migrate publishers before subscribers |
| Indicator service misses candle:close events | HIGH | Ensure subscription active before adapter starts |
| Control channel receives commands before ready | MEDIUM | State machine for startup flow |

## Sources

**Redis Migration:**
- [Redis MIGRATE Command](https://redis.io/docs/latest/commands/migrate/)
- [Redis Cloud Migration](https://redis.io/learn/operate/migration)

**Multi-Exchange Architecture:**
- [Cryptocurrency Exchange Architecture](https://www.debutinfotech.com/blog/cryptocurrency-exchange-architecture)
- [Multi Exchange Crypto Trading Platform](https://www.ionixxtech.com/resources/whitepaper-ebooks/multi-exchange-crypto-trading-platform-development)

**Symbol Normalization:**
- [BTC/USD vs BTC/USDT](https://kyrrex.com/blog/crypto-trading-pairs-made-easy-understanding-btc-usd-vs-btc-usdt)
- [BTC/USD vs BTC/USDT Differences](https://coruzant.com/blockchain/btc-usd-vs-btc-usdt-differences/)

**Rate Limits:**
- [Binance Rate Limits](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/limits)
- [Binance WebSocket Limits](https://academy.binance.com/en/articles/what-are-binance-websocket-limits)
- [Coinbase WebSocket Rate Limits](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-rate-limits)
- [Avoid Binance Rate Limit Bans](https://academy.binance.com/en/articles/how-to-avoid-getting-banned-by-rate-limits)

**Geo-Restrictions:**
- [Binance.US Supported Regions](https://support.binance.us/en/articles/9842798-list-of-supported-and-unsupported-states-and-regions)
- [Binance Restricted Countries](https://www.cryptowinrate.com/binance-restricted-supported-countries)

**Redis Cluster:**
- [ioredis Cross-Slot Pipeline Issue #1602](https://github.com/redis/ioredis/issues/1602)
- [ioredis Cluster MOVED Errors](https://deepwiki.com/binance/binance-spot-api-docs/1.3-rate-limiting)

**Zero-Downtime Migration:**
- [Zero-Downtime Database Migration Guide](https://dev.to/ari-ghosh/zero-downtime-database-migration-the-definitive-guide-5672)
- [Database Migration Strategies](https://sanjaygoraniya.dev/blog/2025/10/database-migration-strategies)
