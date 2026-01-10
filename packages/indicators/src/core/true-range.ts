/**
 * True Range (TR)
 *
 * Per Spiroglou/Wilder definition:
 * TR[t] = max(
 *   high[t] - low[t],
 *   abs(high[t] - prevClose[t]),
 *   abs(low[t] - prevClose[t])
 * )
 *
 * Where prevClose[t] = close[t-1]
 */

export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Calculate True Range for a single bar
 * @param high - Current bar high
 * @param low - Current bar low
 * @param prevClose - Previous bar close
 * @returns True Range value
 */
export function trueRange(high: number, low: number, prevClose: number): number {
  const hl = high - low;
  const hpc = Math.abs(high - prevClose);
  const lpc = Math.abs(low - prevClose);

  return Math.max(hl, hpc, lpc);
}

/**
 * Calculate True Range for an array of OHLC bars
 * @param bars - Array of OHLC bars (oldest first)
 * @returns Array of TR values (length = bars.length, first value uses H-L only)
 */
export function trueRangeSeries(bars: OHLC[]): number[] {
  if (bars.length === 0) {
    return [];
  }

  const result: number[] = [];

  // First bar: TR = High - Low (no previous close available)
  result.push(bars[0].high - bars[0].low);

  // Subsequent bars: use full TR formula
  for (let i = 1; i < bars.length; i++) {
    const tr = trueRange(bars[i].high, bars[i].low, bars[i - 1].close);
    result.push(tr);
  }

  return result;
}
