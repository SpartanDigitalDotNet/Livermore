import type { Candle, Timeframe } from '@livermore/schemas';

/**
 * Alert marker to display on chart
 */
export interface AlertMarker {
  /** Bar index where marker should appear (0 = first bar, -1 for last bar) */
  barIndex: number;
  /** Type of alert determines marker color and direction */
  type: 'oversold' | 'overbought';
  /** Label for the alert (e.g., "level_-150", "reversal_oversold") */
  label: string;
  /** MACD-V value at time of alert */
  value: number;
}

/**
 * Options for generating a MACD-V chart
 */
export interface ChartGenerationOptions {
  /** Trading symbol (e.g., "BTC-USD") */
  symbol: string;
  /** Timeframe for the chart */
  timeframe: Timeframe;
  /** Candle data (oldest first) - may include extra bars for warmup */
  candles: Candle[];
  /** Alert markers to display on chart */
  alertMarkers?: AlertMarker[];
  /** Number of bars to display (slices from end after MACD-V warmup). If not set, displays all candles. */
  displayBars?: number;
  /** Chart width in pixels (default: 800) */
  width?: number;
  /** Chart height in pixels (default: 500) */
  height?: number;
}

/**
 * Result from chart generation
 */
export interface ChartResult {
  /** PNG image buffer */
  buffer: Buffer;
  /** MIME type of the image */
  mimeType: 'image/png';
  /** Chart width in pixels */
  width: number;
  /** Chart height in pixels */
  height: number;
  /** Timestamp when chart was generated */
  generatedAt: number;
}
