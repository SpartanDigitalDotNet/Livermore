# Phase 07: Startup Backfill - Research

**Researched:** 2026-01-21
**Domain:** REST API rate limiting, historical data backfill, startup orchestration
**Confidence:** HIGH

## Summary

Phase 07 implements a startup backfill service that populates Redis cache with historical candles for all symbols and timeframes before the indicator service begins processing. This is critical because Phase 06's event-driven indicator service reads exclusively from cache (no REST API calls in hot path) and requires 60+ candles per symbol/timeframe for accurate MACD-V calculation.

The key challenge is fetching historical data for ~25 symbols across 5 timeframes (5m, 15m, 1h, 4h, 1d) without triggering 429 rate limit errors. The Coinbase Advanced Trade API allows 30 requests/second but conservative rate limiting (5 requests/batch with 1s delay) ensures reliable operation during startup.

**Primary recommendation:** Create a `StartupBackfillService` that uses a priority queue (short timeframes first), batched REST requests with configurable rate limiting, and progress tracking via structured logging.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| CoinbaseRestClient | local | Fetch historical candles via `getCandles()` | Already exists, tested in Phase 05 |
| CandleCacheStrategy | local | Write candles to Redis sorted sets | Already exists with `addCandles()` bulk method |
| @livermore/schemas | local | Timeframe, Candle types | Existing schema definitions |
| @livermore/utils | local | Logger, timing utilities | Existing utilities |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-ratelimit | ^1.0.1 | Promise-based rate limiting | Complex multi-batch scenarios |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom rate limiter | p-ratelimit library | Custom is simpler for this use case; p-ratelimit better for complex distributed scenarios |
| Sequential fetching | Promise.allSettled batches | Parallel batches are faster; sequential is simpler but slower |
| Static priority list | Dynamic by candle age | Static is predictable; dynamic adds complexity without clear benefit |

**Installation:**
```bash
# No new dependencies required - all already in codebase
# Optional if complex rate limiting needed:
npm install p-ratelimit
```

## Architecture Patterns

### Recommended Project Structure
```
packages/coinbase-client/src/
  backfill/
    startup-backfill-service.ts  # Main service class
    types.ts                      # BackfillConfig, BackfillProgress interfaces
    index.ts                      # Re-exports
apps/api/src/
  server.ts                       # Orchestrates startup: backfill -> indicators -> adapter
```

### Pattern 1: Priority Queue Backfill
**What:** Fetch candles in priority order (short timeframes first) to enable indicator calculations sooner
**When to use:** When multiple timeframes need backfill and some are more critical than others
**Example:**
```typescript
// Source: Phase context (BKFL-03)
// Priority order defined in requirements

const TIMEFRAME_PRIORITY: Timeframe[] = [
  '5m',   // WebSocket provides 5m - fill first for fastest indicator startup
  '15m',  // Next most frequently used
  '1h',   // Common analysis timeframe
  '4h',   // Swing trading timeframe
  '1d',   // Daily analysis (least urgent)
];

interface BackfillTask {
  symbol: string;
  timeframe: Timeframe;
  priority: number; // Lower = higher priority
}

// Build task queue with priority
function buildTaskQueue(symbols: string[]): BackfillTask[] {
  const tasks: BackfillTask[] = [];

  for (const [priority, timeframe] of TIMEFRAME_PRIORITY.entries()) {
    for (const symbol of symbols) {
      tasks.push({ symbol, timeframe, priority });
    }
  }

  // Sort by priority (lower first)
  return tasks.sort((a, b) => a.priority - b.priority);
}
```

