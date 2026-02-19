import { z } from 'zod';

/**
 * Public signal schema - EXPLICIT WHITELIST ONLY
 *
 * CRITICAL: Only these 5 fields are exposed publicly.
 * Internal fields (stage, raw values, params, and all proprietary calculations)
 * are NEVER included to protect proprietary IP.
 *
 * Signals represent the current state of a momentum or trend indicator
 * using generic labels only -- no indicator names or raw numeric values.
 */
export const PublicSignalSchema = z.object({
  type: z.enum(['momentum_signal', 'trend_signal']).describe('Generic signal type classification. "momentum_signal" indicates a momentum-based trade signal. "trend_signal" indicates a trend-based trade signal.'),
  direction: z.enum(['bullish', 'bearish', 'neutral']).describe('Current signal direction. "bullish" means upward momentum/trend, "bearish" means downward, "neutral" means indeterminate.'),
  strength: z.enum(['weak', 'moderate', 'strong', 'extreme']).describe('Signal strength category. Ranges from "weak" (low confidence) to "extreme" (very high confidence).'),
  timeframe: z.string().describe('Candle timeframe interval this signal applies to. Example: "15m", "1h", "4h"'),
  updated_at: z.string().describe('ISO 8601 timestamp of when this signal was last updated. Example: "2026-02-18T12:00:00.000Z"'),
});

export type PublicSignal = z.infer<typeof PublicSignalSchema>;

/**
 * URL path parameters for signal endpoints
 * Example: GET /api/v1/signals/:exchange/:symbol
 */
export const SignalParamsSchema = z.object({
  exchange: z.string().min(1).describe('Exchange name (e.g. "coinbase")'),
  symbol: z.string().min(1).describe('Trading pair (e.g. "BTC-USD")'),
});

export type SignalParams = z.infer<typeof SignalParamsSchema>;

/**
 * Query parameters for signal endpoints
 * Supports optional timeframe filtering
 */
export const SignalQuerySchema = z.object({
  timeframe: z.string().optional().describe('Filter to specific timeframe (e.g. "15m", "1h"). Omit for all timeframes.'),
});

export type SignalQuery = z.infer<typeof SignalQuerySchema>;
