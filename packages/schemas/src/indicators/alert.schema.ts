import { z } from 'zod';
import { TimeframeSchema } from '../market/candle.schema';

/**
 * Alert condition operator
 */
export const AlertOperatorSchema = z.enum([
  'greater_than',
  'less_than',
  'crosses_above',
  'crosses_below',
  'equals',
]);

/**
 * Single alert condition schema
 */
export const AlertConditionSchema = z.object({
  /** Indicator type (e.g., 'ema', 'macd', 'price') */
  indicator: z.string().min(1),
  /** Indicator parameters (e.g., { period: 9 } for EMA) */
  params: z.record(z.any()).optional(),
  /** Comparison operator */
  operator: AlertOperatorSchema,
  /** Target value or another indicator to compare against */
  target: z.union([
    z.number(), // Static value
    z.object({
      // Another indicator
      indicator: z.string().min(1),
      params: z.record(z.any()).optional(),
    }),
  ]),
});

/**
 * Alert configuration schema
 */
export const AlertConfigSchema = z.object({
  /** Unique alert ID */
  id: z.string().optional(),
  /** Alert name */
  name: z.string().min(1),
  /** Trading pair symbol */
  symbol: z.string().min(1),
  /** Timeframe */
  timeframe: TimeframeSchema,
  /** Alert conditions (multiple conditions with AND logic) */
  conditions: z.array(AlertConditionSchema).min(1),
  /** Whether the alert is active */
  isActive: z.boolean().default(true),
  /** Cooldown period in milliseconds (prevent repeated triggers) */
  cooldownMs: z.number().int().positive().default(300000), // 5 minutes default
  /** Created timestamp */
  createdAt: z.number().int().positive().optional(),
  /** Last updated timestamp */
  updatedAt: z.number().int().positive().optional(),
  /** Last triggered timestamp */
  lastTriggeredAt: z.number().int().positive().optional(),
});

/**
 * Alert trigger event schema
 * Represents a single alert trigger occurrence
 */
export const AlertTriggerSchema = z.object({
  /** Alert ID */
  alertId: z.string().min(1),
  /** Alert name */
  alertName: z.string().min(1),
  /** Trading pair symbol */
  symbol: z.string().min(1),
  /** Timeframe */
  timeframe: TimeframeSchema,
  /** Current price when triggered */
  price: z.number().positive(),
  /** Conditions that were met */
  conditionsMet: z.array(AlertConditionSchema),
  /** Timestamp when triggered */
  triggeredAt: z.number().int().positive(),
  /** Message describing the trigger */
  message: z.string(),
});

/**
 * WebSocket message for alert triggers
 */
export const AlertTriggerMessageSchema = z.object({
  type: z.literal('alert_trigger'),
  data: AlertTriggerSchema,
});

// Export inferred TypeScript types
export type AlertOperator = z.infer<typeof AlertOperatorSchema>;
export type AlertCondition = z.infer<typeof AlertConditionSchema>;
export type AlertConfig = z.infer<typeof AlertConfigSchema>;
export type AlertTrigger = z.infer<typeof AlertTriggerSchema>;
export type AlertTriggerMessage = z.infer<typeof AlertTriggerMessageSchema>;
