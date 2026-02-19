import { z } from 'zod';

/**
 * Public alert schema - EXPLICIT WHITELIST ONLY
 *
 * CRITICAL: Only these 8 fields are exposed publicly.
 * Internal fields (details JSONB, previousLabel, notificationSent, notificationError,
 * alertType, triggeredAtEpoch, exchangeId) are NEVER included to protect proprietary IP.
 *
 * Alerts represent historical trade signal triggers with generic labels only --
 * no indicator names or raw numeric values.
 */
export const PublicAlertSchema = z.object({
  timestamp: z.string().describe('ISO 8601 timestamp of when the alert was triggered. Example: "2026-02-18T12:00:00.000Z"'),
  symbol: z.string().describe('Trading pair symbol. Example: "BTC-USD"'),
  exchange: z.string().describe('Exchange name where the alert occurred. Example: "coinbase"'),
  timeframe: z.string().describe('Candle timeframe interval this alert applies to. Example: "15m", "1h"'),
  signal_type: z.enum(['momentum_signal']).describe('Generic signal type that triggered the alert. "momentum_signal" indicates a momentum-based trade signal.'),
  direction: z.enum(['bullish', 'bearish']).describe('Direction of the triggered signal. "bullish" means upward momentum, "bearish" means downward.'),
  strength: z.enum(['weak', 'moderate', 'strong', 'extreme']).describe('Signal strength at the time of trigger. Ranges from "weak" (low confidence) to "extreme" (very high confidence).'),
  price: z.string().describe('Asset price at the time of alert trigger as string decimal (no precision loss). Example: "42350.50000000"'),
});

export type PublicAlert = z.infer<typeof PublicAlertSchema>;

/**
 * Query parameters for alert history endpoints
 * Supports filtering by exchange, symbol, timeframe and cursor-based pagination
 */
export const AlertQuerySchema = z.object({
  exchange: z.string().optional().describe('Filter alerts by exchange name. Example: "coinbase"'),
  symbol: z.string().optional().describe('Filter alerts by trading pair symbol. Example: "BTC-USD"'),
  timeframe: z.string().optional().describe('Filter alerts by timeframe. Example: "15m", "1h"'),
  cursor: z.string().optional().describe('Opaque cursor for pagination. Omit for first page.'),
  limit: z.coerce.number().int().min(1).max(100).default(50).describe('Maximum alerts to return per page (1-100). Default: 50'),
});

export type AlertQuery = z.infer<typeof AlertQuerySchema>;
