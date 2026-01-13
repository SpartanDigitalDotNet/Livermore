import { z } from 'zod';

/**
 * Liquidity tier classification
 *
 * Based on gap ratio (percentage of synthetic/filled candles):
 * - high: <20% synthetic candles - reliable data, frequent trading
 * - medium: 20-50% synthetic - moderate trading activity
 * - low: >50% synthetic - sparse trading, use indicators with caution
 */
export const LiquidityTierSchema = z.enum(['high', 'medium', 'low']);
export type LiquidityTier = z.infer<typeof LiquidityTierSchema>;

/**
 * Liquidity metadata attached to indicator calculations
 */
export const LiquidityMetadataSchema = z.object({
  /** Liquidity classification */
  tier: LiquidityTierSchema,
  /** Ratio of synthetic (gap-filled) candles to total (0-1) */
  gapRatio: z.number().min(0).max(1),
  /** Ratio of zero-range candles (O=H=L=C) to total (0-1) */
  zeroRangeRatio: z.number().min(0).max(1).optional(),
});
export type LiquidityMetadata = z.infer<typeof LiquidityMetadataSchema>;

/**
 * Classify liquidity based on gap ratio
 *
 * @param gapRatio - Ratio of synthetic/filled candles (0-1)
 * @returns Liquidity tier classification
 *
 * @example
 * ```ts
 * classifyLiquidity(0.1);  // 'high' - only 10% synthetic
 * classifyLiquidity(0.35); // 'medium' - 35% synthetic
 * classifyLiquidity(0.7);  // 'low' - 70% synthetic
 * ```
 */
export function classifyLiquidity(gapRatio: number): LiquidityTier {
  if (gapRatio < 0.2) return 'high';
  if (gapRatio < 0.5) return 'medium';
  return 'low';
}
