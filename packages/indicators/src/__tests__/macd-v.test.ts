import { describe, it, expect } from 'vitest';
import {
  macdV,
  macdVLatest,
  macdVWithStage,
  macdVMinBars,
  classifyMACDVStage,
  MACD_V_DEFAULTS,
  type MACDVStage,
} from '../indicators/macd-v.js';
import type { OHLC } from '../core/true-range.js';

describe('MACD-V (Spiroglou)', () => {
  // Generate realistic OHLC data for testing
  const generateBars = (count: number, basePrice = 100, volatility = 2): OHLC[] => {
    const bars: OHLC[] = [];
    let price = basePrice;

    for (let i = 0; i < count; i++) {
      const change = (Math.random() - 0.5) * volatility;
      const high = price + Math.abs(change) + Math.random() * volatility;
      const low = price - Math.abs(change) - Math.random() * volatility;
      const close = price + change;

      bars.push({
        open: price,
        high,
        low,
        close,
      });

      price = close;
    }

    return bars;
  };

  // Generate trending data for predictable MACD-V behavior
  const generateTrendingBars = (
    count: number,
    basePrice: number,
    trend: 'up' | 'down',
    volatilityPct = 0.02
  ): OHLC[] => {
    const bars: OHLC[] = [];
    let price = basePrice;
    const trendFactor = trend === 'up' ? 1.005 : 0.995;

    for (let i = 0; i < count; i++) {
      price *= trendFactor;
      const volatility = price * volatilityPct;

      bars.push({
        open: price,
        high: price + volatility,
        low: price - volatility,
        close: price,
      });
    }

    return bars;
  };

  describe('MACD_V_DEFAULTS', () => {
    it('has Spiroglou default parameters', () => {
      expect(MACD_V_DEFAULTS.fastPeriod).toBe(12);
      expect(MACD_V_DEFAULTS.slowPeriod).toBe(26);
      expect(MACD_V_DEFAULTS.atrPeriod).toBe(26);
      expect(MACD_V_DEFAULTS.signalPeriod).toBe(9);
      expect(MACD_V_DEFAULTS.scale).toBe(100);
    });
  });

  describe('macdV()', () => {
    it('returns empty arrays for empty input', () => {
      const result = macdV([]);

      expect(result.macdV).toEqual([]);
      expect(result.signal).toEqual([]);
      expect(result.histogram).toEqual([]);
    });

    it('returns NaN for insufficient data', () => {
      const bars = generateBars(20);
      const result = macdV(bars);

      // Need 26 bars for slow EMA + signal period
      expect(result.macdV.every((v) => Number.isNaN(v))).toBe(true);
    });

    it('produces valid MACD-V values with sufficient data', () => {
      const bars = generateBars(50);
      const result = macdV(bars);

      // Should have some valid values
      const validValues = result.macdV.filter((v) => !Number.isNaN(v));
      expect(validValues.length).toBeGreaterThan(0);
    });

    it('MACD-V is normalized by ATR and scaled by 100', () => {
      const bars = generateBars(50);
      const result = macdV(bars);

      // MACD-V values should typically be in a reasonable range (-200 to +200)
      // due to ATR normalization
      const validValues = result.macdV.filter((v) => !Number.isNaN(v));

      validValues.forEach((v) => {
        expect(Math.abs(v)).toBeLessThan(500); // Reasonable bound for normalized values
      });
    });

    it('histogram equals MACD-V minus signal', () => {
      const bars = generateBars(60);
      const result = macdV(bars);

      for (let i = 0; i < result.histogram.length; i++) {
        if (
          !Number.isNaN(result.histogram[i]) &&
          !Number.isNaN(result.macdV[i]) &&
          !Number.isNaN(result.signal[i])
        ) {
          expect(result.histogram[i]).toBeCloseTo(
            result.macdV[i] - result.signal[i]
          );
        }
      }
    });

    it('uses custom parameters when provided', () => {
      const bars = generateBars(50);
      const customConfig = {
        fastPeriod: 8,
        slowPeriod: 17,
        atrPeriod: 17,
        signalPeriod: 5,
        scale: 50,
      };

      const result = macdV(bars, customConfig);
      const validValues = result.macdV.filter((v) => !Number.isNaN(v));

      // Should produce values (exact values depend on data)
      expect(validValues.length).toBeGreaterThan(0);
    });
  });

  describe('macdVLatest()', () => {
    it('returns latest MACD-V values', () => {
      const bars = generateBars(60);
      const result = macdVLatest(bars);

      expect(result).not.toBeNull();
      expect(typeof result?.macdV).toBe('number');
      expect(typeof result?.signal).toBe('number');
      expect(typeof result?.histogram).toBe('number');
    });

    it('returns null for insufficient data', () => {
      const bars = generateBars(20);
      const result = macdVLatest(bars);

      expect(result).toBeNull();
    });

    it('includes EMA and ATR values', () => {
      const bars = generateBars(60);
      const result = macdVLatest(bars);

      expect(result).not.toBeNull();
      expect(typeof result?.fastEMA).toBe('number');
      expect(typeof result?.slowEMA).toBe('number');
      expect(typeof result?.atr).toBe('number');
    });
  });

  describe('classifyMACDVStage()', () => {
    const testCases: Array<{
      macdV: number;
      signal: number;
      expected: MACDVStage;
    }> = [
      // Oversold: MACD_V < -150
      { macdV: -160, signal: -140, expected: 'oversold' },
      { macdV: -200, signal: -150, expected: 'oversold' },

      // Overbought: MACD_V > +150 and above signal
      { macdV: 160, signal: 140, expected: 'overbought' },

      // Rallying: +50 < MACD_V < +150 and above signal
      { macdV: 100, signal: 80, expected: 'rallying' },
      { macdV: 60, signal: 50, expected: 'rallying' },

      // Rebounding: -150 < MACD_V < +50 and above signal
      { macdV: 30, signal: 20, expected: 'rebounding' },
      { macdV: -100, signal: -120, expected: 'rebounding' },

      // Reversing: -150 < MACD_V < -50 and below signal
      { macdV: -100, signal: -80, expected: 'reversing' },
      { macdV: -60, signal: -40, expected: 'reversing' },

      // Retracing: MACD_V > -50 and below signal
      { macdV: 100, signal: 120, expected: 'retracing' },
      { macdV: 0, signal: 20, expected: 'retracing' },
      { macdV: -40, signal: -20, expected: 'retracing' },

      // Ranging: -50 < MACD_V < +50 (neutral)
      { macdV: 0, signal: 0, expected: 'ranging' },
      { macdV: 25, signal: 25, expected: 'ranging' },
    ];

    testCases.forEach(({ macdV, signal, expected }) => {
      it(`classifies MACD-V=${macdV}, Signal=${signal} as ${expected}`, () => {
        const result = classifyMACDVStage(macdV, signal);
        expect(result).toBe(expected);
      });
    });

    it('returns unknown for NaN values', () => {
      expect(classifyMACDVStage(NaN, 100)).toBe('unknown');
      expect(classifyMACDVStage(100, NaN)).toBe('unknown');
    });
  });

  describe('macdVWithStage()', () => {
    it('returns MACD-V with stage classification', () => {
      const bars = generateBars(60);
      const result = macdVWithStage(bars);

      expect(result).not.toBeNull();
      expect(result?.stage).toBeDefined();
      expect([
        'oversold',
        'rebounding',
        'rallying',
        'overbought',
        'retracing',
        'reversing',
        'ranging',
        'unknown',
      ]).toContain(result?.stage);
    });

    it('returns null for insufficient data', () => {
      const bars = generateBars(20);
      const result = macdVWithStage(bars);

      expect(result).toBeNull();
    });
  });

  describe('macdVMinBars()', () => {
    it('calculates minimum bars needed with default config', () => {
      const minBars = macdVMinBars();

      // max(26, 26) + 9 = 35
      expect(minBars).toBe(35);
    });

    it('calculates minimum bars with custom config', () => {
      const minBars = macdVMinBars({
        slowPeriod: 30,
        atrPeriod: 20,
        signalPeriod: 5,
      });

      // max(30, 20) + 5 = 35
      expect(minBars).toBe(35);
    });
  });

  describe('Trending market behavior', () => {
    it('produces positive MACD-V in strong uptrend', () => {
      const bars = generateTrendingBars(60, 100, 'up', 0.01);
      const result = macdVLatest(bars);

      expect(result).not.toBeNull();
      // In a strong uptrend, fast EMA > slow EMA, so MACD-V should be positive
      expect(result!.macdV).toBeGreaterThan(0);
    });

    it('produces negative MACD-V in strong downtrend', () => {
      const bars = generateTrendingBars(60, 100, 'down', 0.01);
      const result = macdVLatest(bars);

      expect(result).not.toBeNull();
      // In a strong downtrend, fast EMA < slow EMA, so MACD-V should be negative
      expect(result!.macdV).toBeLessThan(0);
    });
  });
});
