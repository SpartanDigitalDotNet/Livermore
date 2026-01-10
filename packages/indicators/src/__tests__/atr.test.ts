import { describe, it, expect } from 'vitest';
import { trueRange, trueRangeSeries, type OHLC } from '../core/true-range.js';
import { atr, atrLatest, atrIncremental } from '../core/atr.js';

describe('True Range', () => {
  describe('trueRange()', () => {
    it('calculates TR as high-low when that is largest', () => {
      // H-L = 10, |H-PC| = 5, |L-PC| = 5
      const result = trueRange(110, 100, 105);
      expect(result).toBe(10);
    });

    it('calculates TR as |high-prevClose| when that is largest', () => {
      // Gap up scenario: H-L = 5, |H-PC| = 15, |L-PC| = 10
      const result = trueRange(115, 110, 100);
      expect(result).toBe(15);
    });

    it('calculates TR as |low-prevClose| when that is largest', () => {
      // Gap down scenario: H-L = 5, |H-PC| = 5, |L-PC| = 10
      const result = trueRange(105, 100, 110);
      expect(result).toBe(10);
    });
  });

  describe('trueRangeSeries()', () => {
    it('calculates TR series with first bar using H-L', () => {
      const bars: OHLC[] = [
        { open: 100, high: 105, low: 95, close: 102 },
        { open: 103, high: 108, low: 100, close: 106 },
        { open: 107, high: 112, low: 104, close: 110 },
      ];

      const result = trueRangeSeries(bars);

      // First bar: H-L only = 105-95 = 10
      expect(result[0]).toBe(10);

      // Second bar: max(108-100, |108-102|, |100-102|) = max(8, 6, 2) = 8
      expect(result[1]).toBe(8);

      // Third bar: max(112-104, |112-106|, |104-106|) = max(8, 6, 2) = 8
      expect(result[2]).toBe(8);
    });

    it('returns empty array for empty input', () => {
      expect(trueRangeSeries([])).toEqual([]);
    });
  });
});

describe('ATR (Average True Range)', () => {
  // Generate sample OHLC data for testing
  const generateBars = (count: number): OHLC[] => {
    const bars: OHLC[] = [];
    let price = 100;

    for (let i = 0; i < count; i++) {
      const volatility = 2 + Math.sin(i * 0.5); // Varying volatility
      bars.push({
        open: price,
        high: price + volatility,
        low: price - volatility,
        close: price + (Math.random() - 0.5) * volatility,
      });
      price = bars[i].close;
    }

    return bars;
  };

  describe('atr()', () => {
    it('uses Wilder RMA smoothing (not EMA)', () => {
      const bars = generateBars(30);
      const period = 14;
      const { atr: atrValues, tr } = atr(bars, period);

      // First valid ATR should be SMA of first `period` TR values
      expect(atrValues[period - 1]).not.toBeNaN();

      // Verify it equals SMA
      const firstTRSum = tr.slice(0, period).reduce((a, b) => a + b, 0);
      const expectedFirstATR = firstTRSum / period;
      expect(atrValues[period - 1]).toBeCloseTo(expectedFirstATR);

      // Verify Wilder smoothing is applied
      const expectedNext =
        (atrValues[period - 1] * (period - 1) + tr[period]) / period;
      expect(atrValues[period]).toBeCloseTo(expectedNext);
    });

    it('returns NaN for indices before period-1', () => {
      const bars = generateBars(20);
      const { atr: atrValues } = atr(bars, 14);

      for (let i = 0; i < 13; i++) {
        expect(atrValues[i]).toBeNaN();
      }
    });

    it('throws error for non-positive period', () => {
      const bars = generateBars(10);
      expect(() => atr(bars, 0)).toThrow('ATR period must be positive');
    });
  });

  describe('atrLatest()', () => {
    it('returns latest ATR value', () => {
      const bars = generateBars(30);
      const result = atrLatest(bars, 14);

      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('returns null for insufficient data', () => {
      const bars = generateBars(10);
      const result = atrLatest(bars, 14);

      expect(result).toBeNull();
    });
  });

  describe('atrIncremental()', () => {
    it('calculates next ATR using Wilder formula', () => {
      const period = 14;
      const tr = 5;
      const prevATR = 4;

      const result = atrIncremental(tr, prevATR, period);
      const expected = (prevATR * 13 + tr) / 14;

      expect(result).toBeCloseTo(expected);
    });
  });
});
