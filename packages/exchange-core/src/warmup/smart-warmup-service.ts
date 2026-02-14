import type { Timeframe, IRestClient } from '@livermore/schemas';
import { warmupStatsKey, CandleCacheStrategy, type RedisClient } from '@livermore/cache';
import { logger } from '@livermore/utils';
import { CacheTrustAssessor } from './cache-trust-assessor';
import { CandleStatusScanner } from './candle-status-scanner';
import { WarmupScheduleBuilder } from './warmup-schedule-builder';
import type { WarmupSchedule, WarmupStats } from './types';
import { WARMUP_TIMEFRAMES } from './types';

/**
 * SmartWarmupService — orchestrates the full warmup pipeline:
 *
 * 1. ASSESS: Cache trust check (status key, heartbeat, sentinel 5m)
 * 2. DUMP (if needed): Delete all candle keys for this exchange
 * 3. SCAN: Tiered sentinel scan (targeted) or full scan (full_refresh)
 * 4. BUILD: Create warmup schedule from scan results
 * 5. EXECUTE: Fetch candles via REST in batches
 */
export class SmartWarmupService {
  private readonly redis: RedisClient;
  private readonly exchangeId: number;
  private readonly restClient: IRestClient;
  private readonly candleCache: CandleCacheStrategy;
  private readonly trustAssessor: CacheTrustAssessor;
  private readonly scanner: CandleStatusScanner;
  private readonly builder: WarmupScheduleBuilder;

  private stats: WarmupStats;

  private readonly batchSize = 5;
  private readonly batchDelayMs = 1000;

  constructor(opts: {
    redis: RedisClient;
    exchangeId: number;
    restClient: IRestClient;
  }) {
    this.redis = opts.redis;
    this.exchangeId = opts.exchangeId;
    this.restClient = opts.restClient;
    this.candleCache = new CandleCacheStrategy(opts.redis);
    this.trustAssessor = new CacheTrustAssessor(opts.redis, opts.exchangeId);
    this.scanner = new CandleStatusScanner(opts.redis, opts.exchangeId);
    this.builder = new WarmupScheduleBuilder(opts.redis, opts.exchangeId);

    this.stats = {
      exchangeId: opts.exchangeId,
      status: 'assessing',
      mode: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      totalPairs: 0,
      completedPairs: 0,
      skippedPairs: 0,
      failedPairs: 0,
      percentComplete: 0,
      etaMs: null,
      currentSymbol: null,
      currentTimeframe: null,
      failures: [],
    };
  }

  /**
   * Main entry point.
   *
   * @param symbols - Array of symbols to warm up
   * @param sentinelSymbol - The #1 ranked symbol for trust checks
   * @param timeframes - Timeframes to warm up (defaults to WARMUP_TIMEFRAMES)
   * @returns The complete warmup schedule
   */
  async warmup(
    symbols: string[],
    sentinelSymbol: string,
    timeframes?: Timeframe[]
  ): Promise<WarmupSchedule> {
    const startTime = Date.now();
    const tf = timeframes ?? WARMUP_TIMEFRAMES;

    logger.info({
      event: 'warmup_start',
      exchangeId: this.exchangeId,
      sentinelSymbol,
      symbols: symbols.length,
      timeframes: tf.length,
    }, `Smart warmup starting: ${symbols.length} symbols × ${tf.length} timeframes (sentinel: ${sentinelSymbol})`);

    // Phase 1: ASSESS — determine cache trust
    this.stats.status = 'assessing';
    this.stats.startedAt = startTime;
    await this.publishStats();

    const trustResult = await this.trustAssessor.assess(sentinelSymbol);
    this.stats.mode = trustResult.mode;

    logger.info({
      event: 'warmup_mode_determined',
      exchangeId: this.exchangeId,
      mode: trustResult.mode,
      reason: trustResult.reason,
    }, `Warmup mode: ${trustResult.mode} — ${trustResult.reason}`);

    // Phase 2: DUMP (if full refresh required)
    if (trustResult.mode === 'full_refresh') {
      this.stats.status = 'dumping';
      await this.publishStats();

      const keysDeleted = await this.trustAssessor.dumpExchangeCandles();
      logger.info({
        event: 'warmup_dump_complete',
        exchangeId: this.exchangeId,
        keysDeleted,
      }, `Cache dump complete: ${keysDeleted} keys deleted`);
    }

    // Phase 3: SCAN
    this.stats.status = 'scanning';
    await this.publishStats();

    let scanResults;
    if (trustResult.mode === 'full_refresh') {
      scanResults = await this.scanner.scanForFullRefresh(symbols, tf);
    } else {
      scanResults = await this.scanner.scanExchange(sentinelSymbol, symbols, tf);
    }

    // Phase 4: BUILD schedule
    const schedule = await this.builder.buildAndPersist(scanResults, trustResult.mode);

    // Log schedule summary by timeframe
    const tfCounts = new Map<string, number>();
    for (const entry of schedule.entries) {
      tfCounts.set(entry.timeframe, (tfCounts.get(entry.timeframe) ?? 0) + 1);
    }
    logger.info({
      event: 'warmup_schedule_summary',
      exchangeId: this.exchangeId,
      mode: trustResult.mode,
      totalPairs: schedule.totalPairs,
      sufficient: schedule.sufficientPairs,
      needsFetching: schedule.needsFetching,
      byTimeframe: Object.fromEntries(tfCounts),
    }, `Warmup schedule [${trustResult.mode}]: ${schedule.needsFetching}/${schedule.totalPairs} need fetching (${Array.from(tfCounts.entries()).map(([t, n]) => `${t}:${n}`).join(', ')})`);

    // Phase 5: EXECUTE
    this.stats.status = 'fetching';
    this.stats.totalPairs = schedule.needsFetching;
    this.stats.skippedPairs = schedule.sufficientPairs;
    await this.publishStats();

    if (schedule.needsFetching === 0) {
      logger.info({
        event: 'warmup_skip',
        exchangeId: this.exchangeId,
        totalPairs: schedule.totalPairs,
        sufficientPairs: schedule.sufficientPairs,
      }, 'All pairs have sufficient data, zero REST calls needed');
    } else {
      await this.executeSchedule(schedule);
    }

    // Complete
    this.stats.status = 'complete';
    this.stats.percentComplete = 100;
    this.stats.currentSymbol = null;
    this.stats.currentTimeframe = null;
    await this.publishStats();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info({
      event: 'warmup_complete',
      exchangeId: this.exchangeId,
      mode: trustResult.mode,
      totalPairs: schedule.totalPairs,
      fetched: schedule.needsFetching,
      skipped: schedule.sufficientPairs,
      errors: this.stats.failedPairs,
      elapsedSec: elapsed,
    }, `Smart warmup complete [${trustResult.mode}]: ${schedule.needsFetching} fetched, ${schedule.sufficientPairs} skipped in ${elapsed}s (${this.stats.failedPairs} errors)`);

    return schedule;
  }

