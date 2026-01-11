# Exchange Fees - Overview Specification

## Purpose

This document defines the general architecture for handling exchange fees across multiple
cryptocurrency exchanges in the Livermore platform.

## Key Concepts

### Maker vs Taker Fees

| Type | Definition | Typical Use |
|------|------------|-------------|
| **Maker** | Orders that add liquidity to the order book (limit orders that don't execute immediately) | Lower fees, preferred for non-urgent entries |
| **Taker** | Orders that remove liquidity (market orders or limit orders that execute immediately) | Higher fees, used for immediate execution |

### Fee Tiers

Most exchanges implement tiered fee structures based on:
- **30-day trading volume** (most common)
- **Account balance** (some exchanges)
- **Native token holdings** (e.g., BNB for Binance, KCS for Kucoin)
- **VIP/loyalty programs**

### Fee Calculation Timing

| Phase | Purpose |
|-------|---------|
| **Pre-trade** | Estimate fees to calculate breakeven, TP, SL thresholds |
| **Post-trade** | Verify actual fees charged for P&L accuracy |

---

## Platform Architecture

### Per-User Fee Rates

Each user has their own fee rates based on:
1. Their exchange account's tier (volume-based)
2. Any VIP/promotional rates
3. Token-based discounts (if applicable)

### Fee Rate Storage

```
user_exchange_fees table:
  - user_id
  - exchange_id
  - maker_fee_rate (decimal, e.g., 0.0025 = 0.25%)
  - taker_fee_rate (decimal, e.g., 0.0040 = 0.40%)
  - fee_currency (string, e.g., "USD", "BNB")
  - last_synced_at (timestamp)
  - tier_name (string, optional, e.g., "VIP 1")
```

### Fee Sync Strategy

1. **On user login** - Refresh fee tier from exchange API
2. **Daily cron** - Update all active users
3. **Pre-trade** - Use cached rates (avoid API latency)
4. **Post-trade** - Record actual fees from fill response

---

## Pre-Trade Fee Calculation

### Round-Trip Cost Formula

```
entry_fee = position_size * entry_price * taker_fee_rate  (market order)
         OR position_size * entry_price * maker_fee_rate  (limit order)

exit_fee = position_size * exit_price * taker_fee_rate    (market order)
        OR position_size * exit_price * maker_fee_rate    (limit order)

round_trip_cost = entry_fee + exit_fee
round_trip_percent = round_trip_cost / (position_size * entry_price) * 100
```

### Breakeven Calculation

```
For a LONG position with market entry/exit:
  breakeven_move = (taker_fee_rate * 2) * 100  (as percentage)

Example at 0.40% taker:
  breakeven_move = 0.80%  (price must move 0.80% to break even)
```

### Minimum Profitable Trade

```
min_profit_percent = round_trip_percent + desired_profit_percent

Example:
  round_trip = 0.80%
  desired_profit = 0.50%
  min_target = 1.30% above entry
```

---

## Exchange-Specific Specs

Each exchange has its own specification document:

| Exchange | Region | Shorting | Spec File |
|----------|--------|----------|-----------|
| Coinbase | USA | No | `coinbase-advanced.md` |
| Kraken | USA | Yes (margin) | `kraken.md` |
| Binance.com | Non-USA | Yes (futures) | `binance.md` |
| Binance.US | USA | No | `binance-us.md` |
| Kucoin | Non-USA | Yes (futures) | `kucoin.md` |
| MEXC | Non-USA | Yes (futures) | `mexc.md` |

---

## API Response Normalization

Each exchange returns fees differently. Normalize to:

```typescript
interface NormalizedFill {
  exchange: string;
  orderId: string;
  tradeId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  quoteQuantity: number;       // price * quantity
  commission: number;          // fee amount
  commissionAsset: string;     // fee currency (USD, BNB, etc.)
  liquidityType: 'MAKER' | 'TAKER';
  timestamp: number;
}

interface NormalizedFeeTier {
  exchange: string;
  tierName: string;
  makerFeeRate: number;        // decimal (0.001 = 0.1%)
  takerFeeRate: number;
  volumeThresholdUsd: number;  // 30-day volume for this tier
  discountToken?: string;      // BNB, KCS, etc.
  discountPercent?: number;    // additional discount if holding token
}
```

---

## Related Documents

- `coinbase-advanced.md` - Coinbase Advanced Trade specifics
- `kraken.md` - Kraken specifics (USA, supports margin)
- `binance.md` - Binance.com specifics (Kaia's exchange)
- `kucoin.md` - Kucoin specifics (Kaia's exchange)
- `mexc.md` - MEXC specifics (Kaia's exchange)
