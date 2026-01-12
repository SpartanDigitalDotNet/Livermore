import { CoinbaseRestClient } from '@livermore/coinbase-client';
import {
  getRedisClient,
  CandleCacheStrategy,
  IndicatorCacheStrategy,
  type CachedIndicatorValue,
} from '@livermore/cache';
import { logger, getCandleTimestamp, timeframeToMs } from '@livermore/utils';
import type { Candle, Timeframe } from '@livermore/schemas';
import {
  macdVWithStage,
  macdVMinBars,
  MACD_V_DEFAULTS,
  type OHLC,
} from '@livermore/indicators';

/**
 * Configuration for a symbol/timeframe pair to calculate indicators for
 */
export interface IndicatorConfig {
  symbol: string;
  timeframe: Timeframe;
}

/**
 * Indicator Calculation Service
 *
 * Fetches historical candle data, calculates technical indicators,
 * caches results in Redis, and publishes updates.
 */
export class IndicatorCalculationService {
  private restClient: CoinbaseRestClient;
  private candleCache: CandleCacheStrategy;
  private indicatorCache: IndicatorCacheStrategy;
  private redis = getRedisClient();

  // Active calculation configs
  private configs: IndicatorConfig[] = [];

  // Boundary-aware scheduling
  private tickTimer: NodeJS.Timeout | null = null;
  private lastProcessedBoundary: Map<Timeframe, number> = new Map();
  private configsByTimeframe: Map<Timeframe, IndicatorConfig[]> = new Map();

  // Temporary: hardcode test user and exchange IDs
  // TODO: Replace with actual user/exchange from database
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  // Calculation settings
  private readonly MIN_CANDLES_FOR_MACDV = macdVMinBars(); // ~35 candles
  private readonly TICK_INTERVAL_MS = 10000; // 10 seconds
  private readonly BOUNDARY_OFFSETS: Record<Timeframe, number> = {
    '1m': 1000,    // 1 second after close
    '5m': 3000,
    '15m': 5000,
    '30m': 5000,
    '1h': 10000,
    '2h': 10000,
    '4h': 15000,
    '6h': 15000,
    '1d': 30000,   // 30 seconds for daily
  };

  // Rate limiting settings to avoid Coinbase API throttling
  private readonly BATCH_SIZE = 5; // Requests per batch (reduced to avoid rate limits)
  private readonly BATCH_DELAY_MS = 1000; // Delay between batches

  // Priority symbols - loaded first for faster startup
  private readonly PRIORITY_SYMBOLS = [
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD',
    'ADA-USD', 'AVAX-USD', 'LINK-USD', 'DOT-USD', 'MATIC-USD',
  ];

