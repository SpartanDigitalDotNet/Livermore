import { instanceStatusKey, exchangeCandleKey, deleteKeysClusterSafe, type RedisClient } from '@livermore/cache';
import { logger } from '@livermore/utils';
import type { InstanceStatus } from '@livermore/schemas';
import type { CacheTrustResult } from './types';
import { SENTINEL_5M_THRESHOLD_MS, HEARTBEAT_STALE_THRESHOLD_MS } from './types';

/**
 * CacheTrustAssessor — determines if the exchange candle cache is trustworthy.
 *
 * Three-check sequence (fast, O(1) Redis ops):
 * 1. Instance status key missing → logged but NOT fatal (key has 45s TTL,
 *    a quick bounce loses the key while candle data remains valid)
 * 2. Instance status key present but lastHeartbeat > 3h → full_refresh (zombie)
 * 3. Sentinel symbol's 5m newest candle > 20min old → full_refresh (pipeline was down)
 *
 * The sentinel candle check (3) is the real source of truth. A missing status
 * key alone does not trigger a full refresh — only stale candle data does.
 *
 * If checks pass → cache is trustworthy, use targeted warmup.
 * If check 2 or 3 fails → dump all candle keys, full refresh.
 */
export class CacheTrustAssessor {
  constructor(
    private readonly redis: RedisClient,
    private readonly exchangeId: number
  ) {}

  /**
   * Assess whether the candle cache for this exchange can be trusted.
   *
   * @param sentinelSymbol - The #1 ranked symbol (e.g. 'BTC-USD')
   * @returns CacheTrustResult with mode and reason
   */
  async assess(sentinelSymbol: string): Promise<CacheTrustResult> {
    const now = Date.now();

    // Check 1: Instance status key — informational only.
    // A missing key does NOT trigger full_refresh by itself. The instance may
    // have bounced briefly (the status key has a 45s TTL). We fall through to
    // the sentinel candle check which is the real source of truth.
    const statusKey = instanceStatusKey(this.exchangeId);
    const statusRaw = await this.redis.get(statusKey);

    if (!statusRaw) {
      logger.info({
        event: 'cache_trust_status_missing',
        exchangeId: this.exchangeId,
      }, 'Instance status key missing (TTL expired or first run) — checking sentinel candle freshness');
    } else {
      // Check 2: Heartbeat freshness (only if status key exists)
      let status: InstanceStatus;
      try {
        status = JSON.parse(statusRaw) as InstanceStatus;
      } catch {
        logger.warn({
          event: 'cache_trust_fail',
          exchangeId: this.exchangeId,
          check: 'status_parse_error',
        }, 'Cache trust FAIL: cannot parse instance status — full refresh required');
        return { mode: 'full_refresh', reason: 'Instance status key corrupt' };
      }

      if (status.lastHeartbeat) {
        const heartbeatAge = now - new Date(status.lastHeartbeat).getTime();
        if (heartbeatAge > HEARTBEAT_STALE_THRESHOLD_MS) {
          const ageHours = (heartbeatAge / (60 * 60 * 1000)).toFixed(1);
          logger.warn({
            event: 'cache_trust_fail',
            exchangeId: this.exchangeId,
            check: 'heartbeat_stale',
            heartbeatAge: heartbeatAge,
            ageHours,
          }, `Cache trust FAIL: lastHeartbeat is ${ageHours}h old — full refresh required`);
          return { mode: 'full_refresh', reason: `Heartbeat stale (${ageHours}h old, threshold: 3h)` };
        }
      }
    }

    // Check 3: Sentinel symbol's 5m newest candle freshness (the real source of truth)
    const sentinel5mKey = exchangeCandleKey(this.exchangeId, sentinelSymbol, '5m');
    const newestEntries = await this.redis.zrange(sentinel5mKey, -1, -1, 'WITHSCORES');

    if (newestEntries.length < 2) {
      logger.warn({
        event: 'cache_trust_fail',
        exchangeId: this.exchangeId,
        check: 'sentinel_empty',
        sentinelSymbol,
      }, `Cache trust FAIL: sentinel ${sentinelSymbol} 5m cache is empty — full refresh required`);
      return { mode: 'full_refresh', reason: `Sentinel ${sentinelSymbol} 5m cache is empty` };
    }

    const newestTimestamp = parseInt(newestEntries[1], 10);
    const candleAge = now - newestTimestamp;

    if (candleAge > SENTINEL_5M_THRESHOLD_MS) {
      const ageMin = (candleAge / (60 * 1000)).toFixed(1);
      logger.warn({
        event: 'cache_trust_fail',
        exchangeId: this.exchangeId,
        check: 'sentinel_stale',
        sentinelSymbol,
        candleAge,
        ageMinutes: ageMin,
      }, `Cache trust FAIL: sentinel ${sentinelSymbol} 5m newest candle is ${ageMin}min old (threshold: 20min) — full refresh required`);
      return { mode: 'full_refresh', reason: `Sentinel ${sentinelSymbol} 5m is ${ageMin}min stale (threshold: 20min)` };
    }

    // All checks passed
    const ageMin = (candleAge / (60 * 1000)).toFixed(1);
    logger.info({
      event: 'cache_trust_pass',
      exchangeId: this.exchangeId,
      sentinelSymbol,
      sentinelAgeMin: ageMin,
    }, `Cache trust PASS: sentinel ${sentinelSymbol} 5m is ${ageMin}min old — targeted warmup`);

    return { mode: 'targeted', reason: `Cache trustworthy (sentinel ${sentinelSymbol} 5m: ${ageMin}min old)` };
  }

  /**
   * Dump all candle keys for this exchange.
   * Uses SCAN to find matching keys, then DEL in batches.
   *
   * Pattern: candles:{exchangeId}:*
   *
   * @returns Number of keys deleted
   */
  async dumpExchangeCandles(): Promise<number> {
    const pattern = `candles:${this.exchangeId}:*`;
    const keys = await this.redis.keys(pattern);
    const deletedCount = await deleteKeysClusterSafe(this.redis, keys);

    logger.info({
      event: 'candle_cache_dumped',
      exchangeId: this.exchangeId,
      keysDeleted: deletedCount,
      pattern,
    }, `Dumped ${deletedCount} candle keys for exchange ${this.exchangeId}`);

    return deletedCount;
  }
}
