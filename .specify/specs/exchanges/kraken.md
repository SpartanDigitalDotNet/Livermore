# Kraken - Exchange Specification

## Overview

| Attribute | Value |
|-----------|-------|
| **Exchange** | Kraken |
| **Region** | USA (available) |
| **Shorting** | Yes (margin trading) |
| **Futures** | Yes (Kraken Futures) |
| **API Base URL** | `https://api.kraken.com` |
| **Futures API** | `https://futures.kraken.com/derivatives/api/v3` |
| **Authentication** | API-Key + HMAC-SHA512 signature |

---

## Fee Structure

### Spot Trading Fees (Kraken Pro)

Based on **30-day USD trading volume**:

| 30-Day Volume | Taker Fee | Maker Fee |
|---------------|-----------|-----------|
| $0 - $10,000 | 0.40% | 0.25% |
| $10,000 - $50,000 | 0.35% | 0.20% |
| $50,000 - $100,000 | 0.24% | 0.14% |
| $100,000 - $250,000 | 0.22% | 0.12% |
| $250,000 - $500,000 | 0.20% | 0.10% |
| $500,000 - $1M | 0.18% | 0.08% |
| $1M - $2.5M | 0.16% | 0.06% |
| $2.5M - $5M | 0.14% | 0.04% |
| $5M - $10M | 0.12% | 0.02% |
| $10M+ | 0.08% | 0.00% |

### Margin Trading Fees

Additional fees for margin (leveraged) positions:

| Fee Type | Rate | Notes |
|----------|------|-------|
| **Opening Fee** | 0.01% - 0.02% | Charged when opening position |
| **Rollover Fee** | 0.01% - 0.02% | Charged every 4 hours |
| **BTC Margin** | 0.01% | Opening and rollover |
| **USD Margin** | 0.025% | Opening and rollover |

**Note:** Standard spot trading fees also apply to margin trades.

### Futures Trading Fees

| 30-Day Volume | Taker Fee | Maker Fee |
|---------------|-----------|-----------|
| $0 - $100,000 | 0.05% | 0.02% |
| $100,000 - $1M | 0.04% | 0.015% |
| $1M - $5M | 0.035% | 0.0125% |
| $5M - $15M | 0.035% | 0.01% |
| $15M+ | 0.035% | 0.01% |

---

## API Endpoints

### Get Trade Volume (Fee Tier)

```
POST /0/private/TradeVolume
```

**Parameters:**
- `pair` - Comma-delimited list of asset pairs (required for fee info)

**Response:**
```json
{
  "error": [],
  "result": {
    "currency": "ZUSD",
    "volume": "125000.5000",
    "fees": {
      "XXBTZUSD": {
        "fee": "0.2400",
        "minfee": "0.0800",
        "maxfee": "0.2600",
        "nextfee": "0.2200",
        "nextvolume": "250000.0000",
        "tiervolume": "100000.0000"
      }
    },
    "fees_maker": {
      "XXBTZUSD": {
        "fee": "0.1400",
        "minfee": "0.0000",
        "maxfee": "0.1600",
        "nextfee": "0.1200",
        "nextvolume": "250000.0000",
        "tiervolume": "100000.0000"
      }
    }
  }
}
```

**Key Fields:**
- `fees.{pair}.fee` - Current taker fee (percentage)
- `fees_maker.{pair}.fee` - Current maker fee (percentage)
- `volume` - 30-day trading volume

### Get Trade History (Actual Fees)

```
POST /0/private/TradesHistory
```

**Response:**
```json
{
  "error": [],
  "result": {
    "trades": {
      "TXID-123": {
        "ordertxid": "ORDER-456",
        "pair": "XXBTZUSD",
        "time": 1704931200.1234,
        "type": "buy",
        "ordertype": "limit",
        "price": "42500.00",
        "cost": "425.00",
        "fee": "1.02",
        "vol": "0.01000000",
        "margin": "0.00000000",
        "misc": ""
      }
    },
    "count": 1
  }
}
```

