import { z } from 'zod';
import { BaseIndicatorConfigSchema } from './base.schema';

/**
 * MACD-V Zone Classification
 *
 * Zones provide directional context to disambiguate stages like "rebounding"
 * which don't inherently indicate where price is rebounding FROM or TO.
 */
export const MacdVZoneSchema = z.enum([
  'deep_negative',  // < -100: Recovering from oversold
  'negative',       // -100 to -30: Heading toward neutral
  'neutral',        // -30 to +30: Direction unclear
  'positive',       // +30 to +80: Normal bullish territory
  'elevated',       // +80 to +120: Getting extended
  'overbought',     // > +120: Exhaustion likely
  'deep_positive',  // Mirror of deep_negative for symmetry (> +100 before overbought)
  'oversold',       // < -120: Mirror of overbought
]);

/**
 * Zone thresholds for classification
 */
export const MACDV_ZONE_THRESHOLDS = {
  oversold: -120,
  deep_negative: -100,
  negative: -30,
  neutral_low: -30,
  neutral_high: 30,
  positive: 30,
  elevated: 80,
  deep_positive: 100,
  overbought: 120,
} as const;

/**
 * Spiroglou Stage Classification
 * From MACD-V spec - describes momentum phase
 */
export const MacdVStageSchema = z.enum([
  'oversold',    // Extreme negative
  'rebounding',  // Rising from lower levels (direction ambiguous without zone)
  'rallying',    // Strong upward momentum
  'overbought',  // Extreme positive
  'retracing',   // Pulling back from highs
  'reversing',   // Turning negative from positive
  'ranging',     // Near zero, sideways
]);

/**
 * Scalping Bias
 * Derived from zone + stage + histogram direction
 */
export const ScalpingBiasSchema = z.enum([
  'strong_long',   // High confidence long
  'long',          // Normal long bias
  'weak_long',     // Long but low confidence (neutral zone)
  'neutral',       // No clear bias
  'weak_short',    // Short but low confidence
  'short',         // Normal short bias
  'strong_short',  // High confidence short
  'caution',       // At extremes, avoid new positions
]);

/**
 * Crossover State
 * Detected from histogram sign change
 */
export const CrossoverStateSchema = z.enum([
  'fresh_bullish',  // Histogram just flipped positive
  'bullish',        // Histogram positive (established)
  'fresh_bearish',  // Histogram just flipped negative
  'bearish',        // Histogram negative (established)
  'none',           // No crossover context available
]);

/**
 * MACD/MACD-V Divergence State
 * Detects when MACD-V trend separates from traditional MACD trend
 * Useful for trade duration decisions
 */
export const DivergenceStateSchema = z.enum([
  'diverging',   // MACD-V outpacing MACD (volatility compressing, trend strengthening)
  'converging',  // MACD-V lagging MACD (volatility expanding, trend weakening)
  'aligned',     // Moving together, no significant divergence
]);

/**
 * Minimum candles required for divergence detection (excludes forming candle)
 */
export const DIVERGENCE_MIN_CANDLES = 3;

/**
 * Minimum rate-of-change difference to flag divergence (percentage points)
 * Filters noise from minor fluctuations
 */
export const DIVERGENCE_THRESHOLD = 0.15; // 15% difference in rate of change

/**
 * Single histogram data point
 */
export const HistogramEntrySchema = z.object({
  timestamp: z.number().int().positive(),
  value: z.number(),
});

/**
 * MACD-V Configuration Schema
 */
export const MacdVConfigSchema = BaseIndicatorConfigSchema.extend({
  type: z.literal('macd-v'),
  /** Fast EMA period (default: 12) */
  fastPeriod: z.number().int().positive().default(12),
  /** Slow EMA period (default: 26) */
  slowPeriod: z.number().int().positive().default(26),
  /** Signal line period (default: 9) */
  signalPeriod: z.number().int().positive().default(9),
  /** ATR period for normalization (default: 26) */
  atrPeriod: z.number().int().positive().default(26),
});

/**
 * MACD-V Raw Value Schema
 * Core calculated values without analysis
 */
export const MacdVValueSchema = z.object({
  timestamp: z.number().int().positive(),
  macdV: z.number(),
  signal: z.number(),
  histogram: z.number(),
  fastEMA: z.number(),
  slowEMA: z.number(),
  atr: z.number(),
});

/**
 * MACD series entry (traditional MACD for divergence comparison)
 */
export const MacdEntrySchema = z.object({
  timestamp: z.number().int().positive(),
  macd: z.number(),
  macdV: z.number(),
});

/**
 * MACD-V Analysis Schema
 * Full analysis with zone, stage, bias, and optional histogram series
 */
export const MacdVAnalysisSchema = MacdVValueSchema.extend({
  /** Symbol being analyzed */
  symbol: z.string(),
  /** Timeframe */
  timeframe: z.string(),
  /** Spiroglou stage classification */
  stage: MacdVStageSchema,
  /** Zone classification for directional context */
  zone: MacdVZoneSchema,
  /** Derived scalping bias */
  scalpingBias: ScalpingBiasSchema,
  /** Crossover state (requires histogram history) */
  crossover: CrossoverStateSchema,
  /** Previous histogram value (for crossover detection) */
  histogramPrev: z.number().nullable(),
  /** Optional histogram series (last N values) */
  histogramSeries: z.array(HistogramEntrySchema).optional(),
  /** Traditional MACD (non-normalized) */
  macd: z.number(),
  /** Divergence state between MACD and MACD-V */
  divergence: DivergenceStateSchema,
  /** MACD/MACD-V series for divergence visualization */
  macdSeries: z.array(MacdEntrySchema).optional(),
});

