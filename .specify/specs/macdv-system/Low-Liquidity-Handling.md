# MACD-V Low-Liquidity Handling

## Overview

This document describes how Livermore handles MACD-V calculation for low-liquidity symbols where trading activity is sparse. The core innovation is **Informative ATR** - an ATR calculation that correctly treats missing trade data as missing observations rather than zero-volatility events.

---

## 1) The Problem

### Symptom
MACD-V "explodes" to extreme values (300-500+) on low-liquidity symbols like SKL-USD 1m, far exceeding the normal range of -150 to +150.

### Root Cause
Cryptocurrency exchanges (including Coinbase) **omit candles** for time periods with no trades. From the Coinbase API documentation:

> "No data is published for intervals where there are no ticks."

When our candle gap-filling utility creates synthetic candles to maintain a continuous timeline, these synthetic candles have:
- `open = high = low = close = previousClose`
- Therefore: `True Range = 0`

**The fundamental error:** Standard ATR treats these TR=0 values as legitimate "zero volatility" observations, causing ATR to decay toward zero over time. Since MACD-V = `(spread / ATR) * 100`, dividing by a near-zero ATR causes the result to explode.

### Example
For SKL-USD on a 1-minute timeframe:
- ~60% of candles may be synthetic (no trades occurred)
- These contribute TR=0 to ATR calculation
- ATR collapses from ~$0.0002 to ~$0.00002
- MACD-V explodes: `spread / tiny_ATR * 100 = 396`

---

## 2) The Solution: Informative ATR

### Key Insight
Synthetic candles represent **missing data**, not zero-volatility observations. The correct statistical treatment is to **skip** synthetic candles in ATR calculation entirely.

### Algorithm
1. **Tag candles** with `isSynthetic` flag during gap-filling
   - Original API candles: `isSynthetic: false`
   - Gap-filled candles: `isSynthetic: true`

2. **Calculate ATR using only observed True Ranges**
   - If candle is synthetic: TR is **missing**, carry forward previous ATR
   - If candle is observed: Compute TR normally, update ATR with Wilder smoothing

3. **Require sufficient observations for validity**
   - ATR seeds after 26 **observed** TR samples (not 26 bars)
   - Until seeded, MACD-V returns null with reason: "Low trading activity"

### Mathematical Behavior

**Standard ATR (incorrect for sparse data):**
```
ATR updates every bar, even when TR=0
ATR → 0 as synthetic candles accumulate
MACD-V → ∞
```

**Informative ATR (correct):**
```
ATR only updates on observed (real) candles
ATR remains stable during synthetic periods
MACD-V stays in normal range
```

---

## 3) Implementation Details

### 3.1 Candle Schema Extension

**File:** `packages/schemas/src/market/candle.schema.ts`

```typescript
export const CandleSchema = z.object({
  // ... existing OHLC fields ...

  /** True if this candle was forward-filled due to missing trades (in-memory only) */
  isSynthetic: z.boolean().optional(),
});
```

**Note:** The `isSynthetic` flag is in-memory only and not persisted to Redis.

### 3.2 Gap-Filling Tags Candles

**File:** `packages/utils/src/candle/candle-utils.ts`

The `fillCandleGaps` function now tags each candle:

```typescript
// Original candles from exchange API
filled.push({ ...candles[i], isSynthetic: false });

// Gap-filled candles (no trades occurred)
filled.push({
  timestamp: gapTimestamp,
  open: prevClose,
  high: prevClose,
  low: prevClose,
  close: prevClose,
  volume: 0,
  isSynthetic: true,  // Key: marks as missing data
});
```

### 3.3 Informative ATR Function

**File:** `packages/indicators/src/core/informative-atr.ts`

```typescript
export interface OHLCWithSynthetic extends OHLC {
  /** True if this candle was forward-filled due to missing trades */
  isSynthetic?: boolean;
}

export interface InformativeATRResult {
  /** ATR values (NaN until seeded with sufficient observed TRs) */
  atr: number[];

  /** True Range values (NaN for synthetic candles) */
  tr: number[];

  /** True when ATR has been seeded with `period` observed TR samples */
  seeded: boolean;

  /** Number of observed (non-synthetic) TR samples used */
  nEff: number;

  /** Index where ATR was first seeded (-1 if not seeded) */
  seedIndex: number;

  /** Span in bars from first to last observed TR */
  spanBars: number;
}

export function informativeATR(
  bars: OHLCWithSynthetic[],
  config: { period?: number } = {}
): InformativeATRResult
```

**Key behaviors:**
- Synthetic candles (TR missing): `atrValues[i] = previousATR` (carry forward)
- Observed candles: Compute TR, apply Wilder smoothing
- Seed phase: Collect first `period` observed TRs, then seed with SMA
- Update phase: `ATR = (prevATR * (period - 1) + TR) / period`

### 3.4 MACD-V Uses Informative ATR

**File:** `packages/indicators/src/indicators/macd-v.ts`

