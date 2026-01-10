import { describe, it, expect } from 'vitest';
import { sma, smaLatest } from '../core/sma.js';

describe('SMA (Simple Moving Average)', () => {
  describe('sma()', () => {
    it('calculates SMA correctly for basic input', () => {
      const values = [1, 2, 3, 4, 5];
      const result = sma(values, 3);

      // SMA(3) of [1,2,3] = 2, [2,3,4] = 3, [3,4,5] = 4
      expect(result).toEqual([2, 3, 4]);
    });

    it('returns empty array when insufficient data', () => {
      const values = [1, 2];
      const result = sma(values, 3);

      expect(result).toEqual([]);
    });

    it('returns single value when period equals length', () => {
      const values = [10, 20, 30];
      const result = sma(values, 3);

      expect(result).toEqual([20]);
    });

    it('throws error for non-positive period', () => {
      expect(() => sma([1, 2, 3], 0)).toThrow('SMA period must be positive');
      expect(() => sma([1, 2, 3], -1)).toThrow('SMA period must be positive');
    });

    it('handles period of 1', () => {
      const values = [5, 10, 15];
      const result = sma(values, 1);

      expect(result).toEqual([5, 10, 15]);
    });

    it('handles decimal values', () => {
      const values = [1.5, 2.5, 3.5, 4.5];
      const result = sma(values, 2);

      expect(result).toEqual([2, 3, 4]);
    });
  });

  describe('smaLatest()', () => {
    it('returns latest SMA value', () => {
      const values = [1, 2, 3, 4, 5];
      const result = smaLatest(values, 3);

      // Last 3 values: [3, 4, 5], average = 4
      expect(result).toBe(4);
    });

    it('returns null for insufficient data', () => {
      const values = [1, 2];
      const result = smaLatest(values, 3);

      expect(result).toBeNull();
    });
  });
});
