import { describe, it, expect } from 'vitest';
import { ema, emaLatest, emaIncremental, emaAlpha } from '../core/ema.js';

describe('EMA (Exponential Moving Average)', () => {
  describe('emaAlpha()', () => {
    it('calculates alpha correctly', () => {
      // alpha = 2 / (period + 1)
      expect(emaAlpha(12)).toBeCloseTo(2 / 13);
      expect(emaAlpha(26)).toBeCloseTo(2 / 27);
      expect(emaAlpha(9)).toBeCloseTo(2 / 10);
    });

    it('throws error for non-positive period', () => {
      expect(() => emaAlpha(0)).toThrow('EMA period must be positive');
      expect(() => emaAlpha(-1)).toThrow('EMA period must be positive');
    });
  });

  describe('ema()', () => {
    it('initializes with SMA and applies EMA formula', () => {
      // Test with period 3
      const values = [10, 11, 12, 13, 14, 15];
      const result = ema(values, 3);

      // First valid EMA at index 2: SMA([10,11,12]) = 11
      expect(result[0]).toBeNaN();
      expect(result[1]).toBeNaN();
      expect(result[2]).toBe(11); // SMA initialization

      // Subsequent values use EMA formula: alpha * value + (1-alpha) * prevEMA
      const alpha = 2 / 4; // period 3
      const expected3 = alpha * 13 + (1 - alpha) * 11;
      expect(result[3]).toBeCloseTo(expected3);

      const expected4 = alpha * 14 + (1 - alpha) * expected3;
      expect(result[4]).toBeCloseTo(expected4);
    });

    it('returns NaN array when insufficient data', () => {
      const values = [1, 2];
      const result = ema(values, 3);

      expect(result.every((v) => Number.isNaN(v))).toBe(true);
    });

    it('returns empty array for empty input', () => {
      const result = ema([], 3);
      expect(result).toEqual([]);
    });

    it('handles period of 1 (same as input)', () => {
      const values = [5, 10, 15];
      const result = ema(values, 1);

      // Period 1: alpha = 1, so EMA = current value
      expect(result).toEqual([5, 10, 15]);
    });
  });

  describe('emaIncremental()', () => {
    it('calculates next EMA value correctly', () => {
      const period = 12;
      const alpha = 2 / 13;
      const currentValue = 100;
      const previousEMA = 95;

      const result = emaIncremental(currentValue, previousEMA, period);
      const expected = alpha * currentValue + (1 - alpha) * previousEMA;

      expect(result).toBeCloseTo(expected);
    });
  });

  describe('emaLatest()', () => {
    it('returns latest EMA value', () => {
      const values = [10, 11, 12, 13, 14, 15];
      const result = emaLatest(values, 3);

      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('returns null for insufficient data', () => {
      const values = [1, 2];
      const result = emaLatest(values, 3);

      expect(result).toBeNull();
    });
  });
});
