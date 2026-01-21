# Phase 06: Indicator Refactor - Research

**Researched:** 2026-01-21
**Domain:** Event-driven indicator calculation, Redis pub/sub, candle aggregation
**Confidence:** HIGH

## Summary

This phase transforms the indicator calculation service from a REST-dependent, timer-based system to a fully event-driven, cache-first architecture. The current `IndicatorCalculationService` uses REST API calls for both initial warmup and incremental updates, which causes 429 rate limiting errors during high-frequency operation.

The transformation requires three key changes: (1) subscribe to Redis `candle:close` events instead of using WebSocket callback wiring, (2) read candle data exclusively from cache (no REST calls in the hot path), and (3) aggregate higher timeframes (15m, 1h, 4h, 1d) from cached 5m candles instead of fetching them separately.

**Primary recommendation:** Refactor `IndicatorCalculationService` to use Redis `psubscribe` for candle:close events, implement cache-only candle reads, add 60-candle readiness gates, and build timeframe aggregation logic in `@livermore/utils`.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | ^5.x | Redis pub/sub subscription | Already in codebase, supports psubscribe patterns |
| @livermore/cache | local | Cache reads via CandleCacheStrategy | Existing `getRecentCandles()` method |
| @livermore/indicators | local | MACD-V calculation | Already implemented with informativeATR |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @livermore/utils | local | `timeframeToMs`, `getCandleTimestamp` | Timeframe aggregation logic |
| @livermore/schemas | local | `Candle`, `Timeframe` types | Type safety for aggregation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| psubscribe patterns | Individual subscribe per channel | Patterns are more flexible; individual is more explicit but scales poorly with many symbols |
| In-memory aggregation | TimescaleDB continuous aggregates | DB aggregates are persistent but add latency; in-memory is faster for real-time |

**Installation:**
No new dependencies required - all libraries already in codebase.

## Architecture Patterns

### Recommended Project Structure
```
apps/api/src/services/
  indicator-calculation.service.ts   # Refactor existing file
packages/utils/src/
  candle/
    candle-utils.ts                  # Add aggregateCandles() function
    index.ts                         # Re-export
```

### Pattern 1: Redis Pattern Subscribe (psubscribe)
**What:** Subscribe to multiple channels matching a glob pattern instead of individual channels
**When to use:** When monitoring events from many symbol/timeframe combinations
**Example:**
```typescript
// Source: https://redis.io/docs/latest/commands/psubscribe/
// ioredis documentation

// Create dedicated subscriber connection (required for pub/sub mode)
const subscriber = redis.duplicate();

// Subscribe to all 5m candle:close events for all symbols
// Pattern: channel:candle:close:1:1:*:5m
const pattern = `channel:candle:close:${userId}:${exchangeId}:*:5m`;
await subscriber.psubscribe(pattern);

// Listen for pattern messages (different event name from subscribe)
subscriber.on('pmessage', (pattern, channel, message) => {
  // Extract symbol from channel name
  // channel = "channel:candle:close:1:1:BTC-USD:5m"
  const parts = channel.split(':');
  const symbol = parts[4];
  const candle = JSON.parse(message);

  handleCandleClose(symbol, candle);
});
```

### Pattern 2: Candle Aggregation (5m to Higher Timeframes)
**What:** Build 15m/1h/4h/1d candles from cached 5m candles
**When to use:** When exchange only provides 5m via WebSocket but you need higher timeframes
**Example:**
```typescript
// Source: Standard OHLC aggregation rules
// https://atekihcan.com/blog/codeortrading/changing-timeframe-of-ohlc-candlestick-data-in-pandas/

/**
 * Aggregate smaller timeframe candles into larger timeframe
 *
 * @param candles - Source candles (must be sorted by timestamp ascending)
 * @param sourceTimeframe - Timeframe of input candles (e.g., '5m')
 * @param targetTimeframe - Timeframe to aggregate to (e.g., '1h')
 * @returns Aggregated candles at target timeframe
 */
function aggregateCandles(
  candles: Candle[],
  sourceTimeframe: Timeframe,
  targetTimeframe: Timeframe
): Candle[] {
  const sourceMs = timeframeToMs(sourceTimeframe);
  const targetMs = timeframeToMs(targetTimeframe);

  // Ensure target is larger than source
  if (targetMs <= sourceMs) {
    throw new Error(`Target timeframe must be larger than source`);
  }

  // Group candles by target timeframe boundary
  const groups = new Map<number, Candle[]>();

  for (const candle of candles) {
    const boundary = getCandleTimestamp(candle.timestamp, targetTimeframe);
    const existing = groups.get(boundary) || [];
    existing.push(candle);
    groups.set(boundary, existing);
  }

  // Aggregate each group
  const result: Candle[] = [];

  for (const [timestamp, group] of groups) {
    // Sort by timestamp to ensure correct order
    group.sort((a, b) => a.timestamp - b.timestamp);

    result.push({
      timestamp,
      open: group[0].open,                    // First candle's open
      high: Math.max(...group.map(c => c.high)), // Maximum high
      low: Math.min(...group.map(c => c.low)),   // Minimum low
      close: group[group.length - 1].close,   // Last candle's close
      volume: group.reduce((sum, c) => sum + c.volume, 0), // Sum of volumes
      symbol: candles[0].symbol,
      timeframe: targetTimeframe,
      isSynthetic: group.some(c => c.isSynthetic), // Synthetic if any input was
    });
  }

  return result.sort((a, b) => a.timestamp - b.timestamp);
}
```

