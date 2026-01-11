import { z } from 'zod';
import { router, publicProcedure } from '@livermore/trpc-config';
import {
  TimeframeSchema,
  deriveZone,
  deriveCrossover,
  deriveScalpingBias,
  detectDivergence,
  type MacdVStage,
} from '@livermore/schemas';
import { getRedisClient, IndicatorCacheStrategy, CandleCacheStrategy } from '@livermore/cache';
import {
  macdVWithStage,
  macdV,
  MACD_V_DEFAULTS,
  type OHLC,
} from '@livermore/indicators';

// Service instances (will be injected later or use singletons)
const redis = getRedisClient();
const indicatorCache = new IndicatorCacheStrategy(redis);
const candleCache = new CandleCacheStrategy(redis);

// Hardcoded for now - will be replaced with auth
const TEST_USER_ID = 1;
const TEST_EXCHANGE_ID = 1;

/**
 * Input schema for getting indicator values
 */
const GetIndicatorInput = z.object({
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
  type: z.string().default('macd-v'),
});

/**
 * Input schema for MACD-V query
 */
const GetMACDVInput = z.object({
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
});

/**
 * Input schema for calculating from candles
 */
const CalculateFromCandlesInput = z.object({
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
  limit: z.number().int().positive().max(500).default(100),
});

/**
 * Input schema for MACD-V analysis with zone, bias, and histogram series
 */
const GetAnalysisInput = z.object({
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
  /** Number of histogram values to return (default: 5) */
  histogramCount: z.number().int().positive().max(50).default(5),
});

/**
 * Indicator Router
 *
 * Provides endpoints for querying technical indicator values.
 */
