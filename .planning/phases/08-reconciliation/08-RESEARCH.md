# Phase 08: Reconciliation - Research

**Researched:** 2026-01-21
**Domain:** Background job scheduling, time-series gap detection, data reconciliation
**Confidence:** HIGH

## Summary

Phase 08 implements background reconciliation jobs to detect and fill gaps in the cached candle data. The existing codebase already has the building blocks: `CandleCacheStrategy` for Redis sorted set operations, `CoinbaseRestClient` for REST backfill, and `timeframeToMs()` for timestamp calculations. The primary additions are node-cron for scheduling and a gap detection algorithm.

Gap detection is a pure application-level operation: retrieve candle timestamps from Redis sorted sets, compute expected timestamps based on timeframe intervals, and identify missing entries. This leverages existing `getCandlesInRange()` from `CandleCacheStrategy` and `getCandleTimestamps()` from `@livermore/utils`.

**Primary recommendation:** Use node-cron v4 with `noOverlap: true` for all scheduled jobs. Implement gap detection as a pure function that compares expected vs. actual timestamps. Reuse `StartupBackfillService` backfill logic for gap filling.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-cron | ^4.0.0 | Cron scheduling | Standard Node.js scheduler, TypeScript-native in v4, noOverlap option |
| ioredis | ^5.9.1 | Redis operations | Already in use across codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node-cron | N/A | Type definitions | NOT needed - v4 is TypeScript-native |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-cron | bull/bullmq | Overkill - adds Redis queue complexity for simple scheduled jobs |
| node-cron | node-schedule | Less popular, no noOverlap option |
| node-cron | cron (kelektiv) | Similar but node-cron has better TypeScript v4 support |
| Application-level gap detection | RedisTimeSeries | Adds module dependency, existing sorted sets sufficient |

**Installation:**
```bash
pnpm add node-cron --filter @livermore/coinbase-client
```

## Architecture Patterns

### Recommended Project Structure
```
packages/coinbase-client/src/
  reconciliation/
    reconciliation-service.ts   # Main service with cron jobs
    gap-detector.ts             # Pure function for gap detection
    types.ts                    # GapInfo, ReconciliationConfig interfaces
```

### Pattern 1: Service Start/Stop Lifecycle
**What:** Reconciliation service follows existing service patterns (AlertEvaluationService, IndicatorCalculationService)
**When to use:** All background services in this codebase
**Example:**
```typescript
// Source: Existing pattern from alert-evaluation.service.ts
export class ReconciliationService {
  private gapScanTask: ScheduledTask | null = null;
  private fullReconcileTask: ScheduledTask | null = null;

  async start(symbols: string[], timeframes: Timeframe[]): Promise<void> {
    // Initialize state
    // Schedule cron jobs
  }

  async stop(): Promise<void> {
    // Stop and destroy cron tasks
    // Clear state
  }
}
```

### Pattern 2: Gap Detection Algorithm
**What:** Compare expected timestamps against actual cached timestamps
**When to use:** Every 5 minutes for quick scan, hourly for full reconciliation
**Example:**
```typescript
// Source: Application-level pattern for time-series gap detection
interface GapInfo {
  symbol: string;
  timeframe: Timeframe;
  start: number;      // First missing timestamp
  end: number;        // Last missing timestamp
  count: number;      // Number of missing candles
}

function detectGaps(
  cachedTimestamps: number[],
  expectedStart: number,
  expectedEnd: number,
  intervalMs: number
): GapInfo[] {
  const gaps: GapInfo[] = [];
  const cachedSet = new Set(cachedTimestamps);

  let gapStart: number | null = null;
  let gapCount = 0;

  for (let ts = expectedStart; ts <= expectedEnd; ts += intervalMs) {
    if (!cachedSet.has(ts)) {
      if (gapStart === null) gapStart = ts;
      gapCount++;
    } else if (gapStart !== null) {
      // Gap ended, record it
      gaps.push({
        start: gapStart,
        end: ts - intervalMs,
        count: gapCount
      });
      gapStart = null;
      gapCount = 0;
    }
  }

  // Handle trailing gap
  if (gapStart !== null) {
    gaps.push({
      start: gapStart,
      end: expectedEnd,
      count: gapCount
    });
  }

  return gaps;
}
```

