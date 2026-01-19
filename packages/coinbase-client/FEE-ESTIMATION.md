# Coinbase Fee Estimation for Auto-Traders

This document provides guidance for estimating trading fees when building an automated trading system using Coinbase Advanced Trade API.

## Current Fee Tier

| Property | Value |
|----------|-------|
| Tier | Intro 1 |
| Maker Rate | 0.60% |
| Taker Rate | 1.20% |

**Note:** Your actual tier depends on 30-day trailing volume. Higher volume = lower fees.

## Historical Effective Fee Rate

Based on analysis of 1,622 filled orders from November 2022 to January 2026:

| Metric | Value |
|--------|-------|
| Total Volume | $8,455,609 |
| Total Fees | $13,076 |
| **Effective Rate** | **0.155%** |

The effective rate of 0.155% is significantly lower than the nominal taker rate (1.20%) because:
1. Higher volume months achieved better fee tiers
2. Some orders were maker orders (lower fees)
3. Volume-based discounts compound over time

## Fee Estimation Framework

### Per-Trade Estimation

For a single trade, use this formula:

```
Estimated Fee = Trade Size × Fee Rate

Where Fee Rate:
- Conservative (taker): 1.20%
- Moderate (blended): 0.60%
- Optimistic (maker): 0.40%
- Historical average: 0.155%
```

### Round-Trip Cost (Buy + Sell)

For calculating the cost of a complete trade cycle:

```
Round-Trip Cost = Position Size × (Buy Fee Rate + Sell Fee Rate)

Example with $1,000 position:
- Conservative: $1,000 × 2.40% = $24.00
- Moderate:     $1,000 × 1.20% = $12.00
- Historical:   $1,000 × 0.31% = $3.10
```

### Monthly Fee Budget Estimation

For projecting monthly trading costs based on planned activity:

```
Monthly Fees = Monthly Volume × Expected Fee Rate

Example planning $100,000/month volume:
- At Intro 1 tier (taker):  $100,000 × 1.20% = $1,200
- At historical rate:       $100,000 × 0.155% = $155
```

## Volume-Based Fee Scaling

Coinbase fees decrease with higher 30-day volume. Estimated breakpoints:

| 30-Day Volume | Approximate Taker Rate | Expected Effective Rate |
|---------------|------------------------|-------------------------|
| < $1K | 1.20% | 0.80% - 1.00% |
| $1K - $10K | 0.60% | 0.40% - 0.60% |
| $10K - $50K | 0.40% | 0.25% - 0.40% |
| $50K - $100K | 0.25% | 0.15% - 0.25% |
| $100K - $500K | 0.15% | 0.10% - 0.15% |
| > $500K | 0.10% | 0.07% - 0.10% |

## Recommendations for Auto-Traders

### 1. Use Conservative Estimates for Profitability Calculations

When determining if a trade is profitable, assume the higher taker rate:

```
Minimum Required Profit = Round-Trip Fees + Slippage Buffer
                        = (2 × 1.20%) + 0.5%
                        = 2.90%
```

### 2. Track Actual vs Estimated Fees

Monitor the ratio of actual fees to estimated fees:

```typescript
const feeAccuracy = actualFees / estimatedFees;
// Adjust estimates if consistently > 1.0 or < 0.5
```

### 3. Consider Maker vs Taker Strategy

- **Taker orders** (market orders): Immediate execution, higher fees
- **Maker orders** (limit orders): May not fill, but ~50% lower fees

For an auto-trader, consider:
- Using limit orders for non-urgent entries
- Using market orders only when timing is critical

### 4. Account for Fee Variation by Symbol

Historical data shows effective rates vary significantly by symbol:

| Symbol | Effective Rate | Notes |
|--------|---------------|-------|
| SHIB-USDC | 0.149% | High volume, good rate |
| HBAR-USDC | 0.117% | High volume |
| TOSHI-USDC | 0.245% | Lower volume |
| CAKE-USDC | 0.500% | Low volume, high fees |

Budget higher fees (0.3-0.5%) for low-liquidity tokens.

### 5. Monthly Volume Planning

To optimize fees, consider:
- Concentrating volume in specific 30-day windows
- Trading higher volumes during favorable market conditions
- Maintaining consistent volume to preserve tier benefits

## Fee Budget Template

For planning an auto-trader's fee budget:

```
Daily Trades:        ___ trades/day
Average Trade Size:  $___
Daily Volume:        $___
Monthly Volume:      $___  (daily × 30)

Estimated Monthly Fees:
  Conservative (1.2%): $___
  Moderate (0.6%):     $___
  Optimistic (0.15%):  $___

Fee as % of Expected Returns:
  If targeting 5% monthly return: ___% of profits to fees
```

## Key Takeaways

1. **Plan for 0.6% per trade** as a safe middle estimate
2. **Historical data shows 0.155%** is achievable with volume
3. **Round-trip costs matter** - factor in both buy and sell fees
4. **Volume compounds** - higher volume = better tiers = lower fees
5. **Track actuals** - adjust estimates based on real performance

---

*Based on analysis of 1,622 orders ($8.4M volume, $13K fees) from 2022-2026*
*Generated from fee-analysis spike - see `spikes/fee-analysis/` for details*
