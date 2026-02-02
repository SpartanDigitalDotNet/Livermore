import type { Timeframe, UnifiedCandle } from '@livermore/schemas';
import { CandleCacheStrategy, candleClosePattern, type RedisClient } from '@livermore/cache';
import { logger } from '@livermore/utils';
import { CoinbaseRestClient } from '../rest/client';
import { BoundaryRestConfig, DEFAULT_BOUNDARY_CONFIG } from './types';
import { detectBoundaries } from './boundary-detector';

/**
 * Event-driven service for fetching higher timeframe candles at boundaries
 *
 * This service listens to 5m candle:close events from WebSocket and detects
 * when those closes align with higher timeframe boundaries (15m, 1h, 4h, 1d).
 * When a boundary is detected, it fires rate-limited REST calls to fetch
 * fresh candles for all symbols at those timeframes.
 *
 * Architecture:
 * - Event-driven (triggered by WebSocket candle close, NOT cron-scheduled)
 * - No aggregation (each timeframe fetched directly from Coinbase REST API)
 * - Rate limiting (5 req/batch, 1s delay) prevents 429 errors
 *
 * Expected traffic for 100 symbols:
 * - 15m: ~100 calls every 15 min = 400/hour
 * - 1h: ~100 calls every hour = 100/hour
 * - 4h: ~100 calls every 4 hours = 25/hour
 * - 1d: ~100 calls every day = ~4/hour
 * Total: ~12,700 calls/day (~8.8 calls/minute average)
 */
export class BoundaryRestService {
  private restClient: CoinbaseRestClient;
  private candleCache: CandleCacheStrategy;
  private subscriber: RedisClient;
  private config: BoundaryRestConfig;
  private symbols: string[] = [];
  private isRunning = false;

