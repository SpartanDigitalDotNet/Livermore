import type { Timeframe, IRestClient } from '@livermore/schemas';
import { CandleCacheStrategy, type RedisClient } from '@livermore/cache';
import { logger } from '@livermore/utils';
import { BackfillConfig, DEFAULT_BACKFILL_DEFAULTS, TIMEFRAME_PRIORITY } from './types';

/**
 * Startup backfill service for populating Redis cache with historical candles
 *
 * This service fetches historical candles from the Coinbase REST API and stores them
 * in Redis cache. It's designed to run at application startup to ensure the indicator
 * service has sufficient data (60+ candles) for accurate MACD-V calculations.
 *
 * Features:
 * - Priority-ordered timeframe processing (5m first)
 * - Rate-limited batch execution (5 req/batch, 1s delay)
 * - Progress logging for visibility
 * - Graceful error handling (individual failures don't block entire backfill)
 */
export class StartupBackfillService {
  private restClient: IRestClient;
  private candleCache: CandleCacheStrategy;
  private config: BackfillConfig;

  constructor(
    restClient: IRestClient,
    redis: RedisClient,
    config: Pick<BackfillConfig, 'userId' | 'exchangeId'> & Partial<BackfillConfig>
  ) {
    this.restClient = restClient;
    this.candleCache = new CandleCacheStrategy(redis);
    this.config = { ...DEFAULT_BACKFILL_DEFAULTS, ...config };
  }

  /**
   * Backfill candles for multiple symbols and timeframes
   *
   * Processes timeframes in priority order (5m first) to enable indicator
   * calculations sooner. Uses batched requests with delays to avoid 429 errors.
   *
   * @param symbols - Array of trading symbols (e.g., ['BTC-USD', 'ETH-USD'])
   * @param timeframes - Array of timeframes to backfill
   */
  async backfill(symbols: string[], timeframes: Timeframe[]): Promise<void> {
    const startTime = Date.now();

    // Sort timeframes by priority order (BKFL-03)
    const sortedTimeframes = this.sortByPriority(timeframes);

    // Build task list: all symbol/timeframe combinations in priority order
    // Outer loop: timeframes (in priority order)
    // Inner loop: symbols
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

    // Process tasks in batches
    for (let i = 0; i < tasks.length; i += this.config.batchSize) {
      const batch = tasks.slice(i, i + this.config.batchSize);

      // Execute batch with Promise.allSettled (individual failures don't block)
      const results = await Promise.allSettled(
        batch.map(task => this.backfillSymbolTimeframe(task.symbol, task.timeframe))
      );

      // Count fulfilled/rejected results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          completed++;
        } else {
          errors++;
          logger.warn({ error: result.reason }, 'Backfill task failed');
        }
      }

      // Log progress (BKFL-04)
      this.logProgress(completed, tasks.length, startTime, errors, batch);

      // Sleep before next batch (skip on last batch)
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

  /**
   * Backfill candles for a single symbol and timeframe
   *
   * @returns Number of candles cached
   */
  private async backfillSymbolTimeframe(
    symbol: string,
    timeframe: Timeframe
  ): Promise<number> {
    // Fetch candles from REST API (no start/end = most recent)
    const candles = await this.restClient.getCandles(symbol, timeframe);

    // Take first N candles (Coinbase returns newest-first)
    const toCache = candles.slice(0, this.config.candleCount);

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

  /**
   * Sort timeframes by TIMEFRAME_PRIORITY order
   */
  private sortByPriority(timeframes: Timeframe[]): Timeframe[] {
    return [...timeframes].sort((a, b) => {
      const aIdx = TIMEFRAME_PRIORITY.indexOf(a);
      const bIdx = TIMEFRAME_PRIORITY.indexOf(b);
      // Unknown timeframes go to end
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
  }

  /**
   * Log backfill progress (BKFL-04)
   */
  private logProgress(
    completed: number,
    total: number,
    startTime: number,
    errors: number,
    batch: Array<{ symbol: string; timeframe: Timeframe }>
  ): void {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = completed / elapsed;
    const remaining = total - completed;
    const eta = rate > 0 ? (remaining / rate).toFixed(1) : '?';
    const tf = batch[0]?.timeframe ?? '?';

    logger.info({
      event: 'backfill_progress',
      timeframe: tf,
      completed,
      total,
      etaSec: eta,
      errors,
    }, `Backfill: ${tf} ${completed}/${total} - ETA ${eta}s`);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