  // ─── SCHEDULE EXECUTION ──────────────────────────────────────

  /**
   * Execute the warmup schedule: fetch candles for each entry in batches.
   */
  private async executeSchedule(schedule: WarmupSchedule): Promise<void> {
    const startTime = Date.now();
    const entries = schedule.entries;

    for (let i = 0; i < entries.length; i += this.batchSize) {
      const batch = entries.slice(i, i + this.batchSize);

      this.stats.currentSymbol = batch[0]?.symbol ?? null;
      this.stats.currentTimeframe = batch[0]?.timeframe ?? null;

      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const candles = await this.restClient.getCandles(entry.symbol, entry.timeframe);
          const toCache = candles.slice(0, entry.targetCount);
          await this.candleCache.addCandles(1, this.exchangeId, toCache);
          return toCache.length;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          this.stats.completedPairs++;
        } else {
          this.stats.failedPairs++;
          const entry = batch[j];
          const errorMsg = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
          this.stats.failures.push({
            symbol: entry.symbol,
            timeframe: entry.timeframe,
            error: errorMsg,
          });
          logger.warn({
            event: 'warmup_fetch_error',
            symbol: entry.symbol,
            timeframe: entry.timeframe,
            error: errorMsg,
          }, `Warmup fetch failed: ${entry.symbol} ${entry.timeframe}`);
        }
      }

      // Progress
      const totalProcessed = this.stats.completedPairs + this.stats.failedPairs;
      this.stats.percentComplete = this.stats.totalPairs > 0
        ? Math.round((totalProcessed / this.stats.totalPairs) * 100)
        : 0;

      // ETA
      const elapsed = Date.now() - startTime;
      const rate = totalProcessed / (elapsed / 1000);
      const remaining = this.stats.totalPairs - totalProcessed;
      this.stats.etaMs = rate > 0 ? Math.round((remaining / rate) * 1000) : null;

      // Preview next batch
      const nextBatchStart = i + this.batchSize;
      if (nextBatchStart < entries.length) {
        this.stats.currentSymbol = entries[nextBatchStart].symbol;
        this.stats.currentTimeframe = entries[nextBatchStart].timeframe;
      }

      await this.publishStats();

      // Log progress with current symbol
      const etaSec = this.stats.etaMs !== null
        ? (this.stats.etaMs / 1000).toFixed(1)
        : '?';
      logger.info({
        event: 'warmup_progress',
        completed: totalProcessed,
        total: this.stats.totalPairs,
        currentSymbol: this.stats.currentSymbol,
        currentTimeframe: this.stats.currentTimeframe,
        etaSec,
        errors: this.stats.failedPairs,
      }, `Warmup: ${totalProcessed}/${this.stats.totalPairs} [${this.stats.currentSymbol} ${this.stats.currentTimeframe}] - ETA ${etaSec}s`);

      if (nextBatchStart < entries.length) {
        await this.sleep(this.batchDelayMs);
      }
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────

  private async publishStats(): Promise<void> {
    this.stats.updatedAt = Date.now();
    await this.redis.set(
      warmupStatsKey(this.exchangeId),
      JSON.stringify(this.stats)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
