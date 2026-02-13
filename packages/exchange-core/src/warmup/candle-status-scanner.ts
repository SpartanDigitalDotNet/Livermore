import { exchangeCandleKey, type RedisClient } from '@livermore/cache';
import type { Timeframe } from '@livermore/schemas';
import { logger } from '@livermore/utils';
import { CandleStatusResult, SCAN_TIMEFRAME_ORDER, MIN_CANDLE_THRESHOLD } from './types';

/**
 * CandleStatusScanner - scans Redis to check cached candle counts for symbol/timeframe pairs
 *
 * Part of Smart Warmup (Phase 35) - determines what data is already cached before
 * making any REST calls. Scans largest to smallest timeframe per WARM-01 requirement.
 */
export class CandleStatusScanner {
  constructor(
    private readonly redis: RedisClient,
    private readonly exchangeId: number
  ) {}

  /**
   * Scan all symbol/timeframe pairs to determine cached candle counts.
   * Returns results for both sufficient and insufficient pairs.
   *
   * @param symbols - Array of symbols to scan (e.g. ['BTC-USD', 'ETH-USD'])
   * @param timeframes - Timeframes to scan (defaults to SCAN_TIMEFRAME_ORDER: largest to smallest)
   * @returns Array of CandleStatusResult for each symbol/timeframe pair
   */
  async scanExchange(
    symbols: string[],
    timeframes: Timeframe[] = SCAN_TIMEFRAME_ORDER
  ): Promise<CandleStatusResult[]> {
    logger.info({
      event: 'candle_scan_start',
      exchangeId: this.exchangeId,
      symbols: symbols.length,
      timeframes,
    });

    const results: CandleStatusResult[] = [];
    let sufficientCount = 0;
    let needsFetchingCount = 0;

    // Scan each symbol across all timeframes (largest to smallest per WARM-01)
    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        const key = exchangeCandleKey(this.exchangeId, symbol, timeframe);
        const cachedCount = await this.redis.zcard(key);
        const sufficient = cachedCount >= MIN_CANDLE_THRESHOLD;

        results.push({
          symbol,
          timeframe,
          cachedCount,
          sufficient,
        });

        if (sufficient) {
          sufficientCount++;
        } else {
          needsFetchingCount++;
        }
      }
    }

    logger.info({
      event: 'candle_scan_complete',
      exchangeId: this.exchangeId,
      total: results.length,
      sufficient: sufficientCount,
      needsFetching: needsFetchingCount,
    });

    return results;
  }
}
