import {
  getRedisClient,
  CandleCacheStrategy,
  IndicatorCacheStrategy,
  candleClosePattern,
  type CachedIndicatorValue,
} from '@livermore/cache';
import { createLogger, getCandleTimestamp, fillCandleGaps, calculateZeroRangeRatio, aggregateCandles } from '@livermore/utils';

// Create service-specific logger for file output
const logger = createLogger({ name: 'indicators:scheduler', service: 'indicators' });
import { classifyLiquidity, type Candle, type Timeframe, type LiquidityTier, type UnifiedCandle } from '@livermore/schemas';
import {
  macdVWithStage,
  MACD_V_DEFAULTS,
  type OHLCWithSynthetic,
} from '@livermore/indicators';
import type { Redis } from 'ioredis';

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
 * Event-driven service that calculates technical indicators from cached candle data.
 *
 * Architecture (v2.0):
 * - Subscribes to candle:close events via Redis psubscribe
 * - Reads 5m candles exclusively from Redis cache (no REST API calls)
 * - Aggregates 5m candles to higher timeframes (15m, 1h, 4h, 1d) in memory
 * - Caches calculated indicators in Redis and publishes updates
 *
 * Readiness: Requires 60+ candles before calculating (IND-03)
 * Warmup: Handled by separate startup backfill service (Phase 07)
 */
export class IndicatorCalculationService {
  private candleCache: CandleCacheStrategy;
  private indicatorCache: IndicatorCacheStrategy;
  private redis = getRedisClient();
  private subscriber: Redis | null = null;

  // Active calculation configs
  private configs: IndicatorConfig[] = [];

  // Symbol tracking by timeframe (for knowing which symbols are monitored)
  private configsByTimeframe: Map<Timeframe, IndicatorConfig[]> = new Map();
  private monitoredSymbols: Set<string> = new Set();

  // Track last processed boundary for each symbol/timeframe to detect higher timeframe closes
  private lastProcessedBoundary: Map<string, number> = new Map(); // key: "symbol:timeframe"

  // Temporary: hardcode test user and exchange IDs
  // TODO: Replace with actual user/exchange from database
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  // IND-03: Project requirement for TradingView alignment (60 candles minimum)
  private readonly REQUIRED_CANDLES = 60;

