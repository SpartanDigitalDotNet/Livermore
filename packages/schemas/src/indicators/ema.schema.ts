import { z } from 'zod';
import { BaseIndicatorConfigSchema, BaseIndicatorValueSchema } from './base.schema';

/**
 * EMA (Exponential Moving Average) configuration schema
 */
export const EMAConfigSchema = BaseIndicatorConfigSchema.extend({
  type: z.literal('ema'),
  /** Period for EMA calculation (e.g., 9, 12, 26, 50, 200) */
  period: z.number().int().positive(),
  /** Source field for calculation (default: 'close') */
  source: z.enum(['open', 'high', 'low', 'close']).default('close'),
  /** Display color for UI */
  color: z.string().optional(),
});

/**
 * EMA value schema
 */
export const EMAValueSchema = BaseIndicatorValueSchema.extend({
  /** The EMA value */
  value: z.number(),
});

/**
 * Multiple EMA values (for EMA crossover detection)
 */
export const EMAMultipleValuesSchema = z.object({
  timestamp: z.number().int().positive(),
  values: z.record(z.number()), // e.g., { "ema9": 50000, "ema26": 49000 }
});

// Export inferred TypeScript types
export type EMAConfig = z.infer<typeof EMAConfigSchema>;
export type EMAValue = z.infer<typeof EMAValueSchema>;
export type EMAMultipleValues = z.infer<typeof EMAMultipleValuesSchema>;