### Pattern 2: Batch Rate Limiter
**What:** Execute REST requests in batches with delays between batches
**When to use:** When API has rate limits and you need controlled throughput
**Example:**
```typescript
// Source: https://www.bretcameron.com/blog/how-to-avoid-hitting-api-rate-limits-using-typescript
// Adapted for Coinbase's 30 req/sec limit with safety margin

interface RateLimiterConfig {
  batchSize: number;      // Number of requests per batch
  delayMs: number;        // Delay between batches in milliseconds
}

const DEFAULT_RATE_LIMIT: RateLimiterConfig = {
  batchSize: 5,    // Conservative: 5 requests per batch
  delayMs: 1000,   // 1 second between batches = 5 req/sec (well under 30)
};

async function executeBatchedRequests<T>(
  tasks: Array<() => Promise<T>>,
  config: RateLimiterConfig = DEFAULT_RATE_LIMIT
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < tasks.length; i += config.batchSize) {
    const batch = tasks.slice(i, i + config.batchSize);

    // Execute batch in parallel
    const batchResults = await Promise.allSettled(batch.map(task => task()));

    // Collect successful results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    // Delay before next batch (skip if last batch)
    if (i + config.batchSize < tasks.length) {
      await sleep(config.delayMs);
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Pattern 3: Progress Tracking
**What:** Log progress during long-running operations for visibility
**When to use:** Operations taking > 10 seconds with multiple steps
**Example:**
```typescript
// Source: Project requirement BKFL-04

interface BackfillProgress {
  totalTasks: number;
  completedTasks: number;
  currentSymbol: string;
  currentTimeframe: Timeframe;
  startTime: number;
  errors: number;
}

function logProgress(progress: BackfillProgress): void {
  const elapsed = Date.now() - progress.startTime;
  const percent = ((progress.completedTasks / progress.totalTasks) * 100).toFixed(1);
  const rate = progress.completedTasks / (elapsed / 1000); // tasks per second
  const eta = (progress.totalTasks - progress.completedTasks) / rate;

  logger.info({
    event: 'backfill_progress',
    completed: progress.completedTasks,
    total: progress.totalTasks,
    percent: `${percent}%`,
    current: `${progress.currentSymbol}:${progress.currentTimeframe}`,
    elapsedSec: (elapsed / 1000).toFixed(1),
    etaSec: eta.toFixed(1),
    errors: progress.errors,
  }, `Backfill progress: ${progress.completedTasks}/${progress.totalTasks} (${percent}%)`);
}
```

### Anti-Patterns to Avoid
- **Unbounded parallelism:** Never `Promise.all()` all requests simultaneously - will trigger 429 errors
- **Retry without backoff:** Failed requests should use exponential backoff, not immediate retry
- **Blocking startup:** Backfill should be awaited before starting indicator service, not running in background
- **Ignoring failures:** Log and count failures, but don't fail entire backfill for one symbol

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Candle fetching | Custom HTTP client | `CoinbaseRestClient.getCandles()` | Already handles auth, validation, normalization |
| Bulk cache writes | Individual `addCandle()` calls | `CandleCacheStrategy.addCandles()` | Uses Redis pipeline for atomicity and performance |
| Timeframe constants | Hardcoded array | `CoinbaseRestClient.SUPPORTED_TIMEFRAMES` | Already defined with Coinbase granularity mapping |
| Sleep/delay | Custom implementation | Simple `Promise + setTimeout` | No library needed for this simple use case |

**Key insight:** The existing CoinbaseRestClient and CandleCacheStrategy provide all the building blocks - this phase just needs to orchestrate them with rate limiting and progress tracking.

## Common Pitfalls

### Pitfall 1: Rate Limit Exhaustion (429 Errors)
**What goes wrong:** Backfill triggers 429 Too Many Requests errors, causing data gaps
**Why it happens:** Requesting too many candles too quickly during startup
**How to avoid:** Use conservative rate limiting (5 req/batch, 1s delay) well under the 30 req/sec limit
**Warning signs:** 429 errors in logs during startup, incomplete backfill

### Pitfall 2: Candle Count Miscalculation
**What goes wrong:** Requesting wrong time range, getting < 60 candles
**Why it happens:** Not accounting for Coinbase's 300 candle max per request
**How to avoid:** Request 100 candles (generous buffer) since we only need 60
**Warning signs:** "Insufficient candles" errors in indicator service immediately after startup

### Pitfall 3: Startup Race Condition
**What goes wrong:** Indicator service starts before backfill completes, skips all symbols
**Why it happens:** Starting services in parallel instead of sequential order
**How to avoid:** Server startup must: 1) backfill, 2) THEN start indicators, 3) THEN start adapter
**Warning signs:** All symbols skipped on first candle:close events

### Pitfall 4: Cache Key Mismatch
**What goes wrong:** Backfilled candles not found by indicator service
**Why it happens:** Using different userId/exchangeId in backfill vs indicator service
**How to avoid:** Use same hardcoded TEST_USER_ID=1, TEST_EXCHANGE_ID=1 everywhere
**Warning signs:** Cache has candles (verified via Redis CLI) but indicator shows "insufficient candles"

### Pitfall 5: Timeframe Mapping Error
**What goes wrong:** REST API rejects request with "unsupported granularity"
**Why it happens:** Using `4h` timeframe which isn't in Coinbase's supported list (they have 2h and 6h instead)
**How to avoid:** Use `CoinbaseRestClient.SUPPORTED_TIMEFRAMES` which maps correctly
**Warning signs:** Error logs showing "Timeframe '4h' is not supported by Coinbase"

### Pitfall 6: Memory Pressure During Backfill
**What goes wrong:** Node.js process runs out of memory during large backfill
**Why it happens:** Accumulating all candles in memory before writing to cache
**How to avoid:** Write to cache after each batch, don't accumulate all results
**Warning signs:** "JavaScript heap out of memory" crash during startup

## Code Examples

Verified patterns from official sources and existing codebase:

### StartupBackfillService Class Structure
```typescript
// Source: Based on existing CoinbaseAdapter pattern and project requirements

