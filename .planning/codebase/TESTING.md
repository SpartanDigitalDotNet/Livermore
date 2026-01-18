# Testing Patterns

**Analysis Date:** 2026-01-18

## Test Framework

**Runner:**
- Vitest 2.1.8
- Config: `packages/indicators/vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`)

**Run Commands:**
```bash
pnpm test                    # Run all tests via turbo (root)
pnpm --filter @livermore/indicators test  # Run indicators tests
pnpm --filter @livermore/indicators test:watch  # Watch mode
```

## Test File Organization

**Location:**
- Co-located in `__tests__` directory within package `src/`
- Pattern: `packages/{package}/src/__tests__/*.test.ts`

**Naming:**
- Test files: `{module-name}.test.ts`
- Match source file name: `sma.ts` -> `sma.test.ts`

**Current Test Files:**
```
packages/indicators/src/__tests__/
  sma.test.ts
  ema.test.ts
  rma.test.ts
  atr.test.ts
  macd-v.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from 'vitest';
import { sma, smaLatest } from '../core/sma.js';

describe('SMA (Simple Moving Average)', () => {
  describe('sma()', () => {
    it('calculates SMA correctly for basic input', () => {
      const values = [1, 2, 3, 4, 5];
      const result = sma(values, 3);
      expect(result).toEqual([2, 3, 4]);
    });

    it('returns empty array when insufficient data', () => {
      const values = [1, 2];
      const result = sma(values, 3);
      expect(result).toEqual([]);
    });

    it('throws error for non-positive period', () => {
      expect(() => sma([1, 2, 3], 0)).toThrow('SMA period must be positive');
    });
  });

  describe('smaLatest()', () => {
    it('returns latest SMA value', () => {
      const values = [1, 2, 3, 4, 5];
      const result = smaLatest(values, 3);
      expect(result).toBe(4);
    });

    it('returns null for insufficient data', () => {
      const values = [1, 2];
      const result = smaLatest(values, 3);
      expect(result).toBeNull();
    });
  });
});
```

**Patterns:**
- Group by function/method using nested `describe()`
- Test name format: `it('verb + expected behavior', ...)`
- Test edge cases: empty input, insufficient data, boundary values
- Test error conditions separately

## Mocking

**Framework:** Vitest built-in mocking (not heavily used in current codebase)

**Patterns:**
- Current tests are pure unit tests for calculation functions
- No external dependencies mocked (indicators are pure functions)

**What to Mock (when needed):**
- External API calls (Coinbase client)
- Database connections
- Redis connections
- Discord webhook calls

**What NOT to Mock:**
- Pure calculation functions
- Internal helper functions
- Zod schema validation

## Fixtures and Factories

**Test Data Generation:**
```typescript
// Generate realistic OHLC data for testing
const generateBars = (count: number, basePrice = 100, volatility = 2): OHLC[] => {
  const bars: OHLC[] = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * volatility;
    const high = price + Math.abs(change) + Math.random() * volatility;
    const low = price - Math.abs(change) - Math.random() * volatility;
    const close = price + change;

    bars.push({ open: price, high, low, close });
    price = close;
  }

  return bars;
};

// Generate trending data for predictable behavior
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
```

**Location:**
- Inline in test files (current approach)
- No shared fixtures directory yet

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
pnpm --filter @livermore/indicators vitest run --coverage
```

## Test Types

**Unit Tests:**
- Scope: Pure functions (indicators, calculations)
- Location: `packages/indicators/src/__tests__/`
- Approach: Direct function calls with known inputs/outputs

**Integration Tests:**
- Scope: System integration (database, Redis, packages)
- Location: `C:\Dev\claude\Livermore\test-setup.ts`
- Run via: `pnpm test-setup`
- Tests:
  - Environment validation
  - PostgreSQL connection
  - Redis connection and caching
  - Zod schema validation
  - Redis pub/sub

**Manual Tests:**
- Location: `C:\Dev\claude\Livermore\tests\manual\`
- Files:
  - `test-discord-webhook.ts` - Discord integration
  - `test-granularity.ts` - Coinbase API timeframes
  - `test-open-orders.ts` - Coinbase orders API
- Run via: `npx tsx tests/manual/test-discord-webhook.ts`

**E2E Tests:**
- Not implemented yet

## Common Patterns

**Async Testing:**
```typescript
it('returns null for insufficient data', async () => {
  const result = await someAsyncFunction();
  expect(result).toBeNull();
});
```

**Error Testing:**
```typescript
it('throws error for non-positive period', () => {
  expect(() => sma([1, 2, 3], 0)).toThrow('SMA period must be positive');
  expect(() => sma([1, 2, 3], -1)).toThrow('SMA period must be positive');
});
```

**Numeric Precision:**
```typescript
it('handles decimal values', () => {
  const values = [1.5, 2.5, 3.5, 4.5];
  const result = sma(values, 2);
  expect(result).toEqual([2, 3, 4]);
});

