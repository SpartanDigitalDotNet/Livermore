import { CoinbaseRestClient } from '@livermore/coinbase-client';
import {
  getRedisClient,
  CandleCacheStrategy,
  IndicatorCacheStrategy,
  type CachedIndicatorValue,
} from '@livermore/cache';
import { logger } from '@livermore/utils';
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
  private calculationInterval: NodeJS.Timeout | null = null;

  // Temporary: hardcode test user and exchange IDs
  // TODO: Replace with actual user/exchange from database
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  // Calculation settings
  private readonly CALCULATION_INTERVAL_MS = 60000; // Recalculate every minute
  private readonly MIN_CANDLES_FOR_MACDV = macdVMinBars(); // ~35 candles

  constructor(apiKeyId: string, privateKeyPem: string) {
    this.restClient = new CoinbaseRestClient(apiKeyId, privateKeyPem);
    this.candleCache = new CandleCacheStrategy(this.redis);
    this.indicatorCache = new IndicatorCacheStrategy(this.redis);
  }

  /**
   * Start the indicator calculation service
   */
  async start(configs: IndicatorConfig[]): Promise<void> {
    logger.info({ configs }, 'Starting Indicator Calculation Service');

    this.configs = configs;

    // Initial data fetch and calculation for all configs
    await this.initializeAllConfigs();

    // Start periodic recalculation
    this.calculationInterval = setInterval(
      () => this.recalculateAll(),
      this.CALCULATION_INTERVAL_MS
    );

    logger.info('Indicator Calculation Service started');
  }

  /**
   * Stop the service
   */
  stop(): void {
    logger.info('Stopping Indicator Calculation Service');

    if (this.calculationInterval) {
      clearInterval(this.calculationInterval);
      this.calculationInterval = null;
    }
  }

  /**
   * Initialize all configured symbol/timeframe pairs
   */
  private async initializeAllConfigs(): Promise<void> {
    const promises = this.configs.map((config) =>
      this.initializeConfig(config).catch((error) => {
        logger.error({ error, config }, 'Failed to initialize indicator config');
      })
    );

    await Promise.all(promises);
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
      logger.warn(
        { symbol, timeframe, candleCount: candles.length, required: this.MIN_CANDLES_FOR_MACDV },
        'Insufficient candles for MACD-V calculation'
      );
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
   * Fetch historical candles from Coinbase REST API
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
      const timeframeMs = this.timeframeToMs(timeframe);
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
    } catch (error) {
      logger.error({ error, symbol, timeframe }, 'Failed to fetch historical candles');
      throw error;
    }
  }

  /**
   * Recalculate indicators for all configs
   */
  private async recalculateAll(): Promise<void> {
    logger.debug('Recalculating all indicators');

    const promises = this.configs.map((config) =>
      this.recalculateForConfig(config).catch((error) => {
        logger.error({ error, config }, 'Failed to recalculate indicators');
      })
    );

    await Promise.all(promises);
  }

  /**
   * Recalculate indicators for a single config
   */
  private async recalculateForConfig(config: IndicatorConfig): Promise<void> {
    const { symbol, timeframe } = config;

    // Get cached candles
    const candles = await this.candleCache.getRecentCandles(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      symbol,
      timeframe,
      200 // Get recent candles
    );

    if (candles.length < this.MIN_CANDLES_FOR_MACDV) {
      // Try to fetch more candles from Coinbase
      const freshCandles = await this.fetchHistoricalCandles(symbol, timeframe);
      await this.candleCache.addCandles(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, freshCandles);

      if (freshCandles.length >= this.MIN_CANDLES_FOR_MACDV) {
        await this.calculateIndicators(symbol, timeframe, freshCandles);
      }
      return;
    }

    await this.calculateIndicators(symbol, timeframe, candles);
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

  /**
   * Convert timeframe to milliseconds
   */
  private timeframeToMs(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    return map[timeframe];
  }
}