  // Higher timeframes to check when 5m candle closes
  private readonly HIGHER_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];

  // Number of 5m candles needed per target timeframe candle
  // Only includes timeframes used by this service (5m source + higher timeframes)
  private readonly AGGREGATION_FACTORS: Partial<Record<Timeframe, number>> = {
    '5m': 1,    // No aggregation needed
    '15m': 3,   // 3 x 5m = 15m
    '1h': 12,   // 12 x 5m = 1h
    '4h': 48,   // 48 x 5m = 4h
    '1d': 288,  // 288 x 5m = 1d
  };

  // NOTE: Constructor parameters kept for backward compatibility with existing server.ts
  // REST client functionality moved to Phase 07 (Startup Backfill)
  constructor(_apiKeyId: string, _privateKeyPem: string) {
    this.candleCache = new CandleCacheStrategy(this.redis);
    this.indicatorCache = new IndicatorCacheStrategy(this.redis);
  }

  /**
   * Build index of configs grouped by timeframe and tracked symbols
   */
  private buildConfigIndex(): void {
    this.configsByTimeframe.clear();
    this.monitoredSymbols.clear();

    for (const config of this.configs) {
      // Track by timeframe
      const existing = this.configsByTimeframe.get(config.timeframe) || [];
      existing.push(config);
      this.configsByTimeframe.set(config.timeframe, existing);

      // Track unique symbols
      this.monitoredSymbols.add(config.symbol);
    }
  }

  /**
   * Initialize boundary tracking for higher timeframes
   * Prevents immediate recalculation on first candle close after warmup
   */
  private initializeBoundaryTracking(): void {
    const now = Date.now();
    for (const symbol of this.monitoredSymbols) {
      for (const timeframe of this.HIGHER_TIMEFRAMES) {
        const key = `${symbol}:${timeframe}`;
        const boundary = getCandleTimestamp(now, timeframe);
        this.lastProcessedBoundary.set(key, boundary);
      }
    }
  }

  /**
   * Handle candle:close event from Redis pub/sub
   * Parses the channel to extract symbol and processes the candle
   */
  private async handleCandleCloseEvent(channel: string, message: string): Promise<void> {
    // Parse channel to extract symbol: "channel:candle:close:1:1:BTC-USD:5m"
    const parts = channel.split(':');
    const symbol = parts[4];
    const timeframe = parts[5] as Timeframe;

    // Only process monitored symbols
    if (!this.monitoredSymbols.has(symbol)) {
      return;
    }

    const candle = JSON.parse(message) as UnifiedCandle;
    logger.debug({ symbol, timeframe, timestamp: candle.timestamp }, 'Processing candle:close event');

    // Recalculate 5m indicator (cache-only)
    await this.recalculateFromCache(symbol, '5m');

    // Check and recalculate higher timeframes
    await this.checkHigherTimeframes(symbol, candle.timestamp);
  }

  /**
   * Recalculate indicators from cache only - no REST API calls
   * This is the hot path for event-driven indicator updates
   */
  private async recalculateFromCache(symbol: string, timeframe: Timeframe): Promise<void> {
    // Read from cache ONLY - no REST API calls
    const candles = await this.candleCache.getRecentCandles(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      symbol,
      timeframe,
      200
    );

    // Readiness gate: skip if insufficient candles (IND-03)
    if (candles.length < this.REQUIRED_CANDLES) {
      logger.debug({
        symbol,
        timeframe,
        available: candles.length,
        required: this.REQUIRED_CANDLES,
      }, 'Skipping indicator calculation - insufficient candles');
      return;
    }

    await this.calculateIndicators(symbol, timeframe, candles);
  }

  /**
   * Get candles for a target timeframe by aggregating cached 5m candles
   * This eliminates the need for REST API calls for higher timeframes
   *
   * @param symbol - Trading pair
   * @param targetTimeframe - Timeframe to aggregate to
   * @param requiredCount - Number of target timeframe candles needed
   * @returns Aggregated candles at target timeframe
   */
  private async getAggregatedCandles(
    symbol: string,
    targetTimeframe: Timeframe,
    requiredCount: number
  ): Promise<Candle[]> {
    // For 5m, just read directly from cache
    if (targetTimeframe === '5m') {
      return this.candleCache.getRecentCandles(
        this.TEST_USER_ID,
        this.TEST_EXCHANGE_ID,
        symbol,
        '5m',
        requiredCount
      );
    }

    // Calculate how many 5m candles we need
    const factor = this.AGGREGATION_FACTORS[targetTimeframe] || 1;
    // Need extra to ensure we get enough complete periods
    const sourceCount = (requiredCount + 1) * factor;

    // Read 5m candles from cache
    const sourceCandles = await this.candleCache.getRecentCandles(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      symbol,
      '5m',
      sourceCount
    );

    if (sourceCandles.length < factor) {
      // Not enough candles even for one complete period
      return [];
    }

    // Aggregate to target timeframe
    return aggregateCandles(sourceCandles, '5m', targetTimeframe);
  }

  /**
   * Recalculate indicator for a higher timeframe using aggregated 5m candles
   * This is the cache-only path for all higher timeframes
   */
  private async recalculateFromAggregated(symbol: string, timeframe: Timeframe): Promise<void> {
    // Get aggregated candles (builds from cached 5m data)
    const candles = await this.getAggregatedCandles(symbol, timeframe, 200);

    // Readiness gate
    if (candles.length < this.REQUIRED_CANDLES) {
      logger.debug({
        symbol,
        timeframe,
        available: candles.length,
        required: this.REQUIRED_CANDLES,
      }, 'Skipping higher timeframe calculation - insufficient aggregated candles');
      return;
    }

    logger.debug({
      symbol,
      timeframe,
      aggregatedCount: candles.length,
    }, 'Calculating indicator from aggregated candles');

    await this.calculateIndicators(symbol, timeframe, candles);
  }

  /**
   * Check if any higher timeframes closed and trigger recalculation
   * Uses aggregated 5m candles instead of REST API calls
   */
  private async checkHigherTimeframes(symbol: string, timestamp: number): Promise<void> {
    for (const timeframe of this.HIGHER_TIMEFRAMES) {
      const key = `${symbol}:${timeframe}`;
      const lastBoundary = this.lastProcessedBoundary.get(key) || 0;
      const currentBoundary = getCandleTimestamp(timestamp, timeframe);

      // Check if we've crossed into a new candle period
      if (currentBoundary > lastBoundary) {
        this.lastProcessedBoundary.set(key, currentBoundary);

        logger.info({
          event: 'boundary_crossing_detected',
          symbol,
          timeframe,
          previousBoundary: lastBoundary ? new Date(lastBoundary).toISOString() : 'none',
          newBoundary: new Date(currentBoundary).toISOString(),
        }, `Boundary crossed: ${symbol} ${timeframe}`);

        // Recalculate using aggregated candles (no REST calls)
        await this.recalculateFromAggregated(symbol, timeframe);
      }
    }
  }

  /**
   * Start the indicator calculation service
   * Subscribes to candle:close events via Redis psubscribe
   * NOTE: Warmup is handled by Phase 07 (Startup Backfill)
   */
  async start(configs: IndicatorConfig[]): Promise<void> {
    logger.info({ configCount: configs.length }, 'Starting Indicator Calculation Service');

    this.configs = configs;

    // Build index of configs by timeframe and tracked symbols
    this.buildConfigIndex();

    // Initialize boundary tracking for higher timeframes
    this.initializeBoundaryTracking();

    // Create dedicated subscriber (required for pub/sub mode)
    this.subscriber = this.redis.duplicate();

    // Subscribe to all 5m candle:close events
    const pattern = candleClosePattern(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, '*', '5m');
    await this.subscriber.psubscribe(pattern);

    // Handle pattern messages (pmessage for psubscribe, not message)
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      this.handleCandleCloseEvent(channel, message).catch((error) => {
        logger.error({ error, channel }, 'Error handling candle:close event');
      });
    });

    logger.info(
      {
        pattern,
        symbols: this.monitoredSymbols.size,
        timeframes: Array.from(this.configsByTimeframe.keys()),
      },
      'Indicator service subscribed to candle:close events'
    );
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    logger.info('Stopping Indicator Calculation Service');

    if (this.subscriber) {
      await this.subscriber.punsubscribe();
      await this.subscriber.quit();
      this.subscriber = null;
    }

    this.lastProcessedBoundary.clear();
    this.configsByTimeframe.clear();
    this.monitoredSymbols.clear();
  }

  /**
   * Calculate indicators for a set of candles
   */
  private async calculateIndicators(
    symbol: string,
    timeframe: Timeframe,
    candles: Candle[]
  ): Promise<void> {
    // Log candle source for debugging aggregation path
    const isAggregated = timeframe !== '5m';
    logger.debug({
      event: 'indicator_calculation_start',
      symbol,
      timeframe,
      candleCount: candles.length,
      source: isAggregated ? 'aggregated_5m' : 'cache_direct',
    }, `Calculating ${symbol} ${timeframe} from ${isAggregated ? 'aggregated' : 'cached'} candles`);

    // Fill gaps in sparse candle data (e.g., low-liquidity symbols)
    // This matches TradingView behavior and prevents ATR from being near-zero
    const { candles: filledCandles, stats } = fillCandleGaps(candles, timeframe);

    // Calculate liquidity classification based on gap ratio
    const liquidity: LiquidityTier = classifyLiquidity(stats.gapRatio);
    const zeroRangeRatio = calculateZeroRangeRatio(filledCandles);

    // Log gap-fill operation for debugging (always log for higher timeframes)
    logger.debug({
      event: 'candles_gap_filled',
      symbol,
      timeframe,
      originalCount: stats.originalCount,
      filledCount: stats.filledCount,
      syntheticCount: stats.syntheticCount,
      gapRatio: stats.gapRatio,
      gapRatioPercent: (stats.gapRatio * 100).toFixed(1) + '%',
      liquidity,
      zeroRangeRatio,
    }, `Gap-fill: ${symbol} ${timeframe} - ${stats.syntheticCount} synthetic of ${stats.filledCount} total`);

    // Convert to OHLC format with isSynthetic flag for indicators library
    // This allows informativeATR to skip synthetic candles in ATR calculation
    const ohlcBars: OHLCWithSynthetic[] = filledCandles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      isSynthetic: c.isSynthetic,
    }));

    // Calculate MACD-V using informativeATR (skips synthetic candles)
    const macdVResult = macdVWithStage(ohlcBars);

    if (!macdVResult) {
      logger.warn({ symbol, timeframe }, 'MACD-V calculation returned null');
      return;
    }

    // Log ATR seeding status for debugging
    logger.debug({
      event: 'atr_status',
      symbol,
      timeframe,
      seeded: macdVResult.seeded,
      nEff: macdVResult.nEff,
      spanBars: macdVResult.spanBars,
      reason: macdVResult.reason || null,
    }, `ATR status: ${symbol} ${timeframe} - seeded=${macdVResult.seeded}, nEff=${macdVResult.nEff}`);

    // Warning if not seeded
    if (!macdVResult.seeded) {
      logger.warn({
        event: 'atr_not_seeded',
        symbol,
        timeframe,
        nEff: macdVResult.nEff,
        spanBars: macdVResult.spanBars,
        reason: macdVResult.reason,
      }, `MACD-V not seeded: ${symbol} ${timeframe} - ${macdVResult.reason}`);
    }

    const latestCandle = filledCandles[filledCandles.length - 1];

    // Create cached indicator value with liquidity metadata
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
        // Liquidity metadata
        liquidity,
        gapRatio: stats.gapRatio,
        zeroRangeRatio,
        // Validity metadata (from informativeATR)
        seeded: macdVResult.seeded,
        nEff: macdVResult.nEff,
        spanBars: macdVResult.spanBars,
        reason: macdVResult.reason,
      },
    };

    // Cache the indicator
    await this.indicatorCache.setIndicator(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      indicatorValue
    );

    // Log cache write
    logger.info({
      event: 'indicator_cached',
      symbol,
      timeframe,
      source: isAggregated ? 'aggregated_5m' : 'cache_direct',
      timestamp: new Date(latestCandle.timestamp).toISOString(),
      macdV: Number.isNaN(macdVResult.macdV) ? null : macdVResult.macdV,
      signal: Number.isNaN(macdVResult.signal) ? null : macdVResult.signal,
      histogram: Number.isNaN(macdVResult.histogram) ? null : macdVResult.histogram,
      stage: macdVResult.stage,
      seeded: macdVResult.seeded,
      nEff: macdVResult.nEff,
      liquidity,
    }, `Cached: ${symbol} ${timeframe} MACD-V=${Number.isNaN(macdVResult.macdV) ? 'N/A' : macdVResult.macdV.toFixed(2)} stage=${macdVResult.stage}`);

    // Publish update
    await this.indicatorCache.publishUpdate(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      indicatorValue
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
   * Uses cache-only reads (no REST API calls)
   */
  async forceRecalculate(symbol: string, timeframe: Timeframe): Promise<void> {
    const config = this.configs.find(
      (c) => c.symbol === symbol && c.timeframe === timeframe
    );

    if (!config) {
      // Add to configs if not exists
      this.configs.push({ symbol, timeframe });
      this.monitoredSymbols.add(symbol);
    }

    await this.recalculateFromCache(symbol, timeframe);
  }
}