  // Track boundaries that have already been triggered to prevent duplicate fetches
  // Key format: `${timestamp}-${timeframe}` (e.g., "1706140800000-15m")
  private triggeredBoundaries = new Set<string>();
  private readonly BOUNDARY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Only process candles from the last 10 minutes (ignore historical snapshot candles)
  private readonly MAX_CANDLE_AGE_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    apiKeyId: string,
    privateKeyPem: string,
    redis: RedisClient,
    subscriberRedis: RedisClient, // Separate connection for psubscribe
    config: Partial<BoundaryRestConfig> = {}
  ) {
    this.restClient = new CoinbaseRestClient(apiKeyId, privateKeyPem);
    this.candleCache = new CandleCacheStrategy(redis);
    this.subscriber = subscriberRedis;
    this.config = { ...DEFAULT_BOUNDARY_CONFIG, ...config };
  }

  /**
   * Start listening for 5m candle close events
   *
   * @param symbols - Array of trading symbols to fetch at boundaries
   */
  async start(symbols: string[]): Promise<void> {
    this.symbols = symbols;
    this.isRunning = true;

    // Subscribe to 5m candle:close events for all symbols using pattern
    const pattern = candleClosePattern(
      this.config.userId,
      this.config.exchangeId,
      '*', // Wildcard for all symbols
      '5m'
    );

    this.subscriber.on('pmessage', this.handleCandleClose.bind(this));
    await this.subscriber.psubscribe(pattern);

    logger.info({
      event: 'boundary_rest_service_started',
      symbols: symbols.length,
      higherTimeframes: this.config.higherTimeframes,
      pattern,
    }, 'BoundaryRestService started');
  }

  /**
   * Stop listening and cleanup
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    await this.subscriber.punsubscribe();
    logger.info({ event: 'boundary_rest_service_stopped' }, 'BoundaryRestService stopped');
  }

  /**
   * Handle incoming 5m candle close events
   *
   * Detects boundary alignment and triggers REST fetches for higher timeframes.
   * Only processes one candle close per boundary (first received triggers fetch).
   * Uses deduplication to prevent multiple symbols at the same boundary from
   * all triggering separate fetches.
   */
  private async handleCandleClose(
    _pattern: string,
    _channel: string,
    message: string
  ): Promise<void> {
    if (!this.isRunning) return;

    try {
      const candle = JSON.parse(message) as UnifiedCandle;
      const timestamp = candle.timestamp;
      const now = Date.now();

      // Log received candle close event
      logger.info({
        event: 'boundary_candle_received',
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        timestamp: new Date(timestamp).toISOString(),
        ageMs: now - timestamp,
      }, `Received candle:close for ${candle.symbol} (${candle.timeframe})`);

      // Skip historical candles from WebSocket snapshot (only process recent candles)
      const candleAge = now - timestamp;
      if (candleAge > this.MAX_CANDLE_AGE_MS) {
        logger.info({
          event: 'boundary_candle_skipped_age',
          symbol: candle.symbol,
          ageMs: candleAge,
          maxAgeMs: this.MAX_CANDLE_AGE_MS,
        }, `Skipping candle:close (too old)`);
        return; // Historical candle from snapshot, ignore for boundary triggers
      }

      // Detect which higher timeframe boundaries this 5m close aligns with
      const boundaries = detectBoundaries(timestamp, this.config.higherTimeframes);
      const triggeredBoundaries = boundaries.filter(b => b.triggered);

      if (triggeredBoundaries.length === 0) {
        return; // No boundaries triggered, nothing to do
      }

      // Filter out boundaries we've already triggered (deduplication)
      const newBoundaries = triggeredBoundaries.filter(b => {
        const key = `${timestamp}-${b.timeframe}`;
        if (this.triggeredBoundaries.has(key)) {
          logger.debug({
            event: 'boundary_dedup_skip',
            symbol: candle.symbol,
            timestamp: new Date(timestamp).toISOString(),
            timeframe: b.timeframe,
            key,
          }, 'Skipping duplicate boundary trigger');
          return false; // Already triggered, skip
        }
        this.triggeredBoundaries.add(key);
        return true;
      });

      if (newBoundaries.length === 0) {
        return; // All boundaries already triggered by another symbol
      }

      // Cleanup old boundary keys periodically (keep last 5 minutes)
      this.cleanupOldBoundaries(timestamp);

      logger.info({
        event: 'boundary_triggered',
        timestamp: new Date(timestamp).toISOString(),
        timeframes: newBoundaries.map(b => b.timeframe),
        triggerSymbol: candle.symbol,
      }, `Boundary triggered for ${newBoundaries.length} timeframe(s)`);

      // Fetch higher timeframe candles for ALL symbols at this boundary
      await this.fetchHigherTimeframes(newBoundaries.map(b => b.timeframe));
    } catch (error) {
      logger.error({ error }, 'Error handling candle close in BoundaryRestService');
    }
  }

  /**
   * Remove boundary keys older than cleanup interval to prevent memory leak
   */
  private cleanupOldBoundaries(currentTimestamp: number): void {
    const cutoff = currentTimestamp - this.BOUNDARY_CLEANUP_INTERVAL_MS;
    for (const key of this.triggeredBoundaries) {
      const [timestampStr] = key.split('-');
      if (Number.parseInt(timestampStr, 10) < cutoff) {
        this.triggeredBoundaries.delete(key);
      }
    }
  }

  /**
   * Fetch candles for all symbols at the given timeframes
   *
   * Uses batch processing with rate limiting to avoid 429 errors:
   * - 5 requests per batch
   * - 1 second delay between batches
   * (Same pattern as StartupBackfillService)
   */
  private async fetchHigherTimeframes(timeframes: Timeframe[]): Promise<void> {
    // Build task list: all symbol/timeframe combinations
    const tasks: Array<{ symbol: string; timeframe: Timeframe }> = [];
    for (const timeframe of timeframes) {
      for (const symbol of this.symbols) {
        tasks.push({ symbol, timeframe });
      }
    }

    logger.info({
      event: 'boundary_fetch_start',
      taskCount: tasks.length,
      timeframes,
      symbols: this.symbols.length,
    }, `Fetching ${tasks.length} candles at boundary`);

    const startTime = Date.now();
    let completed = 0;
    let errors = 0;

    // Process in batches with rate limiting (same pattern as StartupBackfillService)
    for (let i = 0; i < tasks.length; i += this.config.batchSize) {
      const batch = tasks.slice(i, i + this.config.batchSize);

      const results = await Promise.allSettled(
        batch.map(task => this.fetchAndCache(task.symbol, task.timeframe))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          completed++;
        } else {
          errors++;
          logger.warn({ error: result.reason }, 'Boundary fetch failed');
        }
      }

      // Sleep before next batch (skip on last batch)
      if (i + this.config.batchSize < tasks.length) {
        await this.sleep(this.config.batchDelayMs);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info({
      event: 'boundary_fetch_complete',
      completed,
      errors,
      total: tasks.length,
      elapsedSec: elapsed,
    }, `Boundary fetch complete: ${completed}/${tasks.length} in ${elapsed}s`);
  }

  /**
   * Fetch most recent candle for symbol/timeframe and write to cache
   */
  private async fetchAndCache(symbol: string, timeframe: Timeframe): Promise<void> {
    // Fetch most recent candles for this timeframe (no start/end = most recent)
    const candles = await this.restClient.getCandles(symbol, timeframe);

    if (candles.length === 0) {
      logger.warn({ symbol, timeframe }, 'No candles returned from REST');
      return;
    }

    // Get the most recent candle (REST returns newest first, so first is newest)
    const latestCandle = candles[0];

    // Write to cache using versioned writes
    const unified: UnifiedCandle = {
      ...latestCandle,
      exchange: 'coinbase',
    };

    await this.candleCache.addCandleIfNewer(
      this.config.userId,
      this.config.exchangeId,
      unified
    );

    logger.debug({
      symbol,
      timeframe,
      timestamp: new Date(latestCandle.timestamp).toISOString(),
    }, 'Cached higher timeframe candle');
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
