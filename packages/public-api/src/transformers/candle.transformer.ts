import type { Candle } from '@livermore/schemas';
import type { PublicCandle } from '../schemas/candle.schema.js';

/**
 * Transform internal candle to public format
 *
 * CRITICAL: This is an EXPLICIT WHITELIST. Only the 6 fields below are extracted.
 * Internal proprietary fields (macdV, fastEMA, slowEMA, atr, informativeATR,
 * isSynthetic, sequenceNum) are NEVER included.
 *
 * Any new field added to internal Candle type will NOT automatically leak through
 * this transformer. This is IP protection by design.
 *
 * @param internal - Internal candle from Redis/database
 * @returns Public candle with ISO timestamps and string decimals
 */
export function transformCandle(internal: Candle): PublicCandle {
  return {
    timestamp: new Date(internal.timestamp).toISOString(),
    open: internal.open.toString(),
    high: internal.high.toString(),
    low: internal.low.toString(),
    close: internal.close.toString(),
    volume: internal.volume.toString(),
  };
}

/**
 * Transform array of internal candles to public format
 *
 * @param candles - Array of internal candles
 * @returns Array of public candles
 */
export function transformCandles(candles: Candle[]): PublicCandle[] {
  return candles.map(transformCandle);
}
