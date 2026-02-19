import type { PublicAlert } from '../schemas/alert.schema.js';

/**
 * Transform internal alert history rows to public alert format
 *
 * CRITICAL: This is an EXPLICIT WHITELIST. Only 8 fields are extracted and mapped
 * to generic categories. Internal columns are NEVER included:
 *
 * INTENTIONALLY EXCLUDED:
 * - details (JSONB with internal indicator data)
 * - previousLabel (internal state transition tracking)
 * - notificationSent (internal delivery status)
 * - notificationError (internal error messages)
 * - alertType (internal type discriminator)
 * - triggeredAtEpoch (internal epoch timestamp)
 * - exchangeId (internal numeric ID -- replaced with exchange name)
 * - id (internal primary key)
 *
 * Any new column added to the alert_history table will NOT automatically leak
 * through this transformer. This is IP protection by design.
 */

/**
 * Local interface for alert history row data.
 * Copied from internal shape -- do NOT import from @livermore/database
 * to maintain zero-dependency IP isolation boundary.
 * Contains ONLY the columns the route will SELECT.
 */
interface AlertHistoryRow {
  triggeredAt: Date;
  symbol: string;
  timeframe: string | null;
  triggerLabel: string;
  triggerValue: string | null;
  price: string;
  exchangeId: number;
}

/**
 * Derive direction from internal trigger label.
 *
 * Mapping rules:
 * - "reversal_oversold" prefix -> bullish (reversing FROM oversold = upward)
 * - "reversal_overbought" prefix -> bearish (reversing FROM overbought = downward)
 * - "level_" prefix -> parse numeric value: negative = bearish, positive/zero = bullish
 * - Default fallback -> bearish (conservative)
 *
 * @param triggerLabel - Internal trigger label string
 * @returns Generic direction label
 */
export function deriveAlertDirection(triggerLabel: string): 'bullish' | 'bearish' {
  if (triggerLabel.startsWith('reversal_oversold')) return 'bullish';
  if (triggerLabel.startsWith('reversal_overbought')) return 'bearish';

  if (triggerLabel.startsWith('level_')) {
    const numStr = triggerLabel.slice('level_'.length);
    const num = parseFloat(numStr);
    if (!isNaN(num) && num < 0) return 'bearish';
    return 'bullish';
  }

  return 'bearish';
}

/**
 * Map raw trigger value to generic strength category.
 *
 * Uses absolute value with same thresholds as signal strength:
 * - >= 150: extreme
 * - >= 80: strong
 * - >= 30: moderate
 * - < 30: weak
 * - null/undefined: moderate (safe default)
 *
 * @param triggerValue - Raw trigger value string or null
 * @returns Generic strength category
 */
export function deriveAlertStrength(triggerValue: string | null): 'weak' | 'moderate' | 'strong' | 'extreme' {
  if (triggerValue == null) return 'moderate';

  const parsed = parseFloat(triggerValue);
  if (isNaN(parsed)) return 'moderate';

  const absValue = Math.abs(parsed);
  if (absValue >= 150) return 'extreme';
  if (absValue >= 80) return 'strong';
  if (absValue >= 30) return 'moderate';
  return 'weak';
}

/**
 * Transform an alert history row to a public alert.
 *
 * CRITICAL: Returns an explicit object literal -- does NOT spread the row.
 * Only whitelisted fields appear in the output.
 *
 * @param row - Internal alert history row (selected columns only)
 * @param exchangeName - Resolved exchange name (not numeric ID)
 * @returns Public alert with generic labels only
 */
export function transformAlertHistory(row: AlertHistoryRow, exchangeName: string): PublicAlert {
  return {
    timestamp: row.triggeredAt.toISOString(),
    symbol: row.symbol,
    exchange: exchangeName,
    timeframe: row.timeframe ?? '',
    signal_type: 'momentum_signal',
    direction: deriveAlertDirection(row.triggerLabel),
    strength: deriveAlertStrength(row.triggerValue),
    price: row.price.toString(),
  };
}
