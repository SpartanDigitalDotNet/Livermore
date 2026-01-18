/**
 * Dark Theme Colors for Charts
 *
 * Optimized for Discord embeds and dark mode displays
 */

export const DARK_THEME = {
  /** Main background color */
  background: '#1a1a2e',
  /** Primary text color */
  text: '#e0e0e0',
  /** Secondary/muted text color */
  textSecondary: '#888888',
  /** Grid line color */
  grid: '#2d2d44',
  /** Axis line color */
  axisLine: '#444466',
} as const;

/**
 * Candlestick colors
 */
export const CANDLE_COLORS = {
  /** Bullish candle (close > open) */
  bullish: '#2ECC71',
  /** Bearish candle (close < open) */
  bearish: '#E74C3C',
} as const;

/**
 * Line colors for indicators
 */
export const LINE_COLORS = {
  /** Price line */
  price: '#5cadff',
  /** EMA(9) line */
  ema9: '#ffaa00',
  /** Signal line */
  signal: '#ffaa00',
} as const;