export const indicatorRouter = router({
  /**
   * Get the current cached indicator value
   */
  getCurrent: publicProcedure
    .input(GetIndicatorInput)
    .query(async ({ input }) => {
      const { symbol, timeframe, type } = input;

      const indicator = await indicatorCache.getIndicator(
        TEST_USER_ID,
        TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        type
      );

      if (!indicator) {
        return {
          success: false,
          error: 'Indicator not found in cache',
          data: null,
        };
      }

      return {
        success: true,
        error: null,
        data: indicator,
      };
    }),

  /**
   * Get MACD-V with stage classification
   */
  getMACDV: publicProcedure
    .input(GetMACDVInput)
    .query(async ({ input }) => {
      const { symbol, timeframe } = input;

      const indicator = await indicatorCache.getIndicator(
        TEST_USER_ID,
        TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        'macd-v'
      );

      if (!indicator) {
        return {
          success: false,
          error: 'MACD-V not found in cache',
          data: null,
        };
      }

      return {
        success: true,
        error: null,
        data: {
          symbol,
          timeframe,
          timestamp: indicator.timestamp,
          macdV: indicator.value['macdV'],
          signal: indicator.value['signal'],
          histogram: indicator.value['histogram'],
          fastEMA: indicator.value['fastEMA'],
          slowEMA: indicator.value['slowEMA'],
          atr: indicator.value['atr'],
          stage: indicator.params?.['stage'] || 'unknown',
        },
      };
    }),

  /**
   * Calculate MACD-V from cached candles
   * Useful for getting fresh calculations
   */
  calculateMACDV: publicProcedure
    .input(CalculateFromCandlesInput)
    .query(async ({ input }) => {
      const { symbol, timeframe, limit } = input;

      // Get candles from cache
      const candles = await candleCache.getRecentCandles(
        TEST_USER_ID,
        TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        limit
      );

      if (candles.length < 35) {
        return {
          success: false,
          error: `Insufficient candles: ${candles.length} (need at least 35)`,
          data: null,
        };
      }

      // Convert to OHLC format
      const ohlcBars: OHLC[] = candles.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // Calculate MACD-V
      const result = macdVWithStage(ohlcBars);

      if (!result) {
        return {
          success: false,
          error: 'MACD-V calculation failed',
          data: null,
        };
      }

      return {
        success: true,
        error: null,
        data: {
          symbol,
          timeframe,
          timestamp: candles[candles.length - 1].timestamp,
          macdV: result.macdV,
          signal: result.signal,
          histogram: result.histogram,
          fastEMA: result.fastEMA,
          slowEMA: result.slowEMA,
          atr: result.atr,
          stage: result.stage,
          candleCount: candles.length,
        },
      };
    }),

  /**
   * Get full MACD-V analysis with zone, scalping bias, crossover, and histogram series
   * This is the primary endpoint for scalping decisions
   */
  getAnalysis: publicProcedure
    .input(GetAnalysisInput)
    .query(async ({ input }) => {
      const { symbol, timeframe, histogramCount } = input;

      // Get enough candles for calculation + histogram history
      const candleLimit = Math.max(100, histogramCount + 50);
      const candles = await candleCache.getRecentCandles(
        TEST_USER_ID,
        TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        candleLimit
      );

      if (candles.length < 35) {
        return {
          success: false,
          error: `Insufficient candles: ${candles.length} (need at least 35)`,
          data: null,
        };
      }

      // Convert to OHLC format
      const ohlcBars: OHLC[] = candles.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // Calculate full series for histogram history
      const series = macdV(ohlcBars);

      // Get latest values with stage
      const latest = macdVWithStage(ohlcBars);
      if (!latest) {
        return {
          success: false,
          error: 'MACD-V calculation failed',
          data: null,
        };
      }

      // Build histogram series (most recent N values)
      const validHistograms: { timestamp: number; value: number }[] = [];
      for (let i = candles.length - 1; i >= 0 && validHistograms.length < histogramCount; i--) {
        if (!Number.isNaN(series.histogram[i])) {
          validHistograms.unshift({
            timestamp: candles[i].timestamp,
            value: series.histogram[i],
          });
        }
      }

      // Build MACD series for divergence detection (traditional MACD = fastEMA - slowEMA)
      const macdSeriesData: { timestamp: number; macd: number; macdV: number }[] = [];
      for (let i = candles.length - 1; i >= 0 && macdSeriesData.length < histogramCount; i--) {
        if (!Number.isNaN(series.macdV[i]) && !Number.isNaN(series.fastEMA[i]) && !Number.isNaN(series.slowEMA[i])) {
          const traditionalMacd = series.fastEMA[i] - series.slowEMA[i];
          macdSeriesData.unshift({
            timestamp: candles[i].timestamp,
            macd: traditionalMacd,
            macdV: series.macdV[i],
          });
        }
      }

      // Calculate traditional MACD for current candle
      const traditionalMacd = latest.fastEMA - latest.slowEMA;

      // Get previous histogram for crossover detection
      const histogramPrev = validHistograms.length >= 2
        ? validHistograms[validHistograms.length - 2].value
        : null;

      // Derive zone, crossover, scalping bias, and divergence
      const zone = deriveZone(latest.macdV);
      const crossover = deriveCrossover(latest.histogram, histogramPrev);
      const scalpingBias = deriveScalpingBias(zone, latest.stage as MacdVStage, latest.histogram);
      const divergence = detectDivergence(macdSeriesData);

      return {
        success: true,
        error: null,
        data: {
          // Core values
          symbol,
          timeframe,
          timestamp: candles[candles.length - 1].timestamp,
          macdV: latest.macdV,
          signal: latest.signal,
          histogram: latest.histogram,
          fastEMA: latest.fastEMA,
          slowEMA: latest.slowEMA,
          atr: latest.atr,

          // Traditional MACD (non-normalized)
          macd: traditionalMacd,

          // Classifications
          stage: latest.stage,
          zone,
          scalpingBias,
          crossover,
          divergence,

          // Histogram context
          histogramPrev,
          histogramSeries: validHistograms,

          // MACD/MACD-V series for divergence visualization
          macdSeries: macdSeriesData,

          // Metadata
          candleCount: candles.length,
        },
      };
    }),

  /**
   * Get MACD-V series data (for charting)
   */
  getMACDVSeries: publicProcedure
    .input(CalculateFromCandlesInput)
    .query(async ({ input }) => {
      const { symbol, timeframe, limit } = input;

      // Get candles from cache
      const candles = await candleCache.getRecentCandles(
        TEST_USER_ID,
        TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        limit
      );

      if (candles.length < 35) {
        return {
          success: false,
          error: `Insufficient candles: ${candles.length}`,
          data: null,
        };
      }

      // Convert to OHLC format
      const ohlcBars: OHLC[] = candles.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // Calculate full series
      const series = macdV(ohlcBars);

      // Build response with timestamps
      const data = candles.map((candle, i) => ({
        timestamp: candle.timestamp,
        macdV: Number.isNaN(series.macdV[i]) ? null : series.macdV[i],
        signal: Number.isNaN(series.signal[i]) ? null : series.signal[i],
        histogram: Number.isNaN(series.histogram[i]) ? null : series.histogram[i],
      }));

      return {
        success: true,
        error: null,
        data: {
          symbol,
          timeframe,
          series: data.filter((d) => d.macdV !== null), // Only return valid values
        },
      };
    }),

  /**
   * Get indicator metadata
   */
  getMetadata: publicProcedure.query(async () => {
    return {
      'macd-v': {
        name: 'MACD-V',
        description: 'MACD normalized by ATR (Spiroglou)',
        category: 'momentum',
        defaultParams: MACD_V_DEFAULTS,
        stages: [
          'oversold',
          'rebounding',
          'rallying',
          'overbought',
          'retracing',
          'reversing',
          'ranging',
        ],
      },
    };
  }),
});

export type IndicatorRouter = typeof indicatorRouter;
