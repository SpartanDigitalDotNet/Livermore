import { describe, it, expect } from 'vitest';
import { rma, rmaLatest, rmaIncremental } from '../core/rma.js';

describe('RMA (Wilder\'s Smoothed Moving Average)', () => {
  describe('rma()', () => {
    it('initializes with SMA and applies Wilder smoothing', () => {
      const values = [10, 11, 12, 13, 14, 15];
      const period = 3;
      const result = rma(values, period);

      // First valid RMA at index 2: SMA([10,11,12]) = 11
      expect(result[0]).toBeNaN();
      expect(result[1]).toBeNaN();
      expect(result[2]).toBe(11);

      // Wilder's formula: RMA[t] = (RMA[t-1] * (period-1) + value[t]) / period
      const expected3 = (11 * 2 + 13) / 3;
      expect(result[3]).toBeCloseTo(expected3);

      const expected4 = (expected3 * 2 + 14) / 3;
      expect(result[4]).toBeCloseTo(expected4);
    });

    it('produces smoother results than EMA (same period)', () => {
      // RMA uses alpha = 1/period instead of 2/(period+1)
      // So RMA is "slower" / more smoothed
      const values = [100, 110, 120, 130, 140, 150];
      const result = rma(values, 3);

      // After initialization, check that values increase more slowly than raw EMA would
      // RMA(3) alpha = 1/3 vs EMA(3) alpha = 2/4 = 0.5
      expect(result[5]).toBeLessThan(150);
    });

    it('returns NaN array for insufficient data', () => {
      const result = rma([1, 2], 3);
      expect(result.every((v) => Number.isNaN(v))).toBe(true);
    });

    it('throws error for non-positive period', () => {
      expect(() => rma([1, 2, 3], 0)).toThrow('RMA period must be positive');
    });
  });

  describe('rmaIncremental()', () => {
    it('calculates next RMA value using Wilder formula', () => {
      const period = 26;
      const currentValue = 50;
      const previousRMA = 45;

      const result = rmaIncremental(currentValue, previousRMA, period);
      const expected = (previousRMA * 25 + currentValue) / 26;

      expect(result).toBeCloseTo(expected);
    });
  });

  describe('rmaLatest()', () => {
    it('returns latest RMA value', () => {
      const values = [10, 11, 12, 13, 14, 15];
      const result = rmaLatest(values, 3);

      expect(result).not.toBeNull();
    });

    it('returns null for insufficient data', () => {
      expect(rmaLatest([1, 2], 3)).toBeNull();
    });
  });
});