/**
 * Derive zone from MACD-V value
 */
export function deriveZone(macdV: number): z.infer<typeof MacdVZoneSchema> {
  if (macdV <= MACDV_ZONE_THRESHOLDS.oversold) return 'oversold';
  if (macdV <= MACDV_ZONE_THRESHOLDS.deep_negative) return 'deep_negative';
  if (macdV < MACDV_ZONE_THRESHOLDS.neutral_low) return 'negative';
  if (macdV <= MACDV_ZONE_THRESHOLDS.neutral_high) return 'neutral';
  if (macdV < MACDV_ZONE_THRESHOLDS.elevated) return 'positive';
  if (macdV < MACDV_ZONE_THRESHOLDS.overbought) return 'elevated';
  return 'overbought';
}

/**
 * Derive crossover state from current and previous histogram
 */
export function deriveCrossover(
  histogram: number,
  histogramPrev: number | null
): z.infer<typeof CrossoverStateSchema> {
  if (histogramPrev === null) return 'none';

  if (histogram > 0 && histogramPrev <= 0) return 'fresh_bullish';
  if (histogram > 0 && histogramPrev > 0) return 'bullish';
  if (histogram < 0 && histogramPrev >= 0) return 'fresh_bearish';
  if (histogram < 0 && histogramPrev < 0) return 'bearish';

  return 'none';
}

/**
 * Derive scalping bias from zone, stage, and histogram
 */
export function deriveScalpingBias(
  zone: z.infer<typeof MacdVZoneSchema>,
  stage: z.infer<typeof MacdVStageSchema>,
  histogram: number
): z.infer<typeof ScalpingBiasSchema> {
  const bullishMomentum = histogram > 0;
  const bearishMomentum = histogram < 0;

  // At extremes - caution
  if (zone === 'overbought' || zone === 'oversold') {
    return 'caution';
  }

  // Bullish stages with bullish momentum
  if ((stage === 'rebounding' || stage === 'rallying') && bullishMomentum) {
    if (zone === 'deep_negative') return 'strong_long';
    if (zone === 'negative') return 'long';
    if (zone === 'neutral') return 'weak_long';
    if (zone === 'positive') return 'long';
    if (zone === 'elevated' || zone === 'deep_positive') return 'weak_long'; // Getting extended
  }

  // Bearish stages with bearish momentum
  if ((stage === 'retracing' || stage === 'reversing') && bearishMomentum) {
    if (zone === 'deep_positive') return 'strong_short';
    if (zone === 'positive' || zone === 'elevated') return 'short';
    if (zone === 'neutral') return 'weak_short';
    if (zone === 'negative') return 'short';
    if (zone === 'deep_negative') return 'weak_short'; // Getting extended
  }

  // Ranging
  if (stage === 'ranging') {
    return 'neutral';
  }

  // Mixed signals
  return 'neutral';
}

/**
 * Detect divergence between MACD and MACD-V trends
 * Excludes the forming (latest) candle to reduce noise
 *
 * @param macdSeries - Array of {macd, macdV} values, oldest first, newest last
 * @returns 'diverging' | 'converging' | 'aligned'
 */
export function detectDivergence(
  macdSeries: Array<{ macd: number; macdV: number }>
): z.infer<typeof DivergenceStateSchema> {
  // Need at least DIVERGENCE_MIN_CANDLES + 1 (we exclude the forming candle)
  if (macdSeries.length < DIVERGENCE_MIN_CANDLES + 1) {
    return 'aligned';
  }

  // Exclude the forming candle (last one) - use confirmed candles only
  const confirmed = macdSeries.slice(0, -1);
  const recent = confirmed.slice(-DIVERGENCE_MIN_CANDLES);

  if (recent.length < DIVERGENCE_MIN_CANDLES) {
    return 'aligned';
  }

  // Calculate rate of change for both MACD and MACD-V
  const first = recent[0];
  const last = recent[recent.length - 1];

  // Avoid division by zero
  if (first.macd === 0 || first.macdV === 0) {
    return 'aligned';
  }

  // Percentage change over the period
  const macdChange = (last.macd - first.macd) / Math.abs(first.macd);
  const macdVChange = (last.macdV - first.macdV) / Math.abs(first.macdV);

  // Calculate the difference in rate of change
  const changeDiff = macdVChange - macdChange;

  // Apply threshold to filter noise
  if (Math.abs(changeDiff) < DIVERGENCE_THRESHOLD) {
    return 'aligned';
  }

  // MACD-V changing faster than MACD = diverging (volatility compressing)
  // MACD-V changing slower than MACD = converging (volatility expanding)
  if (changeDiff > DIVERGENCE_THRESHOLD) {
    return 'diverging';
  } else if (changeDiff < -DIVERGENCE_THRESHOLD) {
    return 'converging';
  }

  return 'aligned';
}

// Export inferred TypeScript types
export type MacdVZone = z.infer<typeof MacdVZoneSchema>;
export type MacdVStage = z.infer<typeof MacdVStageSchema>;
export type ScalpingBias = z.infer<typeof ScalpingBiasSchema>;
export type CrossoverState = z.infer<typeof CrossoverStateSchema>;
export type DivergenceState = z.infer<typeof DivergenceStateSchema>;
export type HistogramEntry = z.infer<typeof HistogramEntrySchema>;
export type MacdEntry = z.infer<typeof MacdEntrySchema>;
export type MacdVConfig = z.infer<typeof MacdVConfigSchema>;
export type MacdVValue = z.infer<typeof MacdVValueSchema>;
export type MacdVAnalysis = z.infer<typeof MacdVAnalysisSchema>;
