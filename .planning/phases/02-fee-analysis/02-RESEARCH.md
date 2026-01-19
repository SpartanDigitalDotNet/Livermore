# Phase 2: Fee Analysis - Research

**Researched:** 2026-01-18
**Domain:** TypeScript data aggregation, fee calculations, pure functions
**Confidence:** HIGH

## Summary

This phase implements fee analysis calculations using the order data retrieved in Phase 1. The implementation is straightforward data aggregation work using TypeScript - no external libraries needed beyond what exists in the codebase.

The CoinbaseOrder type provides `total_fees` (string) and `filled_value` (string) fields that need parsing. The calculations are simple arithmetic: sums, groupings by key (symbol, side, month), and division for rates/averages.

The codebase already has patterns for this work: `@livermore/utils` has `sum()` and `mean()` functions, services follow a class-based pattern with typed inputs/outputs, and tests use vitest with the pattern `describe/it/expect`.

**Primary recommendation:** Create pure calculation functions in a new `@livermore/fee-analysis` package (or extend `@livermore/utils`), with comprehensive tests. Keep functions stateless and reusable.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.6.3 | Type-safe implementation | Already in monorepo |
| vitest | 2.1.8 | Unit testing | Already used by @livermore/indicators |
| zod | 3.x | Schema validation for results | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @livermore/utils | workspace | sum(), mean(), roundTo() | Reuse existing math helpers |
| @livermore/schemas | workspace | Type definitions | Define FeeReport types |
| @livermore/coinbase-client | workspace | CoinbaseOrder type | Input type for calculations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual grouping | lodash groupBy | Lodash not in project, simple reduce works |
| Custom sum | @livermore/utils sum | Already exists, use it |

**Installation:**
```bash
# No new dependencies needed - use existing workspace packages
```

## Architecture Patterns

### Recommended Project Structure
```
packages/fee-analysis/          # OR extend utils
├── src/
│   ├── index.ts               # Public exports
│   ├── types.ts               # FeeReport interfaces
│   ├── calculations/
│   │   ├── symbol-fees.ts     # Per-symbol calculations
│   │   ├── side-fees.ts       # Buy/sell breakdowns
│   │   └── monthly-fees.ts    # Monthly aggregations
│   └── __tests__/
│       ├── symbol-fees.test.ts
│       ├── side-fees.test.ts
│       └── monthly-fees.test.ts
└── package.json
```

Alternatively, add to existing `@livermore/utils`:
```
packages/utils/src/
├── fees/
│   ├── symbol-fees.ts
│   ├── side-fees.ts
│   └── monthly-fees.ts
└── __tests__/
    └── fees/
        ├── symbol-fees.test.ts
        ├── side-fees.test.ts
        └── monthly-fees.test.ts
```

### Pattern 1: Pure Calculation Functions
**What:** Functions take CoinbaseOrder[] as input, return typed result objects
**When to use:** All fee calculations
**Example:**
```typescript
// Pure function pattern from existing codebase
import type { CoinbaseOrder } from '@livermore/coinbase-client';

interface SymbolFeeReport {
  symbol: string;
  totalFees: number;
  totalVolume: number;
  effectiveFeeRate: number; // as percentage
  averageFeePerTrade: number;
  orderCount: number;
}

export function calculateSymbolFees(orders: CoinbaseOrder[]): SymbolFeeReport[] {
  // Group by symbol
  const bySymbol = new Map<string, CoinbaseOrder[]>();
  for (const order of orders) {
    const existing = bySymbol.get(order.product_id) ?? [];
    existing.push(order);
    bySymbol.set(order.product_id, existing);
  }

  // Calculate per symbol
  const results: SymbolFeeReport[] = [];
  for (const [symbol, symbolOrders] of bySymbol) {
    const totalFees = symbolOrders.reduce(
      (sum, o) => sum + parseFloat(o.total_fees || '0'),
      0
    );
    const totalVolume = symbolOrders.reduce(
      (sum, o) => sum + parseFloat(o.filled_value || '0'),
      0
    );

    results.push({
      symbol,
      totalFees,
      totalVolume,
      effectiveFeeRate: totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0,
      averageFeePerTrade: symbolOrders.length > 0 ? totalFees / symbolOrders.length : 0,
      orderCount: symbolOrders.length,
    });
  }

  return results.sort((a, b) => b.totalFees - a.totalFees);
}
```

### Pattern 2: Grouping by Composite Keys
**What:** Group orders by multiple dimensions (symbol + side, year-month)
**When to use:** Side analysis, monthly breakdowns
**Example:**
```typescript
interface SideFeeReport {
  symbol: string;
  side: 'BUY' | 'SELL';
  totalFees: number;
  totalVolume: number;
  effectiveFeeRate: number;
  orderCount: number;
}

export function calculateSideFees(orders: CoinbaseOrder[]): SideFeeReport[] {
  // Group by symbol+side composite key
  const byKey = new Map<string, CoinbaseOrder[]>();
  for (const order of orders) {
    const key = `${order.product_id}:${order.side}`;
    const existing = byKey.get(key) ?? [];
    existing.push(order);
    byKey.set(key, existing);
  }

  // ... calculate for each group
}
```

