import { z } from 'zod';
import { TimeframeSchema } from '../market/candle.schema';

/**
 * Base indicator value schema
 * All indicators produce timestamped values
 */
export const BaseIndicatorValueSchema = z.object({
  /** Unix timestamp in milliseconds */
  timestamp: z.number().int().positive(),
  /** The calculated indicator value(s) */
  value: z.number().or(z.record(z.number())), // number or object of numbers
});

/**
 * Indicator configuration base schema
 */
export const BaseIndicatorConfigSchema = z.object({
  /** Indicator type */
  type: z.string().min(1),
  /** Trading pair symbol */
  symbol: z.string().min(1),
  /** Timeframe for calculation */
  timeframe: TimeframeSchema,
  /** Whether the indicator is enabled */
  enabled: z.boolean().default(true),
});

/**
 * Indicator metadata schema
 */
export const IndicatorMetadataSchema = z.object({
  /** Indicator type identifier */
  type: z.string().min(1),
  /** Display name */
  name: z.string().min(1),
  /** Short description */
  description: z.string(),
  /** Category (trend, momentum, volatility, volume) */
  category: z.enum(['trend', 'momentum', 'volatility', 'volume']),
  /** Default parameters */
  defaultParams: z.record(z.any()),
});

// Export inferred TypeScript types
export type BaseIndicatorValue = z.infer<typeof BaseIndicatorValueSchema>;
export type BaseIndicatorConfig = z.infer<typeof BaseIndicatorConfigSchema>;
export type IndicatorMetadata = z.infer<typeof IndicatorMetadataSchema>;