**Key Fields:**
- `fee` - Actual fee charged (in quote currency)
- `cost` - Total trade value
- `margin` - Margin amount if margin trade

### Get Trade Balance (Margin Info)

```
POST /0/private/TradeBalance
```

**Response:**
```json
{
  "error": [],
  "result": {
    "eb": "10000.0000",
    "tb": "9500.0000",
    "m": "500.0000",
    "n": "-50.0000",
    "c": "1000.0000",
    "v": "1050.0000",
    "e": "9550.0000",
    "mf": "9000.0000",
    "ml": "19.10"
  }
}
```

**Key Fields:**
- `eb` - Equivalent balance (total)
- `tb` - Trade balance
- `m` - Margin amount of open positions
- `mf` - Free margin
- `ml` - Margin level (%)

---

## Shorting via Margin

### Opening a Short Position

```
POST /0/private/AddOrder
```

**Parameters:**
```json
{
  "pair": "XXBTZUSD",
  "type": "sell",
  "ordertype": "market",
  "volume": "0.01",
  "leverage": "2:1"
}
```

**Key Points:**
- `type: "sell"` with `leverage` opens a short
- Leverage options: 2x, 3x, 4x, 5x (varies by pair)
- Margin requirements apply
- Rollover fees every 4 hours

### Closing a Short Position

```json
{
  "pair": "XXBTZUSD",
  "type": "buy",
  "ordertype": "market",
  "volume": "0.01",
  "leverage": "2:1"
}
```

---

## Implementation Notes

### Fee Rate Sync

```typescript
async function syncKrakenFees(userId: number, exchangeId: number): Promise<void> {
  const response = await krakenClient.privateRequest('TradeVolume', {
    pair: 'XXBTZUSD',  // Primary trading pair
  });

  const result = response.result;
  const fees = result.fees['XXBTZUSD'];
  const feesMaker = result.fees_maker['XXBTZUSD'];

  await db.userExchangeFees.upsert({
    userId,
    exchangeId,
    makerFeeRate: parseFloat(feesMaker.fee) / 100,  // Convert to decimal
    takerFeeRate: parseFloat(fees.fee) / 100,
    tierVolume: parseFloat(result.volume),
    lastSyncedAt: new Date(),
  });
}
```

### Margin Fee Calculation

```typescript
interface MarginFeeEstimate {
  openingFee: number;
  rolloverFeePerHour: number;
  estimatedHoldingCost: number;  // For expected hold duration
}

function estimateMarginFees(
  positionValue: number,
  openingFeeRate: number,      // 0.0002 for 0.02%
  rolloverFeeRate: number,     // 0.0002 for 0.02% per 4 hours
  expectedHoldHours: number
): MarginFeeEstimate {
  const openingFee = positionValue * openingFeeRate;
  const rolloverPeriods = Math.ceil(expectedHoldHours / 4);
  const rolloverCost = positionValue * rolloverFeeRate * rolloverPeriods;

  return {
    openingFee,
    rolloverFeePerHour: (positionValue * rolloverFeeRate) / 4,
    estimatedHoldingCost: openingFee + rolloverCost,
  };
}
```

---

## Symbol Format

Kraken uses unique asset codes:

| Symbol | Kraken Pair |
|--------|-------------|
| BTC/USD | XXBTZUSD |
| ETH/USD | XETHZUSD |
| SOL/USD | SOLUSD |

**Mapping Required:** Convert between canonical symbols and Kraken format.

---

## Limitations

1. **Rate Limits** - 1 request/second default, higher for some endpoints
2. **Margin Pairs** - Not all pairs support margin trading
3. **USA Restrictions** - Some features may be limited for US users

---

## References

- [Kraken Fee Schedule](https://www.kraken.com/features/fee-schedule)
- [Get Trade Volume API](https://docs.kraken.com/api/docs/rest-api/get-trade-volume/)
- [Get Trade Balance API](https://docs.kraken.com/api/docs/rest-api/get-trade-balance/)
- [Get Trades History API](https://docs.kraken.com/api/docs/rest-api/get-trade-history/)
- [Kraken API Center](https://docs.kraken.com/api/)