### Pattern 3: Date Grouping with ISO Parsing
**What:** Parse `created_time` (ISO string) to extract year-month
**When to use:** Monthly aggregations
**Example:**
```typescript
interface MonthlyFeeReport {
  yearMonth: string; // "2024-01" format
  totalFees: number;
  totalVolume: number;
  effectiveFeeRate: number;
  orderCount: number;
}

function getYearMonth(isoDate: string): string {
  // "2024-01-15T10:30:00Z" -> "2024-01"
  return isoDate.substring(0, 7);
}

export function calculateMonthlyFees(orders: CoinbaseOrder[]): MonthlyFeeReport[] {
  const byMonth = new Map<string, CoinbaseOrder[]>();
  for (const order of orders) {
    const yearMonth = getYearMonth(order.created_time);
    const existing = byMonth.get(yearMonth) ?? [];
    existing.push(order);
    byMonth.set(yearMonth, existing);
  }

  // ... calculate for each month
  // Sort by yearMonth ascending
}
```

### Anti-Patterns to Avoid
- **Mutating input arrays:** Always create new arrays/objects for results
- **String concatenation for money:** Use Number arithmetic, format only for display
- **Not handling empty orders:** Always check array length before dividing
- **Assuming valid data:** Use `parseFloat(order.total_fees || '0')` to handle missing/undefined

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Summing arrays | Manual loop | `@livermore/utils` `sum()` | Already tested, handles edge cases |
| Averaging | `total / count` | `@livermore/utils` `mean()` | Handles empty arrays correctly |
| Rounding decimals | `Math.round(x * 100) / 100` | `@livermore/utils` `roundTo()` | Cleaner API |
| Type validation | Manual checks | Zod schemas | Consistent with codebase |

**Key insight:** The math utilities in `@livermore/utils` already handle the core operations. Focus on data transformation and grouping.

## Common Pitfalls

### Pitfall 1: Floating Point Arithmetic in Finance
**What goes wrong:** `0.1 + 0.2 !== 0.3` in JavaScript
**Why it happens:** IEEE 754 floating point representation
**How to avoid:**
- Parse strings to numbers only when calculating
- Round final display values with `roundTo(value, 2)` or `roundTo(value, 4)`
- For this use case (fee analysis, not trading), floating point is acceptable
**Warning signs:** Sums don't match expectations, rates show many decimal places

### Pitfall 2: Empty Array Division
**What goes wrong:** `NaN` when dividing by zero orders
**Why it happens:** Forgetting to check array length before average
**How to avoid:**
```typescript
const avg = orders.length > 0 ? total / orders.length : 0;
```
**Warning signs:** `NaN` appearing in results

### Pitfall 3: Undefined Order Fields
**What goes wrong:** `NaN` from `parseFloat(undefined)`
**Why it happens:** Some orders may have missing fields
**How to avoid:**
```typescript
const fees = parseFloat(order.total_fees || '0');
const value = parseFloat(order.filled_value || '0');
```
**Warning signs:** `NaN` in calculations

### Pitfall 4: Date Timezone Issues
**What goes wrong:** Orders grouped in wrong months
**Why it happens:** Local timezone vs UTC confusion
**How to avoid:**
- Use substring extraction on ISO strings (always UTC)
- `order.created_time.substring(0, 7)` gives "YYYY-MM" in UTC
**Warning signs:** Orders appearing in adjacent months unexpectedly

### Pitfall 5: Sorting String Dates
**What goes wrong:** "2024-2" sorts after "2024-10" lexicographically
**Why it happens:** String comparison, not date comparison
**How to avoid:**
- Ensure year-month format is always "YYYY-MM" (zero-padded)
- ISO substring naturally gives this format
**Warning signs:** Months out of order in results

## Code Examples

Verified patterns from existing codebase:

### Parsing String Numbers (from spike)
```typescript
// Source: spikes/fee-analysis/analyze-fees.ts line 120-124
let totalFees = 0;
for (const order of orders) {
  totalFees += parseFloat(order.total_fees || '0');
}
```

### Service Class Pattern (from codebase)
```typescript
// Source: apps/api/src/services/position-sync.service.ts
// Pattern: class with typed methods returning structured data
export class FeeAnalysisService {
  calculateSymbolReport(orders: CoinbaseOrder[]): SymbolFeeReport[] {
    return calculateSymbolFees(orders);
  }

  calculateSideReport(orders: CoinbaseOrder[]): SideFeeReport[] {
    return calculateSideFees(orders);
  }

  calculateMonthlyReport(orders: CoinbaseOrder[]): MonthlyFeeReport[] {
    return calculateMonthlyFees(orders);
  }
}
```