  constructor(apiKeyId: string, privateKeyPem: string) {
    this.restClient = new CoinbaseRestClient(apiKeyId, privateKeyPem);
    this.candleCache = new CandleCacheStrategy(this.redis);
    this.indicatorCache = new IndicatorCacheStrategy(this.redis);
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Process configs in batches with delays to avoid rate limiting
   */
  private async processBatched<T>(
    items: T[],
    processor: (item: T) => Promise<void>,
    label: string
  ): Promise<void> {
    const total = items.length;
    let processed = 0;

    for (let i = 0; i < items.length; i += this.BATCH_SIZE) {
      const batch = items.slice(i, i + this.BATCH_SIZE);

      // Process batch in parallel
      await Promise.all(
        batch.map((item) =>
          processor(item).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            logger.error({ err: message, item }, `Failed to process ${label}`);
          })
        )
      );

      processed += batch.length;
      logger.info({ processed, total, label }, 'Batch complete');

      // Delay before next batch (skip delay after last batch)
      if (i + this.BATCH_SIZE < items.length) {
        await this.sleep(this.BATCH_DELAY_MS);
      }
    }
  }

  /**
   * Build index of configs grouped by timeframe
   */
  private buildConfigIndex(): void {
    this.configsByTimeframe.clear();
    for (const config of this.configs) {
      const existing = this.configsByTimeframe.get(config.timeframe) || [];
      existing.push(config);
      this.configsByTimeframe.set(config.timeframe, existing);
    }
  }

  /**
   * Initialize boundary tracking to prevent immediate triggers on startup
   */
  private initializeBoundaryTracking(): void {
    const now = Date.now();
    for (const timeframe of this.configsByTimeframe.keys()) {
      const boundary = getCandleTimestamp(now, timeframe);
      this.lastProcessedBoundary.set(timeframe, boundary);
    }
  }

  /**
   * Main tick handler - checks for candle boundary crossings
   * Only triggers recalculation when a timeframe's candle closes
   */
  private async onTick(): Promise<void> {
    const now = Date.now();
    const timeframesToUpdate: Timeframe[] = [];

    for (const [timeframe, lastBoundary] of this.lastProcessedBoundary.entries()) {
      const currentBoundary = getCandleTimestamp(now, timeframe);

      // Check if we've crossed into a new candle period
      if (currentBoundary > lastBoundary) {
        const offset = this.BOUNDARY_OFFSETS[timeframe] || 1000;
        // Wait for offset after boundary before triggering (data propagation delay)
        if ((now - currentBoundary) >= offset) {
          timeframesToUpdate.push(timeframe);
          this.lastProcessedBoundary.set(timeframe, currentBoundary);
          logger.info(
            { timeframe, boundary: new Date(currentBoundary).toISOString() },
            'Candle boundary crossed'
          );
        }
      }
    }

    // Process all timeframes that crossed boundaries in parallel
    await Promise.all(
      timeframesToUpdate.map((tf) => this.recalculateTimeframe(tf))
    );
  }

  /**
   * Recalculate indicators for all symbols in a single timeframe
   */
  private async recalculateTimeframe(timeframe: Timeframe): Promise<void> {
    const configs = this.configsByTimeframe.get(timeframe);
    if (!configs || configs.length === 0) return;

    logger.info(
      { timeframe, symbolCount: configs.length },
      'Starting timeframe recalculation'
    );

    await this.processBatched(
      configs,
      (config) => this.recalculateForConfig(config),
      `${timeframe} recalculation`
    );
  }

  /**
   * Start the indicator calculation service
   */
  async start(configs: IndicatorConfig[]): Promise<void> {
    logger.info({ configCount: configs.length }, 'Starting Indicator Calculation Service');

    this.configs = configs;

    // Build index of configs by timeframe
    this.buildConfigIndex();

    // Initialize boundary tracking (prevents immediate trigger on startup)
    this.initializeBoundaryTracking();

    // Initial data fetch and calculation for all configs
    await this.initializeAllConfigs();

    // Start tick-based boundary detection
    this.tickTimer = setInterval(
      () => this.onTick(),
      this.TICK_INTERVAL_MS
    );

    logger.info(
      { timeframes: Array.from(this.configsByTimeframe.keys()) },
      'Indicator Calculation Service started with boundary-aware scheduling'
    );
  }

  /**
   * Stop the service
   */
  stop(): void {
    logger.info('Stopping Indicator Calculation Service');

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.lastProcessedBoundary.clear();
    this.configsByTimeframe.clear();
  }

  /**
   * Initialize all configured symbol/timeframe pairs
   * Prioritizes major symbols first, then batches remaining to avoid rate limits
   */
  private async initializeAllConfigs(): Promise<void> {
    // Separate priority configs from the rest
    const priorityConfigs = this.configs.filter((c) =>
      this.PRIORITY_SYMBOLS.includes(c.symbol)
    );
    const remainingConfigs = this.configs.filter(
      (c) => !this.PRIORITY_SYMBOLS.includes(c.symbol)
    );

    logger.info(
      { priority: priorityConfigs.length, remaining: remainingConfigs.length },
      'Initializing indicators with prioritization'
    );

    // Load priority symbols first (still batched to avoid rate limits)
    if (priorityConfigs.length > 0) {
      logger.info('Loading priority symbols...');
      await this.processBatched(
        priorityConfigs,
        (config) => this.initializeConfig(config),
        'priority initialization'
      );
      logger.info('Priority symbols loaded');
    }

    // Load remaining symbols in batches
    if (remainingConfigs.length > 0) {
      logger.info('Loading remaining symbols...');
      await this.processBatched(
        remainingConfigs,
        (config) => this.initializeConfig(config),
        'remaining initialization'
      );
    }
  }

  /**
   * Initialize a single symbol/timeframe pair
   * Fetches historical data and calculates initial indicators
   */
  private async initializeConfig(config: IndicatorConfig): Promise<void> {
    const { symbol, timeframe } = config;

    logger.info({ symbol, timeframe }, 'Initializing indicator calculation');

    // Fetch historical candles from Coinbase
    const candles = await this.fetchHistoricalCandles(symbol, timeframe);

    if (candles.length < this.MIN_CANDLES_FOR_MACDV) {
      // Silently skip sparse symbols (design decision: no warning for low-volume tokens)
      return;
    }

    // Cache candles
    await this.candleCache.addCandles(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, candles);

    // Calculate and cache indicators
    await this.calculateIndicators(symbol, timeframe, candles);

    logger.info(
      { symbol, timeframe, candleCount: candles.length },
      'Indicator initialization complete'
    );
  }

  /**
   * Fetch historical candles from Coinbase REST API (for initial load)
   */
  private async fetchHistoricalCandles(
    symbol: string,
    timeframe: Timeframe
  ): Promise<Candle[]> {
    try {
      // Calculate time range - fetch enough candles for indicator calculation
      const now = Date.now();
      const candlesNeeded = this.MIN_CANDLES_FOR_MACDV + 50; // Extra buffer

      // Calculate start time based on timeframe
      const timeframeMs = timeframeToMs(timeframe);
      const start = now - candlesNeeded * timeframeMs;

      logger.debug(
        { symbol, timeframe, start: new Date(start).toISOString(), candlesNeeded },
        'Fetching historical candles'
      );

      const candles = await this.restClient.getCandles(symbol, timeframe, start, now);

      // Sort by timestamp ascending (oldest first)
      candles.sort((a, b) => a.timestamp - b.timestamp);

      logger.debug(
        { symbol, timeframe, fetchedCount: candles.length },
        'Fetched historical candles'
      );

      return candles;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, symbol, timeframe }, 'Failed to fetch historical candles');
      throw err;
    }
  }

  /**
   * Fetch only recent candles from Coinbase REST API (for incremental updates)
   * Only fetches the last few candles to append to cache
   */
  private async fetchRecentCandles(
    symbol: string,
    timeframe: Timeframe,
    count: number = 3
  ): Promise<Candle[]> {
    try {
      const now = Date.now();
      const timeframeMs = timeframeToMs(timeframe);
      // Fetch a few extra to ensure we get the most recent closed candle
      const start = now - (count + 1) * timeframeMs;

      const candles = await this.restClient.getCandles(symbol, timeframe, start, now);

      // Sort by timestamp ascending (oldest first)
      candles.sort((a, b) => a.timestamp - b.timestamp);

      return candles;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, symbol, timeframe }, 'Failed to fetch recent candles');
      throw err;
    }
  }

  /**
   * Recalculate indicators for a single config
   * Incrementally fetches only recent candles and appends to cache
   */
  private async recalculateForConfig(config: IndicatorConfig): Promise<void> {
    const { symbol, timeframe } = config;

    try {
      // Only fetch the last few candles (not full history)
      const recentCandles = await this.fetchRecentCandles(symbol, timeframe, 3);

      if (recentCandles.length > 0) {
        // Append new candles to cache (deduplicates by timestamp)
        await this.candleCache.addCandles(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, recentCandles);
      }

      // Get full history from cache for indicator calculation
      const cachedCandles = await this.candleCache.getRecentCandles(
        this.TEST_USER_ID,
        this.TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        200 // Enough for indicator calculation
      );

      if (cachedCandles.length < this.MIN_CANDLES_FOR_MACDV) {
        // Not enough cached data - skip silently
        return;
      }

      // Calculate indicators from cached data
      await this.calculateIndicators(symbol, timeframe, cachedCandles);

    } catch (err) {
      // If fetch fails, try calculating from existing cache
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, symbol, timeframe }, 'Recent candle fetch failed, using cached data');

      const cachedCandles = await this.candleCache.getRecentCandles(
        this.TEST_USER_ID,
        this.TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        200
      );

      if (cachedCandles.length >= this.MIN_CANDLES_FOR_MACDV) {
        await this.calculateIndicators(symbol, timeframe, cachedCandles);
      }
    }
  }

  /**
   * Calculate indicators for a set of candles
   */
  private async calculateIndicators(
    symbol: string,
    timeframe: Timeframe,
    candles: Candle[]
  ): Promise<void> {
    // Convert to OHLC format for indicators library
    const ohlcBars: OHLC[] = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // Calculate MACD-V
    const macdVResult = macdVWithStage(ohlcBars);

    if (!macdVResult) {
      logger.warn({ symbol, timeframe }, 'MACD-V calculation returned null');
      return;
    }

    const latestCandle = candles[candles.length - 1];

    // Create cached indicator value
    const indicatorValue: CachedIndicatorValue = {
      timestamp: latestCandle.timestamp,
      type: 'macd-v',
      symbol,
      timeframe,
      value: {
        macdV: macdVResult.macdV,
        signal: macdVResult.signal,
        histogram: macdVResult.histogram,
        fastEMA: macdVResult.fastEMA,
        slowEMA: macdVResult.slowEMA,
        atr: macdVResult.atr,
      },
      params: {
        fastPeriod: MACD_V_DEFAULTS.fastPeriod,
        slowPeriod: MACD_V_DEFAULTS.slowPeriod,
        atrPeriod: MACD_V_DEFAULTS.atrPeriod,
        signalPeriod: MACD_V_DEFAULTS.signalPeriod,
        stage: macdVResult.stage,
      },
    };

    // Cache the indicator
    await this.indicatorCache.setIndicator(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      indicatorValue
    );

    // Publish update
    await this.indicatorCache.publishUpdate(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      indicatorValue
    );

    logger.debug(
      {
        symbol,
        timeframe,
        macdV: macdVResult.macdV.toFixed(2),
        signal: macdVResult.signal.toFixed(2),
        histogram: macdVResult.histogram.toFixed(2),
        stage: macdVResult.stage,
      },
      'MACD-V calculated'
    );
  }

  /**
   * Get current indicator value for a symbol/timeframe
   */
  async getIndicator(
    symbol: string,
    timeframe: Timeframe,
    type: string = 'macd-v'
  ): Promise<CachedIndicatorValue | null> {
    return this.indicatorCache.getIndicator(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      symbol,
      timeframe,
      type
    );
  }

  /**
   * Force recalculation for a specific symbol/timeframe
   */
  async forceRecalculate(symbol: string, timeframe: Timeframe): Promise<void> {
    const config = this.configs.find(
      (c) => c.symbol === symbol && c.timeframe === timeframe
    );

    if (!config) {
      // Add to configs if not exists
      this.configs.push({ symbol, timeframe });
    }

    await this.initializeConfig({ symbol, timeframe });
  }
}
