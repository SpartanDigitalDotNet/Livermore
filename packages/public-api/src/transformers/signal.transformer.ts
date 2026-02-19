import type { PublicSignal } from '../schemas/signal.schema.js';

/**
 * Transform internal indicator data to public signal format
 *
 * CRITICAL: This is an EXPLICIT WHITELIST. Only 5 fields are extracted and mapped
 * to generic categories. Internal proprietary fields are NEVER included:
 *
 * INTENTIONALLY EXCLUDED:
 * - value map (raw numeric calculations)
 * - params (internal configuration)
 * - type (internal indicator type identifier)
 * - symbol (included at route level, not per-signal)
 * - All raw numeric values (mapped to categorical labels instead)
 *
 * Any new field added to the internal indicator shape will NOT automatically leak
 * through this transformer. This is IP protection by design.
 */

/**
 * Local interface for cached indicator data.
 * Copied from internal shape -- do NOT import from @livermore/cache
 * to maintain zero-dependency IP isolation boundary.
 */
interface CachedIndicator {
  timestamp: number;
  type: string;
  symbol: string;
  timeframe: string;
  value: Record<string, number>;
  params?: Record<string, unknown>;
}

/** Stages that indicate upward momentum */
const BULLISH_STAGES = ['rallying', 'rebounding', 'overbought'];

/** Stages that indicate downward momentum */
const BEARISH_STAGES = ['retracing', 'reversing', 'oversold'];

/**
 * Map internal stage label to generic public direction.
 *
 * @param stage - Internal stage string (e.g. "rallying", "retracing")
 * @returns Generic direction label
 */
export function deriveDirection(stage: string | undefined): 'bullish' | 'bearish' | 'neutral' {
  if (!stage) return 'neutral';
  if (BULLISH_STAGES.includes(stage)) return 'bullish';
  if (BEARISH_STAGES.includes(stage)) return 'bearish';
  return 'neutral';
}

/**
 * Map absolute magnitude to generic strength category.
 *
 * Thresholds:
 * - >= 150: extreme
 * - >= 80: strong
 * - >= 30: moderate
 * - < 30: weak
 *
 * @param absValue - Absolute value of the momentum metric
 * @returns Generic strength category
 */
export function deriveStrength(absValue: number): 'weak' | 'moderate' | 'strong' | 'extreme' {
  if (absValue >= 150) return 'extreme';
  if (absValue >= 80) return 'strong';
  if (absValue >= 30) return 'moderate';
  return 'weak';
}

/**
 * Transform a cached indicator to a public signal.
 *
 * CRITICAL: Returns an explicit object literal -- does NOT spread the indicator.
 * Only whitelisted fields appear in the output.
 *
 * @param indicator - Internal cached indicator data
 * @returns Public signal with generic labels only
 */
export function transformIndicatorToSignal(indicator: CachedIndicator): PublicSignal {
  const stage = indicator.params?.stage as string | undefined;
  const momentumValue = indicator.value['macdV'] ?? 0;

  return {
    type: 'momentum_signal',
    direction: deriveDirection(stage),
    strength: deriveStrength(Math.abs(momentumValue)),
    timeframe: indicator.timeframe,
    updated_at: new Date(indicator.timestamp).toISOString(),
  };
}