it('calculates alpha correctly', () => {
  expect(emaAlpha(12)).toBeCloseTo(2 / 13);
});
```

**NaN Handling:**
```typescript
it('returns NaN array when insufficient data', () => {
  const values = [1, 2];
  const result = ema(values, 3);
  expect(result.every((v) => Number.isNaN(v))).toBe(true);
});

it('returns unknown for NaN values', () => {
  expect(classifyMACDVStage(NaN, 100)).toBe('unknown');
});
```

**Table-Driven Tests:**
```typescript
const testCases: Array<{
  macdV: number;
  signal: number;
  expected: MACDVStage;
}> = [
  { macdV: -160, signal: -140, expected: 'oversold' },
  { macdV: 160, signal: 140, expected: 'overbought' },
  { macdV: 100, signal: 80, expected: 'rallying' },
  // ...
];

testCases.forEach(({ macdV, signal, expected }) => {
  it(`classifies MACD-V=${macdV}, Signal=${signal} as ${expected}`, () => {
    const result = classifyMACDVStage(macdV, signal);
    expect(result).toBe(expected);
  });
});
```

**Behavioral Tests:**
```typescript
describe('Trending market behavior', () => {
  it('produces positive MACD-V in strong uptrend', () => {
    const bars = generateTrendingBars(60, 100, 'up', 0.01);
    const result = macdVLatest(bars);

    expect(result).not.toBeNull();
    expect(result!.macdV).toBeGreaterThan(0);
  });

  it('produces negative MACD-V in strong downtrend', () => {
    const bars = generateTrendingBars(60, 100, 'down', 0.01);
    const result = macdVLatest(bars);

    expect(result).not.toBeNull();
    expect(result!.macdV).toBeLessThan(0);
  });
});
```

## Vitest Configuration

**Config File:** `packages/indicators/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

**Key Settings:**
- Globals enabled (no need to import `describe`, `it`, `expect`)
- Node environment
- Include pattern: `src/**/*.test.ts`

## Test Coverage Gaps

**Untested Areas:**

**API Services (`apps/api/src/services/`):**
- `alert-evaluation.service.ts` - No unit tests
- `coinbase-websocket.service.ts` - No unit tests
- `indicator-calculation.service.ts` - No unit tests
- `discord-notification.service.ts` - No unit tests
- Risk: Alert logic could break unnoticed
- Priority: High

**tRPC Routers (`apps/api/src/routers/`):**
- `indicator.router.ts` - No unit tests
- `alert.router.ts` - No unit tests
- `position.router.ts` - No unit tests
- Risk: API contracts could change without detection
- Priority: Medium

**Cache Strategies (`packages/cache/src/strategies/`):**
- `candle-cache.ts` - No unit tests
- `indicator-cache.ts` - No unit tests
- `ticker-cache.ts` - No unit tests
- Risk: Cache corruption or data loss
- Priority: Medium

**Coinbase Client (`packages/coinbase-client/`):**
- `rest/client.ts` - No unit tests
- `websocket/client.ts` - No unit tests
- Risk: API integration failures
- Priority: Medium

**Well-Tested Areas:**
- Core indicators (`packages/indicators/src/core/`)
- MACD-V calculation (`packages/indicators/src/indicators/macd-v.ts`)

## Adding New Tests

**For new indicator functions:**
1. Create `packages/indicators/src/__tests__/{name}.test.ts`
2. Follow existing test structure (nested describes)
3. Test: basic calculation, edge cases, error conditions
4. Use `generateBars()` helper for OHLC data

**For new services:**
1. Consider extracting pure logic into testable functions
2. Mock external dependencies (Redis, database, APIs)
3. Test happy path and error scenarios

---

*Testing analysis: 2026-01-18*
