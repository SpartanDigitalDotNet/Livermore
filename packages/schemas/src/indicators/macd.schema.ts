import { z } from 'zod';
import { BaseIndicatorConfigSchema } from './base.schema';

/**
 * MACD (Moving Average Convergence Divergence) configuration schema
 */
export const MACDConfigSchema = BaseIndicatorConfigSchema.extend({
  type: z.literal('macd'),
  /** Fast EMA period (default: 12) */
  fastPeriod: z.number().int().positive().default(12),
  /** Slow EMA period (default: 26) */
  slowPeriod: z.number().int().positive().default(26),
  /** Signal line period (default: 9) */
  signalPeriod: z.number().int().positive().default(9),
  /** Source field for calculation (default: 'close') */
  source: z.enum(['open', 'high', 'low', 'close']).default('close'),
});

/**
 * MACD value schema
 * Contains MACD line, signal line, and histogram
 */
export const MACDValueSchema = z.object({
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
  /** MACD line value (fast EMA - slow EMA) */
  macd: z.number(),
  /** Signal line value (EMA of MACD) */
  signal: z.number(),
  /** Histogram value (MACD - signal) */
  histogram: z.number(),
});

// Export inferred TypeScript types
export type MACDConfig = z.infer<typeof MACDConfigSchema>;
export type MACDValue = z.infer<typeof MACDValueSchema>;