### Test Pattern (from codebase)
```typescript
// Source: packages/indicators/src/__tests__/sma.test.ts
import { describe, it, expect } from 'vitest';
import { calculateSymbolFees } from '../calculations/symbol-fees.js';
import type { CoinbaseOrder } from '@livermore/coinbase-client';

describe('calculateSymbolFees', () => {
  it('calculates totals correctly for single symbol', () => {
    const orders: Partial<CoinbaseOrder>[] = [
      { product_id: 'BTC-USD', total_fees: '10.50', filled_value: '1000.00' },
      { product_id: 'BTC-USD', total_fees: '5.25', filled_value: '500.00' },
    ];

    const result = calculateSymbolFees(orders as CoinbaseOrder[]);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('BTC-USD');
    expect(result[0].totalFees).toBe(15.75);
    expect(result[0].totalVolume).toBe(1500);
    expect(result[0].effectiveFeeRate).toBeCloseTo(1.05, 2); // (15.75/1500)*100
  });

  it('handles empty orders array', () => {
    const result = calculateSymbolFees([]);
    expect(result).toEqual([]);
  });

  it('handles orders with missing fee fields', () => {
    const orders: Partial<CoinbaseOrder>[] = [
      { product_id: 'BTC-USD', total_fees: '', filled_value: '1000.00' },
    ];

    const result = calculateSymbolFees(orders as CoinbaseOrder[]);

    expect(result[0].totalFees).toBe(0);
  });
});
```

### Zod Schema Pattern (from codebase)
```typescript
// Source: packages/schemas/src/position/position.schema.ts
import { z } from 'zod';

export const SymbolFeeReportSchema = z.object({
  symbol: z.string().min(1),
  totalFees: z.number().nonnegative(),
  totalVolume: z.number().nonnegative(),
  effectiveFeeRate: z.number().nonnegative(), // percentage
  averageFeePerTrade: z.number().nonnegative(),
  orderCount: z.number().int().nonnegative(),
});

export const SideFeeReportSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  totalFees: z.number().nonnegative(),
  totalVolume: z.number().nonnegative(),
  effectiveFeeRate: z.number().nonnegative(),
  orderCount: z.number().int().nonnegative(),
});

export const MonthlyFeeReportSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM format
  totalFees: z.number().nonnegative(),
  totalVolume: z.number().nonnegative(),
  effectiveFeeRate: z.number().nonnegative(),
  orderCount: z.number().int().nonnegative(),
});

export type SymbolFeeReport = z.infer<typeof SymbolFeeReportSchema>;
export type SideFeeReport = z.infer<typeof SideFeeReportSchema>;
export type MonthlyFeeReport = z.infer<typeof MonthlyFeeReportSchema>;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| lodash for grouping | Native Map/reduce | ES6+ | No external dep needed |
| moment.js for dates | Native Date/string parsing | 2020+ | Lighter bundle |

**Deprecated/outdated:**
- N/A - this is standard TypeScript data processing

## Open Questions

Things that couldn't be fully resolved:

1. **Where to place fee analysis code?**
   - What we know: Could be new package or extension of utils
   - What's unclear: Project preference for organization
   - Recommendation: Extend `@livermore/utils` with `fees/` subdirectory unless codeowner prefers separate package

2. **Should results be persisted to database?**
   - What we know: Current scope is calculation only
   - What's unclear: Whether reports need historical storage
   - Recommendation: Start with in-memory calculations, add persistence later if needed

3. **Display formatting requirements?**
   - What we know: Need to present fees and rates
   - What's unclear: Specific decimal places, currency formatting
   - Recommendation: Use `roundTo(value, 2)` for currency, `roundTo(value, 4)` for rates

## Sources

### Primary (HIGH confidence)
- `packages/coinbase-client/src/rest/client.ts` - CoinbaseOrder interface (lines 41-94)
- `packages/utils/src/math/calculations.ts` - Existing math utilities
- `packages/indicators/src/__tests__/sma.test.ts` - Test pattern
- `packages/schemas/src/position/position.schema.ts` - Schema pattern
- `spikes/fee-analysis/analyze-fees.ts` - Working spike code

### Secondary (MEDIUM confidence)
- `apps/api/src/services/position-sync.service.ts` - Service class pattern

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all existing patterns
- Architecture: HIGH - Clear patterns from existing codebase
- Pitfalls: HIGH - Standard JavaScript/TypeScript gotchas, well documented

**Research date:** 2026-01-18
**Valid until:** Indefinitely (stable TypeScript patterns)
