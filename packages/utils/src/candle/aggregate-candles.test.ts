import { describe, it, expect } from 'vitest';
import { aggregateCandles } from './aggregate-candles';
import type { Candle, Timeframe } from '@livermore/schemas';

/**
 * Factory function to create test candles
 */
function makeCandle(
  timestamp: number,
  ohlcv: [number, number, number, number, number],
  options: { symbol?: string; timeframe?: Timeframe; isSynthetic?: boolean } = {}
): Candle {
  return {
    timestamp,
    open: ohlcv[0],
    high: ohlcv[1],
    low: ohlcv[2],
    close: ohlcv[3],
    volume: ohlcv[4],
    symbol: options.symbol ?? 'BTC-USD',
    timeframe: options.timeframe ?? '5m',
    isSynthetic: options.isSynthetic ?? false,
  };
}

// Base timestamp: Mon Jan 01 2024 00:00:00 UTC
const BASE_TS = 1704067200000;
const FIVE_MIN = 5 * 60 * 1000;

describe('aggregateCandles', () => {
  describe('5m to 15m aggregation', () => {
    it('should aggregate 6 candles into 2 complete 15m periods', () => {
      // 6 candles = 2 complete 15m periods (3 candles each)
      const candles: Candle[] = [
        // First 15m period (00:00 - 00:15)
        makeCandle(BASE_TS, [100, 105, 99, 103, 1000]),
        makeCandle(BASE_TS + FIVE_MIN, [103, 108, 102, 106, 1100]),
        makeCandle(BASE_TS + 2 * FIVE_MIN, [106, 107, 104, 105, 900]),
        // Second 15m period (00:15 - 00:30)
        makeCandle(BASE_TS + 3 * FIVE_MIN, [105, 110, 104, 109, 1200]),
        makeCandle(BASE_TS + 4 * FIVE_MIN, [109, 112, 108, 111, 1300]),
        makeCandle(BASE_TS + 5 * FIVE_MIN, [111, 113, 110, 112, 1400]),
      ];

      const result = aggregateCandles(candles, '5m', '15m');

      expect(result).toHaveLength(2);

      // First 15m candle
      expect(result[0].timestamp).toBe(BASE_TS);
      expect(result[0].open).toBe(100); // First candle's open
      expect(result[0].high).toBe(108); // Max high (from second candle)
      expect(result[0].low).toBe(99); // Min low (from first candle)
      expect(result[0].close).toBe(105); // Last candle's close
      expect(result[0].volume).toBe(3000); // Sum: 1000 + 1100 + 900
      expect(result[0].timeframe).toBe('15m');
      expect(result[0].symbol).toBe('BTC-USD');

      // Second 15m candle
      expect(result[1].timestamp).toBe(BASE_TS + 15 * 60 * 1000);
      expect(result[1].open).toBe(105);
      expect(result[1].high).toBe(113);
      expect(result[1].low).toBe(104);
      expect(result[1].close).toBe(112);
      expect(result[1].volume).toBe(3900); // Sum: 1200 + 1300 + 1400
    });
  });

  describe('incomplete period exclusion', () => {
    it('should exclude incomplete periods from output', () => {
      // 4 candles = 1 complete 15m period + 1 partial (only 1 candle)
      const candles: Candle[] = [
        // First 15m period (complete)
        makeCandle(BASE_TS, [100, 105, 99, 103, 1000]),
        makeCandle(BASE_TS + FIVE_MIN, [103, 108, 102, 106, 1100]),
        makeCandle(BASE_TS + 2 * FIVE_MIN, [106, 107, 104, 105, 900]),
        // Second 15m period (incomplete - only 1 candle)
        makeCandle(BASE_TS + 3 * FIVE_MIN, [105, 110, 104, 109, 1200]),
      ];

      const result = aggregateCandles(candles, '5m', '15m');

      // Only 1 complete period should be output
      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe(BASE_TS);
    });
  });

  describe('OHLC aggregation rules', () => {
    it('should correctly apply OHLC rules: open=first, high=max, low=min, close=last, volume=sum', () => {
      const candles: Candle[] = [
        makeCandle(BASE_TS, [50, 55, 48, 53, 100]), // open=50, has min low=48
        makeCandle(BASE_TS + FIVE_MIN, [53, 60, 52, 58, 200]), // has max high=60
        makeCandle(BASE_TS + 2 * FIVE_MIN, [58, 59, 56, 55, 300]), // close=55
      ];

      const result = aggregateCandles(candles, '5m', '15m');

      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(50); // First candle's open
      expect(result[0].high).toBe(60); // Max high across all candles
      expect(result[0].low).toBe(48); // Min low across all candles
      expect(result[0].close).toBe(55); // Last candle's close
      expect(result[0].volume).toBe(600); // Sum of all volumes
    });
  });

  describe('isSynthetic propagation', () => {
    it('should set isSynthetic=true if any source candle is synthetic', () => {
      const candles: Candle[] = [
        makeCandle(BASE_TS, [100, 105, 99, 103, 1000], { isSynthetic: false }),
        makeCandle(BASE_TS + FIVE_MIN, [103, 108, 102, 106, 0], { isSynthetic: true }), // Synthetic!
        makeCandle(BASE_TS + 2 * FIVE_MIN, [106, 107, 104, 105, 900], { isSynthetic: false }),
      ];

      const result = aggregateCandles(candles, '5m', '15m');

      expect(result).toHaveLength(1);
      expect(result[0].isSynthetic).toBe(true);
    });

    it('should set isSynthetic=false if all source candles are real', () => {
      const candles: Candle[] = [
        makeCandle(BASE_TS, [100, 105, 99, 103, 1000], { isSynthetic: false }),
        makeCandle(BASE_TS + FIVE_MIN, [103, 108, 102, 106, 1100], { isSynthetic: false }),
        makeCandle(BASE_TS + 2 * FIVE_MIN, [106, 107, 104, 105, 900], { isSynthetic: false }),
      ];

      const result = aggregateCandles(candles, '5m', '15m');

      expect(result).toHaveLength(1);
      expect(result[0].isSynthetic).toBe(false);
    });
  });

  describe('empty input', () => {
    it('should return empty array for empty input', () => {
      const result = aggregateCandles([], '5m', '15m');
      expect(result).toEqual([]);
    });
  });

  describe('validation', () => {
    it('should throw error when target timeframe is smaller than source', () => {
      const candles: Candle[] = [makeCandle(BASE_TS, [100, 105, 99, 103, 1000])];

      expect(() => aggregateCandles(candles, '15m', '5m')).toThrow(
        'Target timeframe (5m) must be larger than source timeframe (15m)'
      );
    });

    it('should throw error when target timeframe equals source', () => {
      const candles: Candle[] = [makeCandle(BASE_TS, [100, 105, 99, 103, 1000])];

      expect(() => aggregateCandles(candles, '5m', '5m')).toThrow(
        'Target timeframe (5m) must be larger than source timeframe (5m)'
      );
    });
  });

  describe('sorted output', () => {
    it('should return candles sorted by timestamp ascending', () => {
      // Input candles in random order
      const candles: Candle[] = [
        // Second 15m period
        makeCandle(BASE_TS + 4 * FIVE_MIN, [109, 112, 108, 111, 1300]),
        // First 15m period
        makeCandle(BASE_TS + FIVE_MIN, [103, 108, 102, 106, 1100]),
        // Second 15m period
        makeCandle(BASE_TS + 5 * FIVE_MIN, [111, 113, 110, 112, 1400]),
        // First 15m period
        makeCandle(BASE_TS, [100, 105, 99, 103, 1000]),
        // Second 15m period
        makeCandle(BASE_TS + 3 * FIVE_MIN, [105, 110, 104, 109, 1200]),
        // First 15m period
        makeCandle(BASE_TS + 2 * FIVE_MIN, [106, 107, 104, 105, 900]),
      ];

      const result = aggregateCandles(candles, '5m', '15m');

      expect(result).toHaveLength(2);
      // Should be sorted ascending
      expect(result[0].timestamp).toBe(BASE_TS);
      expect(result[1].timestamp).toBe(BASE_TS + 15 * 60 * 1000);
      // Verify the shuffled input still aggregates correctly
      expect(result[0].open).toBe(100);
      expect(result[0].close).toBe(105);
    });
  });

  describe('larger timeframe aggregations', () => {
    it('should aggregate 5m to 1h (12 candles per hour)', () => {
      // Create 12 candles for 1 complete hour
      const candles: Candle[] = [];
      for (let i = 0; i < 12; i++) {
        candles.push(
          makeCandle(BASE_TS + i * FIVE_MIN, [100 + i, 105 + i, 95 + i, 102 + i, 100 * (i + 1)])
        );
      }

      const result = aggregateCandles(candles, '5m', '1h');

      expect(result).toHaveLength(1);
      expect(result[0].timeframe).toBe('1h');
      expect(result[0].open).toBe(100); // First candle's open
      expect(result[0].close).toBe(113); // Last candle's close (102 + 11)
      expect(result[0].high).toBe(116); // Max high (105 + 11)
      expect(result[0].low).toBe(95); // Min low
      expect(result[0].volume).toBe(7800); // Sum: 100*(1+2+...+12) = 100*78 = 7800
    });
  });
});
