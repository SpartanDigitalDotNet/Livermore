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
 * Input schema for portfolio-wide MACD-V analysis
 */
const GetPortfolioAnalysisInput = z.object({
  symbols: z.array(z.string().min(1)).min(1).max(100),
});

/**
 * Supported timeframes for portfolio analysis
 */
const ANALYSIS_TIMEFRAMES: Array<'1m' | '5m' | '15m' | '1h' | '4h' | '1d'> = ['1m', '5m', '15m', '1h', '4h', '1d'];

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
          // Liquidity metadata
          liquidity: indicator.params?.['liquidity'] || 'unknown',
          gapRatio: indicator.params?.['gapRatio'] ?? null,
          zeroRangeRatio: indicator.params?.['zeroRangeRatio'] ?? null,
          // Validity metadata (from informativeATR)
          seeded: indicator.params?.['seeded'] ?? true,
          nEff: indicator.params?.['nEff'] ?? null,
          spanBars: indicator.params?.['spanBars'] ?? null,
          reason: indicator.params?.['reason'] ?? null,
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

  /**
   * Get portfolio-wide MACD-V analysis (single fast call)
   * Returns all symbols with their MACD-V values across all timeframes
   * Identifies opportunities and risks
   */
  getPortfolioAnalysis: publicProcedure
    .input(GetPortfolioAnalysisInput)
    .query(async ({ input }) => {
      const { symbols } = input;

      // Build requests for all symbol/timeframe combinations
      const requests: { symbol: string; timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' }[] = [];
      for (const symbol of symbols) {
        for (const timeframe of ANALYSIS_TIMEFRAMES) {
          requests.push({ symbol, timeframe });
        }
      }

      // Fetch all indicators in one Redis MGET call
      const indicatorMap = await indicatorCache.getIndicatorsBulk(
        TEST_USER_ID,
        TEST_EXCHANGE_ID,
        requests
      );

      // Build symbol analysis
      type SymbolAnalysis = {
        symbol: string;
        values: Record<string, number | null>;
        signal: string;
        stage: string;
        h1: number | null;
        h4: number | null;
        d1: number | null;
        liquidity: string;
      };

      const symbolAnalyses: SymbolAnalysis[] = [];

      // Helper to get worst liquidity tier (low < medium < high)
      const liquidityRank = (liq: string): number => {
        if (liq === 'low') return 0;
        if (liq === 'medium') return 1;
        if (liq === 'high') return 2;
        return -1; // unknown
      };
      const rankToLiquidity = (rank: number): string => {
        if (rank === 0) return 'low';
        if (rank === 1) return 'medium';
        if (rank === 2) return 'high';
        return 'unknown';
      };

      for (const symbol of symbols) {
        const values: Record<string, number | null> = {};
        let worstLiquidityRank = 3; // Start higher than any valid rank
        let symbolStage = 'unknown';

        for (const tf of ANALYSIS_TIMEFRAMES) {
          const key = `${symbol}:${tf}`;
          const indicator = indicatorMap.get(key);
          values[tf] = indicator ? Math.round(indicator.value['macdV'] * 10) / 10 : null;
          // Track worst (lowest) liquidity across all timeframes
          if (indicator?.params?.['liquidity']) {
            const rank = liquidityRank(indicator.params['liquidity'] as string);
            if (rank >= 0 && rank < worstLiquidityRank) {
              worstLiquidityRank = rank;
            }
          }
          // Get stage from 1h timeframe
          if (tf === '1h' && indicator?.params?.['stage']) {
            symbolStage = indicator.params['stage'] as string;
          }
        }
        const symbolLiquidity = worstLiquidityRank <= 2 ? rankToLiquidity(worstLiquidityRank) : 'unknown';

        const h1 = values['1h'];
        const h4 = values['4h'];
        const d1 = values['1d'];

        // Determine signal
        let signal = 'No Data';
        if (h1 !== null && h4 !== null && d1 !== null) {
          if (h1 > 50 && h4 > 50 && d1 > 0) signal = 'STRONG BUY';
          else if (h1 < -50 && h4 < -50 && d1 < 0) signal = 'STRONG SELL';
          else if (h1 > 0 && h4 > 0 && d1 > 0) signal = 'Bullish';
          else if (h1 < 0 && h4 < 0 && d1 < 0) signal = 'Bearish';
          else if (h1 > 50 && h4 < 0) signal = 'Reversal Up?';
          else if (h1 < -50 && h4 > 0) signal = 'Reversal Down?';
          else signal = 'Mixed';
        }

        symbolAnalyses.push({ symbol, values, signal, stage: symbolStage, h1, h4, d1, liquidity: symbolLiquidity });
      }

      // Identify opportunities and risks
      const bullish = symbolAnalyses
        .filter((s) => s.h1 !== null && s.h4 !== null && s.h1 > 50 && s.h4 > 0)
        .sort((a, b) => (b.h1 ?? 0) - (a.h1 ?? 0))
        .slice(0, 5);

      const bearish = symbolAnalyses
        .filter((s) => s.h1 !== null && s.h4 !== null && s.h1 < -50 && s.h4 < 0)
        .sort((a, b) => (a.h1 ?? 0) - (b.h1 ?? 0))
        .slice(0, 5);

      const reversalUp = symbolAnalyses
        .filter((s) => s.h1 !== null && s.h4 !== null && s.d1 !== null && s.h1 > 30 && s.h4 < -20 && s.d1 < 0)
        .slice(0, 3);

      const reversalDown = symbolAnalyses
        .filter((s) => s.h1 !== null && s.h4 !== null && s.d1 !== null && s.h1 < -30 && s.h4 > 20 && s.d1 > 0)
        .slice(0, 3);

      return {
        success: true,
        timestamp: Date.now(),
        symbols: symbolAnalyses,
        opportunities: {
          bullish: bullish.map((s) => ({ symbol: s.symbol, h1: s.h1, h4: s.h4, d1: s.d1, liquidity: s.liquidity })),
          reversalUp: reversalUp.map((s) => ({ symbol: s.symbol, h1: s.h1, h4: s.h4, d1: s.d1, liquidity: s.liquidity })),
        },
        risks: {
          bearish: bearish.map((s) => ({ symbol: s.symbol, h1: s.h1, h4: s.h4, d1: s.d1, liquidity: s.liquidity })),
          reversalDown: reversalDown.map((s) => ({ symbol: s.symbol, h1: s.h1, h4: s.h4, d1: s.d1, liquidity: s.liquidity })),
        },
      };
    }),
});

export type IndicatorRouter = typeof indicatorRouter;
