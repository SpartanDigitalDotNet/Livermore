import { warmupScheduleKey, type RedisClient } from '@livermore/cache';
import { logger } from '@livermore/utils';
import { CandleStatusResult, WarmupSchedule, WarmupScheduleEntry, DEFAULT_CANDLE_TARGET } from './types';

/**
 * WarmupScheduleBuilder - creates and persists warmup schedule from scan results
 *
 * Part of Smart Warmup (Phase 35) - filters scan results to only insufficient pairs,
 * builds a structured schedule, and persists to Redis for external observability.
 */
export class WarmupScheduleBuilder {
  constructor(
    private readonly redis: RedisClient,
    private readonly exchangeId: number
  ) {}

  /**
   * Build warmup schedule from scan results and persist to Redis.
   * Filters to only insufficient pairs and creates structured schedule.
   *
   * @param scanResults - Results from CandleStatusScanner.scanExchange()
   * @returns The complete warmup schedule (also persisted to Redis)
   */
  async buildAndPersist(scanResults: CandleStatusResult[]): Promise<WarmupSchedule> {
    // Filter to only pairs that need fetching (insufficient data)
    const insufficientResults = scanResults.filter(result => !result.sufficient);

    // Map to schedule entries with target counts
    const entries: WarmupScheduleEntry[] = insufficientResults.map(result => ({
      symbol: result.symbol,
      timeframe: result.timeframe,
      cachedCount: result.cachedCount,
      targetCount: DEFAULT_CANDLE_TARGET,
    }));

    // Build schedule with metadata
    const schedule: WarmupSchedule = {
      exchangeId: this.exchangeId,
      createdAt: Date.now(),
      totalPairs: scanResults.length,
      sufficientPairs: scanResults.filter(r => r.sufficient).length,
      needsFetching: entries.length,
      entries,
    };

    // Persist to Redis as JSON
    const key = warmupScheduleKey(this.exchangeId);
    await this.redis.set(key, JSON.stringify(schedule));

    logger.info({
      event: 'warmup_schedule_persisted',
      exchangeId: this.exchangeId,
      key,
      totalPairs: schedule.totalPairs,
      sufficientPairs: schedule.sufficientPairs,
      needsFetching: schedule.needsFetching,
    });

    return schedule;
  }
}
