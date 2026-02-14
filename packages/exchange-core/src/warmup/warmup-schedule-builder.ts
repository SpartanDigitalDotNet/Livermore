import { warmupScheduleKey, type RedisClient } from '@livermore/cache';
import { logger } from '@livermore/utils';
import type { CandleStatusResult, WarmupSchedule, WarmupScheduleEntry } from './types';
import { DEFAULT_CANDLE_TARGET } from './types';

/**
 * WarmupScheduleBuilder - creates and persists warmup schedule from scan results
 *
 * Filters scan results to only insufficient pairs, builds a structured schedule
 * with reason tracking, and persists to Redis for external observability.
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
   * @param scanResults - Results from CandleStatusScanner
   * @param mode - Warmup mode (full_refresh or targeted)
   * @returns The complete warmup schedule (also persisted to Redis)
   */
  async buildAndPersist(
    scanResults: CandleStatusResult[],
    mode: 'full_refresh' | 'targeted'
  ): Promise<WarmupSchedule> {
    // Filter to only pairs that need fetching (insufficient data)
    const insufficientResults = scanResults.filter(result => !result.sufficient);

    // Map to schedule entries with target counts and reasons
    const entries: WarmupScheduleEntry[] = insufficientResults.map(result => ({
      symbol: result.symbol,
      timeframe: result.timeframe,
      cachedCount: result.cachedCount,
      targetCount: DEFAULT_CANDLE_TARGET,
      reason: mode === 'full_refresh'
        ? 'full_refresh' as const
        : (result.reason as 'low_count' | 'stale' | 'empty') ?? 'empty',
    }));

    // Build schedule with metadata
    const schedule: WarmupSchedule = {
      exchangeId: this.exchangeId,
      createdAt: Date.now(),
      mode,
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