### Pattern 3: Readiness Gate
**What:** Skip indicator calculation if insufficient candles available
**When to use:** Prevent incorrect indicator values on startup or after cache expiry
**Example:**
```typescript
const REQUIRED_CANDLES = 60; // Project requirement for MACD-V accuracy

async function onCandleClose(symbol: string, candle: UnifiedCandle): Promise<void> {
  // Read from cache only - no REST API calls
  const candles = await candleCache.getRecentCandles(
    userId, exchangeId, symbol, '5m', REQUIRED_CANDLES
  );

  // Readiness gate
  if (candles.length < REQUIRED_CANDLES) {
    logger.debug({
      symbol,
      available: candles.length,
      required: REQUIRED_CANDLES
    }, 'Skipping indicator calculation - insufficient candles');
    return;
  }

  // Calculate indicators
  await calculateIndicators(symbol, '5m', candles);
}
```

### Anti-Patterns to Avoid
- **REST API in hot path:** Never call REST API during candle:close event handling. Cache is single source of truth.
- **Timer-based polling:** Remove any setInterval/setTimeout that triggers recalculation. Use events only.
- **Individual subscribe per symbol:** Use psubscribe patterns instead of subscribing to each symbol separately.
- **Blocking aggregation:** Don't block the event handler with synchronous aggregation of large datasets.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timeframe boundary calculation | Custom modulo math | `getCandleTimestamp()` from @livermore/utils | Already handles all timeframes correctly |
| Gap filling | Manual timestamp iteration | `fillCandleGaps()` from @livermore/utils | Handles synthetic candle creation properly |
| MACD-V minimum bars | Hardcoded constant | `macdVMinBars()` from @livermore/indicators | Calculates based on actual EMA/ATR periods |
| Redis pattern subscription | Custom channel management | ioredis `psubscribe()` built-in | Native support for glob patterns |

**Key insight:** The codebase already has utilities for time handling and cache operations. The aggregation logic is the only new code needed.

## Common Pitfalls

### Pitfall 1: Duplicate Subscriber Connection
**What goes wrong:** Using main Redis client for psubscribe, blocking all other Redis operations
**Why it happens:** ioredis (like all Redis clients) enters "subscriber mode" when psubscribe is called - no other commands work on that connection
**How to avoid:** Create dedicated subscriber with `redis.duplicate()`
**Warning signs:** Other Redis operations hang or timeout after starting subscription

### Pitfall 2: Aggregation Boundary Alignment
**What goes wrong:** Higher timeframe candles don't match exchange/TradingView data
**Why it happens:** Using incorrect boundary calculation (e.g., starting 15m candles at :03 instead of :00/:15/:30/:45)
**How to avoid:** Use `getCandleTimestamp()` which floors to timeframe boundary correctly
**Warning signs:** 15m OHLC values differ from TradingView by one 5m candle

### Pitfall 3: Incomplete Candle Aggregation
**What goes wrong:** Higher timeframe candle missing data because not all source candles arrived
**Why it happens:** Aggregating immediately when first candle of new period arrives, before period completes
**How to avoid:** Only aggregate COMPLETED candles (when candle:close fires, that candle is complete)
**Warning signs:** 1h candle shows only 6 of 12 expected 5m candles' data

### Pitfall 4: Event Handler Memory Leak
**What goes wrong:** Memory grows unbounded, eventual crash
**Why it happens:** Not removing event listeners on service stop, or accumulating state
**How to avoid:** Call `subscriber.punsubscribe()` and `subscriber.quit()` in stop(), clear any Maps
**Warning signs:** Memory usage grows linearly with uptime

### Pitfall 5: Race Condition on Startup
**What goes wrong:** candle:close event arrives before cache is populated, indicator calculation fails
**Why it happens:** Subscribing to events before warmup completes
**How to avoid:** Subscribe to candle:close AFTER warmup backfill completes (Phase 07 handles warmup)
**Warning signs:** "Insufficient candles" errors immediately after startup

### Pitfall 6: Wrong Candle Count for Requirement
**What goes wrong:** Using 35 (macdVMinBars) instead of 60 as readiness threshold
**Why it happens:** macdVMinBars() returns mathematical minimum, but project requires 60 for TradingView alignment
**How to avoid:** Use explicit 60-candle constant as per IND-03 requirement
**Warning signs:** Indicator values differ from TradingView on symbols with 35-60 candles of history

## Code Examples

Verified patterns from official sources:

### Redis psubscribe with ioredis
```typescript
// Source: ioredis README and Redis PSUBSCRIBE docs
// https://redis.io/docs/latest/commands/psubscribe/

import Redis from 'ioredis';

class IndicatorCalculationService {
  private subscriber: Redis | null = null;

  async start(): Promise<void> {
    // Duplicate creates new connection with same config
    this.subscriber = this.redis.duplicate();

    // Pattern for all symbols, 5m timeframe
    const pattern = candleClosePattern(this.userId, this.exchangeId, '*', '5m');
    await this.subscriber.psubscribe(pattern);

    // pmessage event (not message) for pattern subscriptions
    this.subscriber.on('pmessage', this.handleCandleClose.bind(this));
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.punsubscribe();
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }

  private async handleCandleClose(
    pattern: string,
    channel: string,
    message: string
  ): Promise<void> {
    const candle = JSON.parse(message) as UnifiedCandle;
    // ... process candle
  }
}
```

### Timeframe Aggregation Lookup
```typescript
// Number of source candles per target candle
const AGGREGATION_FACTORS: Record<Timeframe, number> = {
  '15m': 3,   // 3 x 5m = 15m
  '1h': 12,   // 12 x 5m = 1h
  '4h': 48,   // 48 x 5m = 4h
  '1d': 288,  // 288 x 5m = 1d (24 * 12)
};

// Validate aggregation is possible
function canAggregate(source: Timeframe, target: Timeframe): boolean {
  return timeframeToMs(target) % timeframeToMs(source) === 0;
}
```

### Cache-Only Candle Read
```typescript
// Source: Existing CandleCacheStrategy in @livermore/cache

async function getAggregatedCandles(
  symbol: string,
  targetTimeframe: Timeframe,
  requiredCount: number
): Promise<Candle[]> {
  // Calculate how many 5m candles we need
  const factor = timeframeToMs(targetTimeframe) / timeframeToMs('5m');
  const sourceCount = requiredCount * factor;

  // Read from cache only
  const sourceCandles = await this.candleCache.getRecentCandles(
    this.userId,
    this.exchangeId,
    symbol,
    '5m',
    sourceCount
  );

  // Aggregate to target timeframe
  return aggregateCandles(sourceCandles, '5m', targetTimeframe);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Timer-based recalculation | Event-driven (candle:close) | This phase | Eliminates unnecessary REST calls |
| REST fetch on every event | Cache-only reads | This phase | Zero REST calls in hot path |
| Fetch each timeframe separately | Aggregate from 5m | This phase | Single source of truth |
| macdVMinBars() threshold | 60-candle requirement | This phase | TradingView alignment |

**Deprecated/outdated:**
- `fetchRecentCandles()` method calling REST API during recalculation - replace with cache reads
- `checkHigherTimeframes()` calling REST for each timeframe - replace with aggregation
- Direct WebSocket callback wiring (`coinbaseWsService.onCandleClose`) - replace with Redis pub/sub

## Open Questions

Things that couldn't be fully resolved:

1. **1m timeframe handling**
   - What we know: Coinbase WebSocket sends 5m candles natively; 1m candles come from ticker aggregation in CoinbaseWebSocketService
   - What's unclear: Should indicator service also subscribe to 1m candle:close events from ticker aggregation, or only 5m from native channel?
   - Recommendation: For Phase 06, focus on 5m as source. 1m indicator calculation can be added later if needed.

2. **Multiple exchange support**
   - What we know: UnifiedCandle has `exchange` field, but current code hardcodes userId=1, exchangeId=1
   - What's unclear: Should psubscribe pattern include exchange wildcard?
   - Recommendation: Keep hardcoded IDs for now (single exchange), plan for multi-exchange in future phase.

3. **Backfill coordination with Phase 07**
   - What we know: Phase 07 handles startup backfill, Phase 06 assumes cache is populated
   - What's unclear: What happens if cache has stale data or gaps?
   - Recommendation: Phase 06 adds readiness gates; Phase 08 (Reconciliation) handles gap detection. Accept some startup delay.

## Sources

### Primary (HIGH confidence)
- Redis PSUBSCRIBE documentation: https://redis.io/docs/latest/commands/psubscribe/ - Pattern syntax and behavior
- Existing codebase files (verified patterns):
  - `packages/cache/src/keys.ts` - `candleCloseChannel()` function
  - `packages/cache/src/strategies/candle-cache.ts` - `getRecentCandles()` method
  - `apps/api/src/services/indicator-calculation.service.ts` - Current implementation to refactor
  - `apps/api/src/services/alert-evaluation.service.ts` - Working example of Redis subscribe pattern

### Secondary (MEDIUM confidence)
- ioredis README: https://github.com/redis/ioredis - psubscribe usage patterns
- OHLC aggregation patterns: https://atekihcan.com/blog/codeortrading/changing-timeframe-of-ohlc-candlestick-data-in-pandas/ - Standard aggregation rules

### Tertiary (LOW confidence)
- None - all patterns verified against official sources or existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in codebase, patterns verified
- Architecture: HIGH - Based on existing AlertEvaluationService subscribe pattern
- Pitfalls: HIGH - Derived from ioredis documentation and Redis official docs
- Aggregation logic: MEDIUM - Standard OHLC rules, but untested in this codebase

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (30 days - stable domain, no rapidly changing dependencies)