### Pattern 3: node-cron v4 with noOverlap
**What:** Schedule jobs that cannot overlap with themselves
**When to use:** All reconciliation jobs
**Example:**
```typescript
// Source: https://nodecron.com/scheduling-options.html
import cron, { type ScheduledTask } from 'node-cron';

// 5-minute gap scan (at :00, :05, :10, etc.)
this.gapScanTask = cron.schedule('*/5 * * * *', async () => {
  await this.performGapScan();
}, {
  name: 'gap-scan',
  noOverlap: true,    // Critical: skip if previous run still executing
  timezone: 'UTC'     // Consistent scheduling
});

// Hourly full reconciliation (at :00 of each hour)
this.fullReconcileTask = cron.schedule('0 * * * *', async () => {
  await this.performFullReconciliation();
}, {
  name: 'full-reconcile',
  noOverlap: true,
  timezone: 'UTC'
});
```

### Pattern 4: Reuse Existing Backfill Logic
**What:** Gap filling uses same rate-limited pattern as StartupBackfillService
**When to use:** When filling detected gaps
**Example:**
```typescript
// Source: Existing StartupBackfillService pattern
// Reuse rate limiting constants from packages/coinbase-client/src/backfill/types.ts
const BATCH_SIZE = 5;           // Requests per batch
const BATCH_DELAY_MS = 1000;    // Delay between batches

async fillGaps(gaps: GapInfo[]): Promise<void> {
  // Process in batches like StartupBackfillService
  for (let i = 0; i < gaps.length; i += BATCH_SIZE) {
    const batch = gaps.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(gap => this.fillSingleGap(gap)));

    if (i + BATCH_SIZE < gaps.length) {
      await this.sleep(BATCH_DELAY_MS);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Polling REST API continuously:** Use cron-based scheduling, not tight loops
- **Ignoring noOverlap:** Long-running reconciliation can stack if not prevented
- **Blocking normal operations:** Run reconciliation in background, don't block WebSocket or indicator service
- **Fetching all candles for comparison:** Only fetch timestamps (scores) for gap detection, not full candle data
- **Hardcoding time ranges:** Use timeframeToMs() for interval calculations

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | Custom timers with setInterval | node-cron | Handles cron syntax, DST, noOverlap |
| Timestamp calculations | Manual interval math | timeframeToMs() from @livermore/utils | Already handles all timeframes |
| Expected timestamp list | Manual loop | getCandleTimestamps() from @livermore/utils | Already handles boundary alignment |
| Rate-limited backfill | Custom rate limiter | Follow StartupBackfillService pattern | Proven to avoid 429s |
| Candle timestamp retrieval | Custom Redis commands | ZRANGEBYSCORE with WITHSCORES | ioredis handles this |

**Key insight:** The codebase already has most primitives needed. Gap detection is the new logic; scheduling and backfill reuse existing patterns.

## Common Pitfalls

### Pitfall 1: Task Stacking from Long-Running Jobs
**What goes wrong:** If 5-minute scan takes > 5 minutes, next scan starts before previous finishes
**Why it happens:** Network delays, large number of symbols, slow REST responses
**How to avoid:** Always use `noOverlap: true` in node-cron options
**Warning signs:** Multiple "gap scan started" logs without corresponding "completed" logs

### Pitfall 2: Aggressive Backfill Causing 429s
**What goes wrong:** Detecting many gaps triggers burst of REST requests
**Why it happens:** Reconciliation finds large gap (e.g., after extended downtime)
**How to avoid:** Use same rate limiting as StartupBackfillService (5 req/batch, 1s delay)
**Warning signs:** 429 errors in logs after reconciliation runs

### Pitfall 3: Incorrect Timestamp Boundary Alignment
**What goes wrong:** Gap detection reports false positives/negatives due to misaligned timestamps
**Why it happens:** Using raw timestamps instead of flooring to candle boundaries
**How to avoid:** Use `getCandleTimestamp()` to align all timestamps to candle boundaries
**Warning signs:** Gaps detected that don't exist, or real gaps missed

### Pitfall 4: Timezone Confusion in Cron Expressions
**What goes wrong:** Jobs run at unexpected times
**Why it happens:** Cron expressions interpreted in local timezone
**How to avoid:** Always specify `timezone: 'UTC'` in node-cron options
**Warning signs:** Logs show reconciliation running at wrong hours

### Pitfall 5: Blocking Server Startup
**What goes wrong:** Reconciliation service blocks server from starting
**Why it happens:** Service constructor does async work
**How to avoid:** Constructor only initializes, async work in `start()` method
**Warning signs:** Server hangs on startup

### Pitfall 6: Memory Pressure from Large Symbol Sets
**What goes wrong:** Checking all symbols/timeframes in single pass exhausts memory
**Why it happens:** Loading all candles for 25+ symbols x 5 timeframes
**How to avoid:** Process symbols sequentially or in small batches; only load timestamps (scores), not full candles
**Warning signs:** High memory usage during reconciliation, OOM errors

## Code Examples

Verified patterns from official sources and existing codebase:

### Retrieving Timestamps from Redis Sorted Set
```typescript
// Source: ioredis documentation + existing CandleCacheStrategy pattern
async getTimestampsInRange(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  start: number,
  end: number
): Promise<number[]> {
  const key = candleKey(userId, exchangeId, symbol, timeframe);

  // ZRANGEBYSCORE returns members; use WITHSCORES to get timestamps
  // But scores ARE timestamps, so just parse from ZRANGEBYSCORE result
  const results = await this.redis.zrangebyscore(key, start, end);

  return results.map(json => {
    const candle = JSON.parse(json) as Candle;
    return candle.timestamp;
  });
}
```

### Optimized: Get Only Scores (Timestamps)
```typescript
// More efficient: get only scores without deserializing candle data
async getTimestampsOnly(
  key: string,
  start: number,
  end: number
): Promise<number[]> {
  // ZRANGEBYSCORE key min max WITHSCORES returns [member, score, member, score, ...]
  const results = await this.redis.zrangebyscore(key, start, end, 'WITHSCORES');

  // Extract every other element (scores are at odd indices)
  const timestamps: number[] = [];
  for (let i = 1; i < results.length; i += 2) {
    timestamps.push(parseInt(results[i], 10));
  }
  return timestamps;
}
```

### Full Reconciliation: Compare Cache vs REST
```typescript
// Source: Reconciliation pattern for hourly validation
async reconcileSymbolTimeframe(
  symbol: string,
  timeframe: Timeframe
): Promise<ReconciliationResult> {
  // 1. Determine time range (last 24 hours for example)
  const now = Date.now();
  const intervalMs = timeframeToMs(timeframe);
  const lookbackMs = 24 * 60 * 60 * 1000; // 24 hours
  const start = getCandleTimestamp(now - lookbackMs, timeframe);
  const end = getCandleTimestamp(now, timeframe);

  // 2. Get cached timestamps (efficient - scores only)
  const cachedTimestamps = await this.getTimestampsOnly(
    candleKey(userId, exchangeId, symbol, timeframe),
    start,
    end
  );

  // 3. Fetch REST candles for comparison (sample, not full range)
  // Only fetch recent batch to avoid 429s
  const restCandles = await this.restClient.getCandles(symbol, timeframe);
  const restTimestamps = restCandles.map(c => c.timestamp);

  // 4. Detect gaps in cache
  const expectedTimestamps = getCandleTimestamps(start, end, timeframe);
  const gaps = this.detectGaps(cachedTimestamps, expectedTimestamps);

  // 5. Detect mismatches (cache has data but REST disagrees)
  // For hourly reconciliation, compare latest candles
  const mismatches = this.findMismatches(cachedTimestamps, restTimestamps);

  return { gaps, mismatches };
}
```

### node-cron Service Integration
```typescript
// Source: node-cron v4 API reference + existing service patterns
import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '@livermore/utils';