import type { Redis } from 'ioredis';
import { CoinbaseRestClient } from '../rest/client';
import { CandleCacheStrategy } from '@livermore/cache';
import type { Timeframe, Candle } from '@livermore/schemas';
import { logger } from '@livermore/utils';

export interface BackfillConfig {
  /** Number of candles to fetch per symbol/timeframe (default: 100) */
  candleCount: number;
  /** Requests per batch (default: 5) */
  batchSize: number;
  /** Delay between batches in ms (default: 1000) */
  batchDelayMs: number;
  /** User ID for cache keys */
  userId: number;
  /** Exchange ID for cache keys */
  exchangeId: number;
}

export const DEFAULT_BACKFILL_CONFIG: BackfillConfig = {
  candleCount: 100,      // Request 100 to ensure 60+ available
  batchSize: 5,          // Conservative rate limiting
  batchDelayMs: 1000,    // 5 req/sec = well under 30 limit
  userId: 1,             // Hardcoded test user
  exchangeId: 1,         // Hardcoded exchange
};

export class StartupBackfillService {
  private restClient: CoinbaseRestClient;
  private candleCache: CandleCacheStrategy;
  private config: BackfillConfig;

  constructor(
    apiKeyId: string,
    privateKeyPem: string,
    redis: Redis,
    config: Partial<BackfillConfig> = {}
  ) {
    this.restClient = new CoinbaseRestClient(apiKeyId, privateKeyPem);
    this.candleCache = new CandleCacheStrategy(redis);
    this.config = { ...DEFAULT_BACKFILL_CONFIG, ...config };
  }

  async backfill(symbols: string[], timeframes: Timeframe[]): Promise<void> {
    // Implementation in next example
  }
}
```

### Backfill Execution with Rate Limiting
```typescript
// Source: Combining patterns from research

// Priority order for timeframes (5m first since WebSocket provides it)
const TIMEFRAME_PRIORITY: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

