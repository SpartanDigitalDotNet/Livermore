import type { Timeframe, IRestClient } from '@livermore/schemas';
import { warmupStatsKey, CandleCacheStrategy, type RedisClient } from '@livermore/cache';
import { logger } from '@livermore/utils';
import { CandleStatusScanner } from './candle-status-scanner';
import { WarmupScheduleBuilder } from './warmup-schedule-builder';
import type { WarmupSchedule, WarmupStats } from './types';
import { SCAN_TIMEFRAME_ORDER } from './types';

/**
 * SmartWarmupService - orchestrates scan -> schedule -> execute for smart warmup
 *
 * Phase 35: Core innovation -- warmup that only fetches what is missing.
 * Coordinates the CandleStatusScanner and WarmupScheduleBuilder from Plan 01,
 * then executes the schedule with rate-limited REST calls, continuously publishing
 * progress stats to Redis for external observability.
 *
 * On a warm restart with fully cached data, zero REST calls are made.
 */
export class SmartWarmupService {
  private readonly redis: RedisClient;
  private readonly exchangeId: number;
  private readonly restClient: IRestClient;
  private readonly candleCache: CandleCacheStrategy;
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
    this.scanner = new CandleStatusScanner(opts.redis, opts.exchangeId);
    this.builder = new WarmupScheduleBuilder(opts.redis, opts.exchangeId);

    // Initialize stats
    this.stats = {
      exchangeId: opts.exchangeId,
      status: 'scanning',
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
   * Main entry point: scan cached data, build schedule, execute only what's missing.
   *
   * @param symbols - Array of symbols to warm up (e.g. ['BTC-USD', 'ETH-USD'])
   * @param timeframes - Timeframes to warm up (defaults to SCAN_TIMEFRAME_ORDER)
   * @returns The complete warmup schedule
   */
  async warmup(
    symbols: string[],
    timeframes?: Timeframe[]
  ): Promise<WarmupSchedule> {
    const startTime = Date.now();
    const tf = timeframes ?? SCAN_TIMEFRAME_ORDER;

    logger.info({
      event: 'warmup_start',
      exchangeId: this.exchangeId,
      symbols: symbols.length,
      timeframes: tf.length,
    }, `Smart warmup starting: ${symbols.length} symbols x ${tf.length} timeframes`);

    // 1. Scanning phase
    this.stats.status = 'scanning';
    this.stats.startedAt = startTime;
    await this.publishStats();

    // 2. Scan cached candle counts
    const scanResults = await this.scanner.scanExchange(symbols, tf);

    // 3. Build and persist schedule
    const schedule = await this.builder.buildAndPersist(scanResults);

    // 4. Update stats for execution phase
    this.stats.status = 'executing';
    this.stats.totalPairs = schedule.needsFetching;
    this.stats.skippedPairs = schedule.sufficientPairs;
    await this.publishStats();

    // 5. Check if all pairs are sufficient (zero REST calls needed)
    if (schedule.needsFetching === 0) {
      logger.info({
        event: 'warmup_skip',
        exchangeId: this.exchangeId,
        totalPairs: schedule.totalPairs,
        sufficientPairs: schedule.sufficientPairs,
      }, 'All pairs have sufficient data, zero REST calls needed');

      this.stats.status = 'complete';
      this.stats.percentComplete = 100;
      await this.publishStats();

      return schedule;
    }

    // 6. Execute the schedule (fetch only what's missing)
    await this.executeSchedule(schedule);

    // 7. Mark complete
    this.stats.status = 'complete';
    this.stats.percentComplete = 100;
    this.stats.currentSymbol = null;
    this.stats.currentTimeframe = null;
    await this.publishStats();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info({
      event: 'warmup_complete',
      exchangeId: this.exchangeId,
      totalPairs: schedule.totalPairs,
      fetched: schedule.needsFetching,
      skipped: schedule.sufficientPairs,
      errors: this.stats.failedPairs,
      elapsedSec: elapsed,
    }, `Smart warmup complete: ${schedule.needsFetching} fetched, ${schedule.sufficientPairs} skipped in ${elapsed}s (${this.stats.failedPairs} errors)`);

    return schedule;
  }

  /**
   * Execute the warmup schedule: fetch candles for each entry in batches.
   * Uses the same rate-limiting pattern as StartupBackfillService.
   */
  private async executeSchedule(schedule: WarmupSchedule): Promise<void> {
    const startTime = Date.now();
    const entries = schedule.entries;

    for (let i = 0; i < entries.length; i += this.batchSize) {
      const batch = entries.slice(i, i + this.batchSize);

      // Set current symbol/timeframe from first entry in batch
      this.stats.currentSymbol = batch[0]?.symbol ?? null;
      this.stats.currentTimeframe = batch[0]?.timeframe ?? null;

      // Execute batch with Promise.allSettled (individual failures don't block)
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const candles = await this.restClient.getCandles(entry.symbol, entry.timeframe);
          const toCache = candles.slice(0, entry.targetCount);
          await this.candleCache.addCandles(1, this.exchangeId, toCache);
          return toCache.length;
        })
      );

      // Process results
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

      // Compute progress
      const totalProcessed = this.stats.completedPairs + this.stats.failedPairs;
      this.stats.percentComplete = this.stats.totalPairs > 0
        ? Math.round((totalProcessed / this.stats.totalPairs) * 100)
        : 0;

      // Compute ETA
      const elapsed = Date.now() - startTime;
      const rate = totalProcessed / (elapsed / 1000); // pairs per second
      const remaining = this.stats.totalPairs - totalProcessed;
      this.stats.etaMs = rate > 0 ? Math.round((remaining / rate) * 1000) : null;

      // Update current symbol/timeframe for next batch (preview)
      const nextBatchStart = i + this.batchSize;
      if (nextBatchStart < entries.length) {
        this.stats.currentSymbol = entries[nextBatchStart].symbol;
        this.stats.currentTimeframe = entries[nextBatchStart].timeframe;
      }

      // Publish stats to Redis
      await this.publishStats();

      // Log progress
      const etaSec = this.stats.etaMs !== null
        ? (this.stats.etaMs / 1000).toFixed(1)
        : '?';
      logger.info({
        event: 'warmup_progress',
        completed: totalProcessed,
        total: this.stats.totalPairs,
        etaSec,
        errors: this.stats.failedPairs,
      }, `Warmup: ${totalProcessed}/${this.stats.totalPairs} - ETA ${etaSec}s`);

      // Sleep between batches (skip on last batch)
      if (nextBatchStart < entries.length) {
        await this.sleep(this.batchDelayMs);
      }
    }
  }

  /**
   * Publish current stats to Redis for external observability (Admin UI).
   * Key does NOT get a TTL -- persists until the next warmup run overwrites it.
   */
  private async publishStats(): Promise<void> {
    this.stats.updatedAt = Date.now();
    await this.redis.set(
      warmupStatsKey(this.exchangeId),
      JSON.stringify(this.stats)
    );
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