export class ReconciliationService {
  private gapScanTask: ScheduledTask | null = null;
  private fullReconcileTask: ScheduledTask | null = null;

  async start(symbols: string[], timeframes: Timeframe[]): Promise<void> {
    logger.info({ symbols: symbols.length, timeframes }, 'Starting Reconciliation Service');

    // 5-minute gap scan
    this.gapScanTask = cron.schedule('*/5 * * * *', async () => {
      logger.info({ event: 'gap_scan_start' }, 'Starting 5-minute gap scan');
      try {
        await this.performGapScan(symbols, timeframes);
        logger.info({ event: 'gap_scan_complete' }, 'Gap scan completed');
      } catch (error) {
        logger.error({ error }, 'Gap scan failed');
      }
    }, {
      name: 'gap-scan-5min',
      noOverlap: true,
      timezone: 'UTC'
    });

    // Hourly full reconciliation
    this.fullReconcileTask = cron.schedule('0 * * * *', async () => {
      logger.info({ event: 'full_reconcile_start' }, 'Starting hourly reconciliation');
      try {
        await this.performFullReconciliation(symbols, timeframes);
        logger.info({ event: 'full_reconcile_complete' }, 'Full reconciliation completed');
      } catch (error) {
        logger.error({ error }, 'Full reconciliation failed');
      }
    }, {
      name: 'full-reconcile-hourly',
      noOverlap: true,
      timezone: 'UTC'
    });

    logger.info('Reconciliation Service started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping Reconciliation Service');

    if (this.gapScanTask) {
      this.gapScanTask.stop();
      this.gapScanTask = null;
    }

    if (this.fullReconcileTask) {
      this.fullReconcileTask.stop();
      this.fullReconcileTask = null;
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-cron v3 (scheduled option) | node-cron v4 (createTask for delayed start) | May 2025 | API changed: use createTask() instead of scheduled: false |
| @types/node-cron | Built-in TypeScript | node-cron v4 | No need for separate type package |
| ZRANGEBYSCORE (deprecated in Redis 6.2+) | ZRANGE with BYSCORE | Redis 6.2+ | ZRANGEBYSCORE still works but ZRANGE is preferred |

**Deprecated/outdated:**
- node-cron v3 `scheduled` and `runOnInit` options: Removed in v4, use `createTask()` for initially stopped tasks
- Manual overlap prevention with isRunning flags: Use `noOverlap: true` option instead

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal scan window for 5-minute gap scan**
   - What we know: Should check recent data, not entire 24h window
   - What's unclear: Exact window size (10 minutes? 30 minutes?)
   - Recommendation: Start with 30 minutes (6 candles for 5m timeframe), adjust based on observed gap patterns

2. **Full reconciliation depth**
   - What we know: Hourly job should validate cache against REST
   - What's unclear: How far back to compare (1 hour? 6 hours? 24 hours?)
   - Recommendation: Start with 6 hours, balance between thoroughness and REST API load

3. **Reconciliation for higher timeframes**
   - What we know: 5m is primary WebSocket timeframe, higher timeframes from REST
   - What's unclear: Should reconciliation cover all timeframes or only 5m?
   - Recommendation: Focus on 5m for gap scan (WebSocket gaps), include higher timeframes in hourly full reconciliation

## Sources

### Primary (HIGH confidence)
- node-cron v4 GitHub repository (99.1% TypeScript) - API reference, options
- nodecron.com/api-reference.html - schedule(), createTask(), validate() functions
- nodecron.com/scheduling-options.html - noOverlap, timezone, maxExecutions options
- Existing codebase: CandleCacheStrategy, StartupBackfillService, timeframe utilities

### Secondary (MEDIUM confidence)
- Redis documentation for ZRANGEBYSCORE with WITHSCORES
- Better Stack guide on node-cron scheduled tasks

### Tertiary (LOW confidence)
- Community patterns for time-series gap detection (application-level, not library-specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - node-cron v4 documentation verified, ioredis already in use
- Architecture: HIGH - Follows existing service patterns exactly
- Pitfalls: HIGH - Based on node-cron docs and existing codebase patterns
- Gap detection algorithm: MEDIUM - Application-level pattern, not library-specific

**Research date:** 2026-01-21
**Valid until:** 60 days (node-cron v4 is stable, patterns are established)