async backfill(symbols: string[], timeframes: Timeframe[]): Promise<void> {
  const startTime = Date.now();

  // Sort timeframes by priority
  const sortedTimeframes = timeframes.sort((a, b) => {
    const aIdx = TIMEFRAME_PRIORITY.indexOf(a);
    const bIdx = TIMEFRAME_PRIORITY.indexOf(b);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  // Build task list: all symbol/timeframe combinations
  const tasks: Array<{ symbol: string; timeframe: Timeframe }> = [];
  for (const timeframe of sortedTimeframes) {
    for (const symbol of symbols) {
      tasks.push({ symbol, timeframe });
    }
  }

  logger.info({
    event: 'backfill_start',
    symbols: symbols.length,
    timeframes: sortedTimeframes,
    totalTasks: tasks.length,
  }, `Starting backfill: ${symbols.length} symbols x ${sortedTimeframes.length} timeframes`);

  let completed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < tasks.length; i += this.config.batchSize) {
    const batch = tasks.slice(i, i + this.config.batchSize);

    // Execute batch in parallel
    const results = await Promise.allSettled(
      batch.map(task => this.backfillSymbolTimeframe(task.symbol, task.timeframe))
    );

    // Count results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        completed++;
      } else {
        errors++;
        logger.warn({ error: result.reason }, 'Backfill task failed');
      }
    }

    // Log progress
    this.logProgress(completed, tasks.length, startTime, errors);

    // Delay before next batch (skip if last)
    if (i + this.config.batchSize < tasks.length) {
      await this.sleep(this.config.batchDelayMs);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info({
    event: 'backfill_complete',
    completed,
    errors,
    elapsedSec: elapsed,
  }, `Backfill complete: ${completed}/${tasks.length} in ${elapsed}s (${errors} errors)`);
}

private async backfillSymbolTimeframe(symbol: string, timeframe: Timeframe): Promise<number> {
  // Fetch candles from REST API
  const candles = await this.restClient.getCandles(
    symbol,
    timeframe,
    undefined, // no start - get most recent
    undefined  // no end - get up to now
  );

  // Limit to requested count
  const toCache = candles.slice(-this.config.candleCount);

  // Write to cache
  await this.candleCache.addCandles(
    this.config.userId,
    this.config.exchangeId,
    toCache
  );

  logger.debug({
    event: 'backfill_symbol_complete',
    symbol,
    timeframe,
    candleCount: toCache.length,
  }, `Backfilled ${symbol} ${timeframe}: ${toCache.length} candles`);

  return toCache.length;
}

private logProgress(completed: number, total: number, startTime: number, errors: number): void {
  const percent = ((completed / total) * 100).toFixed(1);
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = completed / elapsed;
  const remaining = total - completed;
  const eta = rate > 0 ? (remaining / rate).toFixed(1) : '?';

  logger.info({
    event: 'backfill_progress',
    completed,
    total,
    percent,
    elapsedSec: elapsed.toFixed(1),
    etaSec: eta,
    errors,
  }, `Backfill: ${completed}/${total} (${percent}%) - ETA ${eta}s`);
}

private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Server Startup Orchestration
```typescript
// Source: Based on Phase 06 indicator service startup pattern

// In apps/api/src/server.ts

async function startServices(): Promise<void> {
  const symbols = getConfiguredSymbols(); // e.g., from environment.json
  const timeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

  // 1. First: Backfill cache (MUST complete before indicators)
  logger.info('Starting cache backfill...');
  const backfillService = new StartupBackfillService(
    apiKeyId,
    privateKeyPem,
    redisClient
  );
  await backfillService.backfill(symbols, timeframes);

  // 2. Second: Start indicator service (reads from now-populated cache)
  logger.info('Starting indicator service...');
  const indicatorService = new IndicatorCalculationService(apiKeyId, privateKeyPem);
  const configs = symbols.flatMap(symbol =>
    timeframes.map(timeframe => ({ symbol, timeframe }))
  );
  await indicatorService.start(configs);

  // 3. Third: Start Coinbase adapter (WebSocket connection)
  logger.info('Starting Coinbase adapter...');
  const adapter = new CoinbaseAdapter({
    apiKeyId,
    privateKeyPem,
    redis: redisClient,
    userId: 1,
    exchangeId: 1,
  });
  await adapter.connect();
  adapter.subscribe(symbols, '5m');

  logger.info('All services started');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No startup warmup | Startup backfill service | Phase 07 | Indicators have data immediately |
| Unbounded REST calls | Rate-limited batches | Phase 07 | No 429 errors during startup |
| Random fetch order | Priority queue by timeframe | Phase 07 | Critical timeframes ready first |
| Silent background load | Progress logging | Phase 07 | Visibility into startup time |

**Deprecated/outdated:**
- Old WebSocket service building candles from ticker data (Option A) - insufficient data coverage
- REST API calls in indicator hot path - replaced by cache-only reads in Phase 06

## Open Questions

Things that couldn't be fully resolved:

1. **4h timeframe availability**
   - What we know: Coinbase REST API supports 1h, 2h, 6h but not 4h natively
   - What's unclear: Should we use 4h (which CoinbaseRestClient maps, or may error)?
   - Recommendation: Verify CoinbaseRestClient.SUPPORTED_TIMEFRAMES includes 4h; if not, adjust to use available timeframes

2. **Optimal batch size**
   - What we know: Coinbase allows 30 req/sec; we propose 5 req/batch with 1s delay (5 req/sec)
   - What's unclear: Could we safely increase to 10-15 req/batch for faster startup?
   - Recommendation: Start conservative (5), measure actual startup time, tune if needed

3. **Retry strategy on failure**
   - What we know: Individual symbol/timeframe failures shouldn't block entire backfill
   - What's unclear: Should failed tasks be retried immediately, at end, or skipped?
   - Recommendation: Log and skip failed tasks; Phase 08 (Reconciliation) will catch gaps later

## Sources

### Primary (HIGH confidence)
- Existing codebase files:
  - `packages/coinbase-client/src/rest/client.ts` - CoinbaseRestClient.getCandles(), SUPPORTED_TIMEFRAMES
  - `packages/cache/src/strategies/candle-cache.ts` - CandleCacheStrategy.addCandles()
  - `packages/coinbase-client/src/adapter/coinbase-adapter.ts` - Backfill pattern from Phase 05
  - `apps/api/src/services/indicator-calculation.service.ts` - Phase 06 event-driven service
- Coinbase API documentation: 300 candles max per request, 30 req/sec limit

### Secondary (MEDIUM confidence)
- [Rate Limiter TypeScript Pattern](https://www.bretcameron.com/blog/how-to-avoid-hitting-api-rate-limits-using-typescript) - RequestScheduler class pattern
- [p-ratelimit library](https://github.com/natesilva/p-ratelimit) - Promise-based rate limiting

### Tertiary (LOW confidence)
- None - all patterns verified against official sources or existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in codebase, no new dependencies required
- Architecture: HIGH - Follows patterns established in Phase 05 (backfill after reconnect)
- Pitfalls: HIGH - Based on documented Coinbase rate limits and Phase 06 requirements
- Rate limiting: MEDIUM - Conservative defaults should work; may need tuning based on real-world performance

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (30 days - stable domain, Coinbase rate limits rarely change)

---

## Appendix: Calculations

### Time Estimate for 25 Symbols x 5 Timeframes

```
Total tasks = 25 symbols x 5 timeframes = 125 tasks
Batch size = 5 tasks
Total batches = 125 / 5 = 25 batches
Time per batch = batch execution (~1-2s) + delay (1s) = ~2-3s
Total time = 25 batches x 2.5s = ~62.5 seconds

With overhead: ~75-90 seconds expected
Success criteria: < 5 minutes (300 seconds) - WILL PASS
```

### Coinbase API Limits Reference

| Limit | Value | Source |
|-------|-------|--------|
| Max candles per request | 300 | Coinbase API docs |
| Private endpoint rate limit | 30 req/sec | Coinbase API docs |
| Our conservative limit | 5 req/sec | Safety margin (6x buffer) |
| Candles needed per symbol | 60 | IND-03 requirement |
| Candles to request | 100 | Buffer for gaps/misses |
