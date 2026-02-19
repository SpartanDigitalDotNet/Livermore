import { exchangeCandleKey, type RedisClient } from '@livermore/cache';
import type { Timeframe } from '@livermore/schemas';
import { logger } from '@livermore/utils';
import type { CandleStatusResult } from './types';
import {
  WARMUP_TIMEFRAMES,
  STALENESS_THRESHOLDS,
  MIN_INDICATOR_CANDLES,
} from './types';

/**
 * CandleStatusScanner — tiered sentinel scan for smart warmup.
 *
 * Per-timeframe strategy:
 * 1. Check sentinel symbol (#1 ranked) first
 * 2. If sentinel is recent AND has enough candles → scan remaining symbols,
 *    collect only those that individually need data
 * 3. If sentinel fails → ALL symbols need that timeframe
 *
 * This avoids unnecessary REST calls: if the pipeline was running (sentinel passes),
 * most symbols will be fine. Only fetch stragglers.
 */
export class CandleStatusScanner {
  constructor(
    private readonly redis: RedisClient,
    private readonly exchangeId: number
  ) {}

  /**
   * Tiered scan: sentinel-first per timeframe.
   *
   * @param sentinelSymbol - The #1 ranked symbol (checked first per timeframe)
   * @param symbols - All symbols to warm up
   * @param timeframes - Timeframes to scan (defaults to WARMUP_TIMEFRAMES)
   * @returns Array of CandleStatusResult for every symbol/timeframe pair
   */
  async scanExchange(
    sentinelSymbol: string,
    symbols: string[],
    timeframes: Timeframe[] = WARMUP_TIMEFRAMES
  ): Promise<CandleStatusResult[]> {
    const now = Date.now();
    const results: CandleStatusResult[] = [];
    let sufficientCount = 0;
    let needsFetchingCount = 0;

    logger.info({
      event: 'candle_scan_start',
      exchangeId: this.exchangeId,
      sentinelSymbol,
      symbols: symbols.length,
      timeframes,
    }, `Scanning ${symbols.length} symbols × ${timeframes.length} timeframes (sentinel: ${sentinelSymbol})`);

    for (const timeframe of timeframes) {
      const threshold = STALENESS_THRESHOLDS[timeframe] ?? 60 * 60 * 1000;

      // Step 1: Check sentinel symbol for this timeframe
      const sentinelResult = await this.checkSymbol(sentinelSymbol, timeframe, now, threshold);
      results.push(sentinelResult);

      if (sentinelResult.sufficient) {
        sufficientCount++;
      } else {
        needsFetchingCount++;
      }

      if (!sentinelResult.sufficient) {
        // Sentinel failed → mark ALL remaining symbols as needing this timeframe
        logger.info({
          event: 'sentinel_fail_timeframe',
          exchangeId: this.exchangeId,
          sentinelSymbol,
          timeframe,
          reason: sentinelResult.reason,
        }, `Sentinel ${sentinelSymbol} ${timeframe}: ${sentinelResult.reason} — all symbols need fetch`);

        for (const symbol of symbols) {
          if (symbol === sentinelSymbol) continue; // already checked
          // Mark as insufficient without individual check (sentinel says pipeline wasn't producing this tf)
          results.push({
            symbol,
            timeframe,
            cachedCount: -1, // unknown — skip individual check for speed
            newestCandleAge: null,
            sufficient: false,
            reason: 'stale', // pipeline wasn't producing this timeframe
          });
          needsFetchingCount++;
        }
      } else {
        // Sentinel passed → scan remaining symbols individually
        const remaining = symbols.filter(s => s !== sentinelSymbol);

        for (const symbol of remaining) {
          const result = await this.checkSymbol(symbol, timeframe, now, threshold);
          results.push(result);

          if (result.sufficient) {
            sufficientCount++;
          } else {
            needsFetchingCount++;
          }
        }
      }
    }

    logger.info({
      event: 'candle_scan_complete',
      exchangeId: this.exchangeId,
      total: results.length,
      sufficient: sufficientCount,
      needsFetching: needsFetchingCount,
    }, `Scan complete: ${sufficientCount} sufficient, ${needsFetchingCount} need fetching`);

    return results;
  }

  /**
   * Full scan: every symbol × every timeframe (used for full_refresh mode).
   * No sentinel optimization — everything needs data.
   *
   * @param symbols - All symbols
   * @param timeframes - Timeframes to scan
   * @returns Results with all pairs marked insufficient (reason: full_refresh handled by caller)
   */
  async scanForFullRefresh(
    symbols: string[],
    timeframes: Timeframe[] = WARMUP_TIMEFRAMES
  ): Promise<CandleStatusResult[]> {
    const results: CandleStatusResult[] = [];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        results.push({
          symbol,
          timeframe,
          cachedCount: 0,
          newestCandleAge: null,
          sufficient: false,
          reason: 'empty',
        });
      }
    }

    logger.info({
      event: 'candle_scan_full_refresh',
      exchangeId: this.exchangeId,
      totalPairs: results.length,
    }, `Full refresh scan: ${results.length} pairs all marked for fetching`);

    return results;
  }

  /**
   * Check a single symbol/timeframe: count + freshness.
   */
  private async checkSymbol(
    symbol: string,
    timeframe: Timeframe,
    now: number,
    stalenessThresholdMs: number
  ): Promise<CandleStatusResult> {
    const key = exchangeCandleKey(this.exchangeId, symbol, timeframe);

    // Count + newest candle in parallel
    const [cachedCount, newestEntries] = await Promise.all([
      this.redis.zcard(key),
      this.redis.zrange(key, -1, -1, 'WITHSCORES'),
    ]);

    // Empty cache
    if (cachedCount === 0 || newestEntries.length < 2) {
      return {
        symbol,
        timeframe,
        cachedCount,
        newestCandleAge: null,
        sufficient: false,
        reason: 'empty',
      };
    }

    const newestTimestamp = parseInt(newestEntries[1], 10);
    const newestCandleAge = now - newestTimestamp;

    // Count check
    if (cachedCount < MIN_INDICATOR_CANDLES) {
      return {
        symbol,
        timeframe,
        cachedCount,
        newestCandleAge,
        sufficient: false,
        reason: 'low_count',
      };
    }

    // Freshness check
    if (newestCandleAge > stalenessThresholdMs) {
      return {
        symbol,
        timeframe,
        cachedCount,
        newestCandleAge,
        sufficient: false,
        reason: 'stale',
      };
    }

    return {
      symbol,
      timeframe,
      cachedCount,
      newestCandleAge,
      sufficient: true,
      reason: 'ok',
    };
  }
}
