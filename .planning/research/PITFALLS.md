# Pitfalls Research: v2.0 Data Pipeline

**Domain:** Real-time cryptocurrency data pipelines with exchange adapters
**Researched:** 2026-01-19
**Context:** Migrating from REST-heavy to cache-first, event-driven architecture

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or extended downtime.

---

### Pitfall 1: Silent WebSocket Disconnections

**What goes wrong:** WebSocket connection drops without triggering error handlers. The socket appears "open" but receives no data. System continues operating on stale data without awareness.

**Why it happens:**
- Network issues that don't cleanly close the connection
- Exchange server-side timeouts (Binance: 24h, Coinbase varies)
- Missed ping/pong heartbeats
- Load balancer timeouts

**Consequences:**
- Indicators calculate on stale candle data
- Missed trading signals during disconnection window
- No 429 errors (a false positive that "everything is working")
- Data gaps that corrupt indicator calculations

**Warning signs:**
- Last message timestamp drifts beyond acceptable threshold (>15 seconds for active pairs)
- Candle close events stop firing at minute boundaries
- Cache timestamps don't update despite market activity
- Logs show no WebSocket errors but also no new messages

**Prevention:**
1. Implement "watchdog" timer comparing last message timestamp to current time
2. If no message received within threshold (e.g., 30 seconds), force reconnection
3. Log timestamp of every message; alert if drift exceeds threshold
4. Use heartbeat/ping-pong mechanism actively (don't just respond to server pings)

**Detection code pattern:**
```typescript
// Track last message time
let lastMessageTime = Date.now();

ws.on('message', () => {
  lastMessageTime = Date.now();
});

// Watchdog timer
setInterval(() => {
  const drift = Date.now() - lastMessageTime;
  if (drift > 30000) { // 30 seconds
    logger.warn('WebSocket stale, forcing reconnection');
    ws.terminate(); // Force close, let reconnection logic handle
  }
}, 10000);
```

**Recommended phase:** Phase 1 (WebSocket Infrastructure) - Build this into the exchange adapter foundation.

**Sources:** [CCXWS silent reconnection logic](https://github.com/altangent/ccxws), [Coinbase WebSocket Best Practices](https://docs.cdp.coinbase.com/exchange/websocket-feed/best-practices)

---

### Pitfall 2: Reconnection Without State Recovery

**What goes wrong:** After WebSocket reconnection, system resumes receiving new data but has a gap in historical data from the disconnection period. Indicators calculate incorrectly due to missing candles.

**Why it happens:**
- Reconnection logic only re-subscribes to channels
- No mechanism to detect or fill the gap
- Assumption that "reconnected = recovered"

**Consequences:**
- Missing candles corrupt OHLCV aggregation (wrong high/low for the period)
- MACD calculation produces incorrect values due to gap
- Signals fire or don't fire based on corrupted data
- Gap may propagate to higher timeframes (1m gap -> 5m incorrect -> 15m incorrect)

**Warning signs:**
- Candle count in cache doesn't match expected count for time range
- Gaps in timestamp sequence when listing cached candles
- Indicator values diverge from exchange chart values after reconnection

**Prevention:**
1. On reconnection, calculate time gap since last received candle
2. If gap > 1 candle period, trigger REST backfill for the gap
3. Validate candle sequence continuity after backfill
4. Log reconnection events with gap duration for audit

**Recovery pattern:**
```typescript
async function onReconnect(symbol: string, timeframe: string) {
  const lastCachedCandle = await cache.getLatestCandle(symbol, timeframe);
  const gapMinutes = (Date.now() - lastCachedCandle.closeTime) / 60000;

  if (gapMinutes > timeframeToCandlePeriod(timeframe)) {
    logger.info(`Gap detected: ${gapMinutes} minutes. Backfilling...`);
    await backfillFromREST(symbol, timeframe, lastCachedCandle.closeTime, Date.now());
  }
}
```

**Recommended phase:** Phase 2 (Reconciliation) - Part of the background reconciliation job.

**Sources:** [Binance Developer Community - Data stream reconnects](https://dev.binance.vision/t/how-to-avoid-losing-data-across-user-data-stream-disconnect-reconnects/12354)

---

### Pitfall 3: Cache-REST Data Mismatch

**What goes wrong:** WebSocket-built candles have different OHLCV values than REST API candles for the same time period. When system switches between sources (or uses both), indicators produce different values.

**Why it happens:**
- WebSocket candles built from ticker aggregation vs REST candles from exchange's official aggregation
- Different timestamp alignment (your minute boundary vs exchange's minute boundary)
- Missed ticks during WebSocket processing cause different high/low values
- Time synchronization issues between local system and exchange

**Consequences:**
- MACD values differ from what user sees on exchange chart
- Backtest results don't match live trading results
- Alerts fire at different times than expected
- Loss of user trust in system accuracy

**Warning signs:**
- Running parallel comparison shows >0.1% difference in close prices
- High/low values consistently lower/higher than REST values
- Volume doesn't match between sources

**Prevention:**
1. Use exchange's native candle channel when available (Coinbase `candles` channel for 5m)
2. Align candle boundaries to exchange's expected boundaries (UTC minute/hour boundaries)
3. Implement periodic validation comparing cached candles to REST candles
4. Log and alert on discrepancies exceeding threshold

**Validation pattern:**
```typescript
// Periodic validation (every 5 minutes)
async function validateCandles(symbol: string) {
  const cachedCandles = await cache.getCandles(symbol, '5m', 5);
  const restCandles = await rest.getCandles(symbol, '5m', 5);

  for (let i = 0; i < cachedCandles.length; i++) {
    const diff = Math.abs(cachedCandles[i].close - restCandles[i].close);
    if (diff > cachedCandles[i].close * 0.001) { // 0.1% threshold
      logger.warn(`Candle mismatch for ${symbol}: cached=${cachedCandles[i].close}, rest=${restCandles[i].close}`);
      // Prefer REST as source of truth, update cache
      await cache.updateCandle(symbol, restCandles[i]);
    }
  }
}
```

**Recommended phase:** Phase 2 (Reconciliation) - Core reconciliation responsibility.

**Sources:** [CoinAPI - OHLCV Data Explained](https://www.coinapi.io/blog/ohlcv-data-explained-real-time-updates-websocket-behavior-and-trading-applications)

---

### Pitfall 4: Race Conditions in Event-Driven Cache Updates

**What goes wrong:** Multiple events (1m candle close, 5m candle close, reconciliation backfill) attempt to update the same cache key simultaneously. Later events overwrite earlier events, or events process out of order.

**Why it happens:**
- Asynchronous event processing with no ordering guarantees
- Multiple sources writing to same cache key
- No locking or versioning on cache operations

**Consequences:**
- Older candle data overwrites newer data
- Partial updates leave cache in inconsistent state
- Indicator calculations use mix of old and new data
- Intermittent, hard-to-reproduce bugs

**Warning signs:**
- Cache values "flicker" between different values
- Indicator values occasionally jump then revert
- Logs show out-of-order event processing
- Issues appear under load but not in testing

**Prevention:**
1. Use timestamp-based versioning: only accept writes if timestamp > existing timestamp
2. Implement single writer per symbol/timeframe (partition by symbol)
3. Use Redis transactions (MULTI/EXEC) for multi-key updates
4. Process events sequentially per partition (symbol), parallel across partitions

**Safe write pattern:**
```typescript
async function writeCandleIfNewer(candle: Candle): Promise<boolean> {
  const existing = await cache.getCandle(candle.symbol, candle.timeframe, candle.openTime);

  if (existing && existing.closeTime >= candle.closeTime) {
    // Existing is newer or same, skip write
    return false;
  }

  await cache.setCandle(candle);
  return true;
}
```

**Recommended phase:** Phase 1 (Cache Layer) - Build versioning into cache operations from the start.

**Sources:** [Event-Driven.io - Race Conditions in EDA](https://event-driven.io/en/dealing_with_race_conditions_in_eda_using_read_models/)

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or degraded functionality.

---

### Pitfall 5: Timeframe Aggregation Edge Cases

**What goes wrong:** Higher timeframe candles (5m, 15m, 1h) aggregated from lower timeframes have incorrect values at boundary conditions.

**Why it happens:**
- Off-by-one errors in determining which 1m candles belong to which 5m candle
- Timezone handling issues (local time vs UTC)
- Incomplete candles included in aggregation
- First candle of period handled differently than subsequent candles

**Consequences:**
- 5m candle has wrong open (should be first 1m open, not latest)
- High/low misses actual extremes due to excluded candle
- Volume double-counted or missing
- 4h boundary issues cascade to daily timeframe

**Warning signs:**
- 5m candle open != 1m candle open for same period start
- Aggregated volume != sum of constituent candle volumes
- Issues appear at hour boundaries (when 4 timeframes align)

**Prevention:**
1. Use inclusive-exclusive time ranges: [start, end) not [start, end]
2. Always aggregate from complete candles only (wait for 1m close before including in 5m)
3. Test extensively at boundary conditions: :00, :05, :15, :30, :00 (hour)
4. Add validation: aggregated_volume == sum(constituent_volumes)

**Boundary alignment formula:**
```typescript
function getTimeframeBoundary(timestamp: number, timeframeMinutes: number): number {
  return Math.floor(timestamp / (timeframeMinutes * 60000)) * (timeframeMinutes * 60000);
}

// 5m candle at 10:05 includes 1m candles: 10:00, 10:01, 10:02, 10:03, 10:04
// NOT 10:05 (that's next period)
```

**Recommended phase:** Phase 1 (Cache Layer) - Aggregation logic is foundational.

**Sources:** [TimescaleDB Hierarchical Aggregates Discussion](https://github.com/timescale/timescaledb/issues/5171)

---

### Pitfall 6: Indicator Recalculation on Incomplete Data

**What goes wrong:** Indicator service recalculates when only partial candle data is available (e.g., 45 of required 60 candles), producing incorrect values or errors.

**Why it happens:**
- Startup before backfill completes
- Reconnection gap not yet filled
- New symbol added without historical data
- Cache eviction removed old candles

**Consequences:**
- MACD values incorrect (exponential moving averages need history)
- Alerts fire on bogus values
- Different values than exchange chart (which has full history)
- User sees "NaN" or obviously wrong values

**Warning signs:**
- Indicator values wildly different at startup vs after running
- Values change significantly after a few minutes of operation
- Cache has fewer candles than required (60 for MACD)

**Prevention:**
1. Track "data readiness" state per symbol/timeframe
2. Don't emit indicator events until minimum candle requirement met
3. Query cache for candle count before calculation
4. Mark indicators as "preliminary" if calculated on <100% required data

**Readiness check pattern:**
```typescript
async function calculateMACD(symbol: string, timeframe: string): Promise<MACDResult | null> {
  const candles = await cache.getCandles(symbol, timeframe, 60);

  if (candles.length < 60) {
    logger.debug(`Insufficient data for ${symbol} ${timeframe}: ${candles.length}/60 candles`);
    return null; // Signal that data isn't ready
  }

  // Proceed with calculation
  return macd(candles);
}
```

**Recommended phase:** Phase 3 (Indicator Service) - Add readiness gates before calculation.

---

### Pitfall 7: Startup Backfill Rate Limiting

**What goes wrong:** At startup, system attempts to backfill historical candles for all symbols across all timeframes simultaneously, hitting rate limits immediately.

**Why it happens:**
- Eager initialization pattern
- No staggering of requests
- Underestimating total request count (25 symbols x 6 timeframes = 150 requests)
- Not accounting for rate limit windows

**Consequences:**
- 429 errors at startup (the problem we're trying to solve!)
- Some symbols get data, others don't
- Partial initialization leads to inconsistent behavior
- Manual restart needed to retry failed backfills

**Warning signs:**
- 429 errors in logs at startup
- Some symbols show data, others show "no data"
- System takes long time to become fully operational

**Prevention:**
1. Implement backfill queue with rate-limited processing
2. Prioritize: shorter timeframes first (1m, 5m), then longer (4h, 1d)
3. Use batch endpoints if available (Coinbase doesn't have; consider caching strategy)
4. Track backfill completion status per symbol/timeframe
5. Implement exponential backoff on 429 responses

**Staggered backfill pattern:**
```typescript
async function backfillAll(symbols: string[], timeframes: string[]) {
  const queue = [];
  for (const symbol of symbols) {
    for (const tf of timeframes) {
      queue.push({ symbol, timeframe: tf });
    }
  }

  // Process 5 at a time with 1 second delay between batches
  for (let i = 0; i < queue.length; i += 5) {
    const batch = queue.slice(i, i + 5);
    await Promise.all(batch.map(({ symbol, timeframe }) =>
      backfillSymbol(symbol, timeframe)
    ));
    await sleep(1000); // Rate limit protection
  }
}
```

**Recommended phase:** Phase 1 (Exchange Adapter) - Build rate-aware backfill into adapter.

---

### Pitfall 8: Cache Eviction Causing Data Loss

**What goes wrong:** Redis evicts old candle data under memory pressure, causing gaps in historical data needed for indicator calculation.

**Why it happens:**
- Redis maxmemory-policy set to volatile-lru or allkeys-lru
- No TTL set (data never expires) but memory fills up
- More symbols/timeframes than anticipated
- No monitoring of Redis memory usage

**Consequences:**
- Old candles silently disappear
- Indicator calculations fail or produce wrong values
- Gap detection triggers unnecessary REST calls
- System appears to work but data integrity compromised

**Warning signs:**
- Redis INFO shows evicted_keys > 0
- Candle count decreases over time
- Oldest candle timestamp keeps moving forward
- Memory usage at or near maxmemory limit

**Prevention:**
1. Set explicit TTL on candles (e.g., 7 days for 1m, 30 days for 1d)
2. Use maxmemory-policy noeviction and monitor memory
3. Alert when Redis memory exceeds 80% of limit
4. Size Redis instance for expected data volume (calculate: symbols x timeframes x candles x bytes)

**Memory sizing calculation:**
```
Per candle: ~200 bytes (JSON with OHLCV + metadata)
Per symbol/timeframe: 60 candles x 200 bytes = 12KB
Total: 25 symbols x 6 timeframes x 12KB = 1.8MB
With 7-day 1m history: 25 x 10080 x 200 = 50MB for 1m alone
Add buffer: Plan for 100-200MB Redis
```

**Recommended phase:** Phase 1 (Cache Layer) - Set memory policies and monitoring early.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable without major rework.

---

### Pitfall 9: Symbol Format Inconsistency

**What goes wrong:** Different parts of system use different symbol formats (BTC-USD vs BTCUSD vs BTC/USD), causing cache misses or duplicate entries.

**Why it happens:**
- Exchange APIs use different formats (Coinbase: BTC-USD, Binance: BTCUSDT)
- No normalization layer
- Copy-paste from different sources

**Consequences:**
- Same data stored multiple times under different keys
- Cache misses when format doesn't match
- Confusing logs and debugging
- Breaks when adding second exchange

**Prevention:**
1. Define canonical symbol format early (recommend: BASE-QUOTE, e.g., BTC-USD)
2. Normalize at exchange adapter boundary (adapter responsibility)
3. Validate symbol format in cache key construction
4. Add symbol normalization utility function

**Recommended phase:** Phase 1 (Exchange Adapter) - Normalize in adapter, consistent everywhere.

---

### Pitfall 10: Log Spam During Normal Operation

**What goes wrong:** Debug-level logging (every tick, every candle, every cache operation) left enabled in production, filling disks and making it hard to find real issues.

**Why it happens:**
- Logging added during development, never removed
- No log level configuration
- Async logging buffer fills, causing backpressure

**Consequences:**
- Disk fills up, system crashes
- Performance degradation from I/O
- Real errors buried in noise
- Log aggregation costs increase

**Prevention:**
1. Use log levels appropriately (DEBUG for development, INFO for production)
2. Rate-limit repetitive logs (log every Nth occurrence or every N seconds)
3. Configure log rotation
4. Separate logs by service for easier debugging

**Recommended phase:** All phases - Review logging at end of each phase.

---

### Pitfall 11: Hardcoded Exchange-Specific Logic

**What goes wrong:** Coinbase-specific assumptions (rate limits, message formats, channel names) scattered throughout codebase, making it hard to add Binance adapter.

**Why it happens:**
- "Just get it working" mentality
- No multi-exchange requirements initially
- Coinbase patterns assumed universal

**Consequences:**
- Adding Binance requires touching many files
- Risk of breaking Coinbase when adding Binance
- Duplicated logic with slight variations
- Inconsistent error handling across exchanges

**Prevention:**
1. Define exchange adapter interface early
2. Abstract exchange-specific constants (rate limits, channel names) into adapter
3. Use dependency injection for exchange services
4. Test adapter interface compliance, not just functionality

**Recommended phase:** Phase 1 (Exchange Adapter) - Core purpose of adapter pattern.

---

## Data Accuracy Pitfalls

How indicator calculations can go wrong during refactor.

---

### Pitfall 12: Losing Existing Functionality During Refactor

**What goes wrong:** While refactoring to cache-first architecture, MACD calculations that currently work stop working due to incomplete migration.

**Why it happens:**
- Removing REST calls before cache population is reliable
- Changing data flow breaks existing event chain
- "Big bang" migration instead of incremental
- Insufficient testing of existing functionality

**Consequences:**
- Alerts stop firing
- Users see "no data" where they previously had data
- Loss of trust in system
- Pressure to rollback, losing refactor progress

**Warning signs:**
- Indicator values go to null/undefined after code change
- Alert frequency drops significantly
- Logs show "no candles found" errors

**Prevention:**
1. Incremental migration: add cache writes first, verify data flowing, then switch reads
2. Run old and new paths in parallel, compare outputs
3. Feature flags to switch between REST and cache reads
4. Maintain comprehensive test coverage for MACD calculations
5. Monitor indicator value distribution (sudden change = problem)

**Incremental migration pattern:**
```typescript
// Step 1: Add cache writes alongside existing REST reads
async function recalculateIndicator(symbol: string, timeframe: string) {
  const candles = await this.fetchFromREST(symbol, timeframe); // Keep working
  await this.cache.writeCandles(candles); // Add cache population
  return this.calculate(candles);
}

// Step 2 (after verifying cache is populated): Switch to cache reads
async function recalculateIndicator(symbol: string, timeframe: string) {
  const candles = await this.cache.getCandles(symbol, timeframe);
  if (candles.length < 60) {
    // Fallback to REST if cache insufficient
    const restCandles = await this.fetchFromREST(symbol, timeframe);
    return this.calculate(restCandles);
  }
  return this.calculate(candles);
}

// Step 3 (after validating cache-first is reliable): Remove REST fallback
```

**Recommended phase:** All phases - Constraint throughout refactor.

---

### Pitfall 13: Indicator Value Drift Over Time

**What goes wrong:** Indicator values slowly diverge from exchange chart values over extended operation, even though individual candles are correct.

**Why it happens:**
- Small floating-point precision differences accumulate
- One missed candle propagates through exponential calculations
- Different EMA initialization than exchange uses
- Timestamp drift causing different candle alignment

**Consequences:**
- MACD crossover signals fire at different times than expected
- Backtest doesn't match forward test
- User compares to TradingView, sees different values

**Warning signs:**
- Indicator values "close but not exact" to exchange
- Difference grows over time
- Resetting/recalculating fixes the issue temporarily

**Prevention:**
1. Periodic full recalculation from REST (not incremental updates)
2. Log indicator values and compare to external source periodically
3. Use consistent initialization period (e.g., always start EMA from 60 candles ago)
4. Document expected precision (e.g., within 0.1% of exchange values)

**Recommended phase:** Phase 2 (Reconciliation) - Add periodic validation job.

---

### Pitfall 14: Different OHLCV Between In-Progress and Closed Candles

**What goes wrong:** System emits indicator updates based on in-progress candle data, then values change when candle closes. User sees indicator "jump" at close.

**Why it happens:**
- WebSocket updates stream during candle formation
- Indicator calculated on every update, not just on close
- No distinction between "preliminary" and "final" values

**Consequences:**
- Alert fires on in-progress value, then condition no longer true at close
- User sees false signals
- Confusion about what value to trust

**Warning signs:**
- Indicator values change exactly at minute boundaries
- Alerts fire then "disappear" (condition no longer met)

**Prevention:**
1. Only emit final indicator values on candle close events
2. If streaming updates needed, clearly label as "live" vs "closed"
3. Alert evaluation should only use closed candle indicator values
4. Add "candle_status" field: IN_PROGRESS or CLOSED

**Recommended phase:** Phase 3 (Indicator Service) - Ensure indicator events only on closed candles.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Exchange Adapter | Silent disconnections, rate limiting | Watchdog timer, staggered backfill |
| Cache Layer | Race conditions, eviction | Versioned writes, TTL policy |
| Indicator Service | Incomplete data, in-progress candles | Readiness checks, closed-only events |
| Reconciliation | Gap detection miss, over-reconciliation | Sequence validation, adaptive scheduling |
| Migration | Breaking existing MACDV | Incremental migration, parallel paths |

---

## Summary: Top 5 Pitfalls by Severity

1. **Silent WebSocket Disconnections** - Data goes stale without errors
2. **Cache-REST Data Mismatch** - Wrong indicator values, user trust loss
3. **Race Conditions in Cache Updates** - Intermittent, hard-to-debug corruption
4. **Reconnection Without State Recovery** - Gaps propagate through calculations
5. **Losing Functionality During Refactor** - Regression breaks existing features

---

## Sources

### WebSocket Handling
- [CCXWS - WebSocket client for 38 cryptocurrency exchanges](https://github.com/altangent/ccxws)
- [Coinbase Exchange WebSocket Best Practices](https://docs.cdp.coinbase.com/exchange/websocket-feed/best-practices)
- [Binance WebSocket Limits](https://academy.binance.com/en/articles/what-are-binance-websocket-limits)
- [Binance Developer Community - Data stream reconnects](https://dev.binance.vision/t/how-to-avoid-losing-data-across-user-data-stream-disconnect-reconnects/12354)

### Cache Consistency
- [Redis - Three Ways to Maintain Cache Consistency](https://redis.io/blog/three-ways-to-maintain-cache-consistency/)
- [AWS - Database Caching Strategies Using Redis](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html)
- [Redis - Write-Through Caching](https://redis.io/learn/howtos/solutions/caching-architecture/write-through)

### OHLCV Data Handling
- [CoinAPI - OHLCV Data Explained](https://www.coinapi.io/blog/ohlcv-data-explained-real-time-updates-websocket-behavior-and-trading-applications)
- [CoinAPI - Why Real-Time Crypto Data Is Harder Than It Looks](https://www.coinapi.io/blog/why-real-time-crypto-data-is-harder-than-it-looks)
- [Freqtrade - Data Downloading Documentation](https://www.freqtrade.io/en/2023.1/data-download/)

### Event-Driven Architecture
- [Event-Driven.io - Dealing with Race Conditions in EDA](https://event-driven.io/en/dealing_with_race_conditions_in_eda_using_read_models/)
- [AlgoCademy - Why Your EDA Is Causing Race Conditions](https://algocademy.com/blog/why-your-event-driven-architecture-is-causing-race-conditions-and-how-to-fix-it/)

### Migration & Architecture
- [Token Metrics - REST vs WebSocket Crypto API Comparison 2025](https://www.tokenmetrics.com/blog/crypto-api-bot-rest-vs-websockets)
- [CoinAPI - Why WebSocket Multiple Updates Beat REST APIs](https://www.coinapi.io/blog/why-websocket-multiple-updates-beat-rest-apis-for-real-time-crypto-trading)
- [TimescaleDB - Hierarchical Continuous Aggregates](https://github.com/timescale/timescaledb/issues/5171)

---

*Researched: 2026-01-19 | Confidence: HIGH (verified with official documentation and community sources)*
