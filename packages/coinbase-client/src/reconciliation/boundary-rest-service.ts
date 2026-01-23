import type { Redis } from 'ioredis';
import type { Timeframe, UnifiedCandle } from '@livermore/schemas';
import { CandleCacheStrategy, candleClosePattern } from '@livermore/cache';
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
  private subscriber: Redis;
  private config: BoundaryRestConfig;
  private symbols: string[] = [];
  private isRunning = false;

  constructor(
    apiKeyId: string,
    privateKeyPem: string,
    redis: Redis,
    subscriberRedis: Redis, // Separate connection for psubscribe
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

      // Detect which higher timeframe boundaries this 5m close aligns with
      const boundaries = detectBoundaries(timestamp, this.config.higherTimeframes);
      const triggeredBoundaries = boundaries.filter(b => b.triggered);

      if (triggeredBoundaries.length === 0) {
        return; // No boundaries triggered, nothing to do
      }

      logger.info({
        event: 'boundary_triggered',
        timestamp: new Date(timestamp).toISOString(),
        timeframes: triggeredBoundaries.map(b => b.timeframe),
        triggerSymbol: candle.symbol,
      }, `Boundary triggered for ${triggeredBoundaries.length} timeframe(s)`);

      // Fetch higher timeframe candles for ALL symbols at this boundary
      await this.fetchHigherTimeframes(triggeredBoundaries.map(b => b.timeframe));
    } catch (error) {
      logger.error({ error }, 'Error handling candle close in BoundaryRestService');
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

    // Get the most recent candle (REST returns oldest first, so last is newest)
    const latestCandle = candles[candles.length - 1];

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
