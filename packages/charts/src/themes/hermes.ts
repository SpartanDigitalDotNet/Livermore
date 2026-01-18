/**
 * Hermes Color Zones for MACD-V
 *
 * Colors based on |MACD-V| magnitude to indicate market conditions:
 * - Lower values (near zero): neutral/ranging
 * - Higher values: increasingly extreme conditions
 */

export const HERMES_COLORS = {
  /** |MACD-V| < 50: Neutral zone */
  grayblue: '#7A8CA3',
  /** 50 <= |MACD-V| < 75: Mild momentum */
  aqua: '#33C3F0',
  /** 75 <= |MACD-V| < 125: Moderate momentum */
  lime: '#2ECC71',
  /** 125 <= |MACD-V| < 140: Strong momentum */
  yellow: '#F1C40F',
  /** 140 <= |MACD-V| < 150: Very strong momentum */
  orange: '#F39C12',
  /** |MACD-V| >= 150: Extreme (overbought/oversold) */
  red: '#E74C3C',
} as const;

/**
 * Get Hermes color based on MACD-V magnitude
 *
 * @param value - MACD-V value (can be positive or negative)
 * @returns Hex color string
 */
export function getMacdVColor(value: number): string {
  const abs = Math.abs(value);

  if (abs < 50) return HERMES_COLORS.grayblue;
  if (abs < 75) return HERMES_COLORS.aqua;
  if (abs < 125) return HERMES_COLORS.lime;
  if (abs < 140) return HERMES_COLORS.yellow;
  if (abs < 150) return HERMES_COLORS.orange;
  return HERMES_COLORS.red;
}

/**
 * MACD-V threshold levels for reference lines
 */
export const MACD_V_LEVELS = {
  extreme: 150,
  neutral: 50,
} as const;