```typescript
export interface MACDVSeries {
  macdV: number[];
  signal: number[];
  histogram: number[];
  fastEMA: number[];
  slowEMA: number[];
  atr: number[];

  // Validity metadata
  seeded: boolean;          // True when ATR has sufficient observations
  nEff: number;             // Number of observed TR samples
  spanBars: number;         // Span from first to last observation
  reason?: 'Low trading activity';  // Set when data insufficient
}
```

**Gating logic:**
```typescript
const atrResult = informativeATR(bars, { period: atrPeriod });

if (!atrResult.seeded) {
  return {
    macdV: new Array(bars.length).fill(NaN),
    signal: new Array(bars.length).fill(NaN),
    histogram: new Array(bars.length).fill(NaN),
    // ... other fields ...
    seeded: false,
    nEff: atrResult.nEff,
    spanBars: atrResult.spanBars,
    reason: 'Low trading activity',
  };
}
```

### 3.5 API Response

**File:** `apps/api/src/routers/indicator.router.ts`

The indicator API now returns validity metadata:

```json
{
  "symbol": "SKL-USD",
  "timeframe": "1m",
  "indicator": "macdV",
  "value": {
    "macdV": 95.1,
    "signal": 78.3,
    "histogram": 16.8,
    "stage": "rallying"
  },
  "seeded": true,
  "nEff": 45,
  "spanBars": 120,
  "reason": null
}
```

When insufficient data:
```json
{
  "symbol": "SKL-USD",
  "timeframe": "1m",
  "indicator": "macdV",
  "value": null,
  "seeded": false,
  "nEff": 12,
  "spanBars": 45,
  "reason": "Low trading activity"
}
```

---

## 4) Validity Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `seeded` | boolean | True when ATR has been initialized with 26 observed TR samples |
| `nEff` | number | Number of observed (non-synthetic) TR samples used in calculation |
| `spanBars` | number | Number of bars between first and last observed TR |
| `reason` | string \| null | "Low trading activity" when insufficient observations, null otherwise |

### Interpretation

- **`seeded: true`** - MACD-V values are mathematically valid
- **`seeded: false`** - Insufficient trade data; MACD-V is null
- **High `nEff`** - Symbol has good liquidity
- **Low `nEff` relative to `spanBars`** - Symbol is sparsely traded
- **`reason: "Low trading activity"`** - User-friendly explanation for null values

---

## 5) Design Decisions

### What We Do
1. **Tag candles as synthetic or observed** - Preserves information about data quality
2. **Skip synthetic candles in ATR** - Treats missing data correctly
3. **Gate MACD-V output** - Returns null when data is insufficient
4. **Provide validity metadata** - Lets consumers understand data quality

### What We Don't Do
1. **NO arbitrary ATR floors** - No `ATR = max(ATR, price * 0.1%)` hacks
2. **NO capping MACD-V** - No `Math.min(macdV, 150)` clipping
3. **NO interpolation** - We don't guess what missing trades might have looked like
4. **NO persistence of synthetic flag** - Currently in-memory only (potential future enhancement)

### Rationale
Arbitrary floors and caps are "band-aids" that hide data quality issues. The informative ATR approach is mathematically rigorous: we simply don't count observations that didn't happen.

---

## 6) Acceptance Criteria

### Test 1: Synthetic-heavy symbol (SKL-USD 1m)
- **Before fix:** MACD-V = 396+ (exploded)
- **After fix:** MACD-V = 95.1 (reasonable) or null with reason

### Test 2: High-liquidity symbol (BTC-USD 1m)
- No regression; values match pre-fix behavior
- Nearly all candles are observed, so behavior unchanged

### Test 3: No-trade stretch
- ATR carries forward (doesn't decay toward zero)
- MACD-V remains stable or returns null

### Test 4: Initialization gate
- MACD-V is null until 26 observed TR samples
- Response includes `reason: "Low trading activity"`

---

## 7) Files Changed

| File | Change |
|------|--------|
| `packages/schemas/src/market/candle.schema.ts` | Added optional `isSynthetic` field |
| `packages/utils/src/candle/candle-utils.ts` | Tags candles with `isSynthetic` in gap-filling |
| `packages/indicators/src/core/informative-atr.ts` | **NEW** - ATR that skips synthetic candles |
| `packages/indicators/src/indicators/macd-v.ts` | Uses informative ATR, adds validity metadata |
| `packages/indicators/src/index.ts` | Exports new informativeATR function |
| `apps/api/src/services/indicator-calculation.service.ts` | Passes isSynthetic flag, stores metadata |
| `apps/api/src/routers/indicator.router.ts` | Returns validity metadata in API response |

---

## 8) Future Enhancements (Tech Debt)

- [ ] **Persist `isSynthetic` to Redis** - For audit/replay capabilities
- [ ] **Add `stalenessSeconds`** - Time since last observed trade
- [ ] **Add `spanMinutesForLast26TR`** - How much real time needed for 26 TRs
- [ ] **LOW_CONFIDENCE flag** - When span is abnormally large relative to nEff

---

## 9) References

- **Spiroglou MACD-V specification:** See `MACD-V_Spiroglou_Exact_Formulas.md`
- **Coinbase API behavior:** https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
- **Wilder's ATR:** J. Welles Wilder, "New Concepts in Technical Trading Systems" (1978)
