# Binance.com - Exchange Specification

## Overview

| Attribute | Value |
|-----------|-------|
| **Exchange** | Binance.com |
| **Region** | Non-USA (blocked in USA) |
| **User** | Kaia |
| **Shorting** | Yes (Futures) |
| **Spot API** | `https://api.binance.com` |
| **Futures API** | `https://fapi.binance.com` (USDT-M), `https://dapi.binance.com` (COIN-M) |
| **Authentication** | API Key + HMAC-SHA256 signature |

---

## Fee Structure

### Spot Trading Fees

Based on **30-day BTC trading volume** and **BNB holdings**:

| VIP Level | 30-Day Volume (BTC) | BNB Holdings | Maker | Taker |
|-----------|---------------------|--------------|-------|-------|
| VIP 0 | < 1,000 | < 25 | 0.10% | 0.10% |
| VIP 1 | >= 1,000 | >= 25 | 0.09% | 0.10% |
| VIP 2 | >= 5,000 | >= 100 | 0.08% | 0.10% |
| VIP 3 | >= 20,000 | >= 250 | 0.07% | 0.09% |
| VIP 4 | >= 100,000 | >= 500 | 0.05% | 0.07% |
| VIP 5 | >= 150,000 | >= 1,000 | 0.04% | 0.055% |
| VIP 6 | >= 400,000 | >= 1,750 | 0.03% | 0.04% |
| VIP 7 | >= 800,000 | >= 3,000 | 0.02% | 0.035% |
| VIP 8 | >= 2,000,000 | >= 4,500 | 0.015% | 0.03% |
| VIP 9 | >= 4,000,000 | >= 5,500 | 0.011% | 0.023% |

**BNB Discount:** 25% off spot fees when paying with BNB

### Futures Trading Fees (USDT-M Perpetual)

| VIP Level | 30-Day Volume (USD) | Maker | Taker |
|-----------|---------------------|-------|-------|
| VIP 0 | < $15M | 0.02% | 0.05% |
| VIP 1 | >= $15M | 0.016% | 0.04% |
| VIP 2 | >= $100M | 0.014% | 0.035% |
| VIP 3 | >= $250M | 0.012% | 0.032% |
| VIP 4 | >= $1B | 0.01% | 0.03% |
| VIP 5 | >= $3B | 0.008% | 0.027% |

**BNB Discount:** 10% off futures fees when paying with BNB

### Funding Fees (Perpetual Futures)

- Charged every **8 hours** (00:00, 08:00, 16:00 UTC)
- Rate varies based on market conditions
- Positive rate: longs pay shorts
- Negative rate: shorts pay longs

---

## API Endpoints

### Get Account Trade Fee

```
GET /api/v3/account/commission
```

**Response:**
```json
{
  "symbol": "BTCUSDT",
  "standardCommission": {
    "maker": "0.00100000",
    "taker": "0.00100000"
  },
  "taxCommission": {
    "maker": "0.00000000",
    "taker": "0.00000000"
  },
  "discount": {
    "enabledForAccount": true,
    "enabledForSymbol": true,
    "discountAsset": "BNB",
    "discount": "0.25000000"
  }
}
```

### Get Trades (Spot - Actual Fees)

```
GET /api/v3/myTrades
```

**Response:**
```json
{
  "symbol": "BTCUSDT",
  "id": 28457,
  "orderId": 100234,
  "price": "42500.00",
  "qty": "0.01",
  "quoteQty": "425.00",
  "commission": "0.00001",
  "commissionAsset": "BNB",
  "time": 1499865549590,
  "isBuyer": true,
  "isMaker": false,
  "isBestMatch": true
}
```

**Key Fields:**
- `commission` - Fee amount
- `commissionAsset` - Fee currency (BNB if discount enabled, else quote asset)
- `isMaker` - true = maker rate, false = taker rate

### Futures - Get Commission Rate

```
GET /fapi/v1/commissionRate
```

**Response:**
```json
{
  "symbol": "BTCUSDT",
  "makerCommissionRate": "0.00020000",
  "takerCommissionRate": "0.00050000"
}
```

### Futures - Get Trades (Actual Fees)

```
GET /fapi/v1/userTrades
```

**Response:**
```json
{
  "symbol": "BTCUSDT",
  "id": 123456,
  "orderId": 654321,
  "side": "BUY",
  "price": "42500.00",
  "qty": "0.01",
  "realizedPnl": "0",
  "quoteQty": "425.00",
  "commission": "0.21250000",
  "commissionAsset": "USDT",
  "time": 1499865549590,
  "positionSide": "LONG",
  "maker": false
}
```

### Futures - Get Funding Rate History

```
GET /fapi/v1/fundingRate
```

**Response:**
```json
[
  {
    "symbol": "BTCUSDT",
    "fundingRate": "0.00010000",
    "fundingTime": 1576566000000
  }
]
```

---

## Shorting via Futures

### Opening a Short Position

```
POST /fapi/v1/order
```

**Parameters:**
```json
{
  "symbol": "BTCUSDT",
  "side": "SELL",
  "positionSide": "SHORT",
  "type": "MARKET",
  "quantity": "0.01"
}
```

### Closing a Short Position

```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "positionSide": "SHORT",
  "type": "MARKET",
  "quantity": "0.01"
}
```

### Position Mode

Binance supports two position modes:
- **One-way Mode:** Single position per symbol
- **Hedge Mode:** Separate long and short positions

```
POST /fapi/v1/positionSide/dual
```

---

## Symbol Format

| Canonical | Binance Spot | Binance Futures |
|-----------|--------------|-----------------|
| BTC/USD | BTCUSDT | BTCUSDT |
| ETH/USD | ETHUSDT | ETHUSDT |
| SOL/USD | SOLUSDT | SOLUSDT |

**Note:** Binance uses USDT pairs, not USD

---

## Implementation Notes

### Fee Rate Sync

```typescript
async function syncBinanceFees(userId: number, exchangeId: number): Promise<void> {
  // Spot fees
  const spotFee = await binanceClient.get('/api/v3/account/commission', {
    symbol: 'BTCUSDT',
  });

  // Futures fees
  const futuresFee = await binanceClient.get('/fapi/v1/commissionRate', {
    symbol: 'BTCUSDT',
  });

  await db.userExchangeFees.upsert({
    userId,
    exchangeId,
    spotMakerRate: parseFloat(spotFee.standardCommission.maker),
    spotTakerRate: parseFloat(spotFee.standardCommission.taker),
    futuresMakerRate: parseFloat(futuresFee.makerCommissionRate),
    futuresTakerRate: parseFloat(futuresFee.takerCommissionRate),
    bnbDiscountEnabled: spotFee.discount.enabledForAccount,
    lastSyncedAt: new Date(),
  });
}
```

### Funding Fee Estimation

```typescript
async function estimateFundingCost(
  positionValue: number,
  expectedHoldHours: number
): Promise<number> {
  const fundingRate = await binanceClient.get('/fapi/v1/premiumIndex', {
    symbol: 'BTCUSDT',
  });

  const rate = parseFloat(fundingRate.lastFundingRate);
  const fundingPeriods = Math.ceil(expectedHoldHours / 8);

  return positionValue * rate * fundingPeriods;
}
```

---

## Rate Limits

| Endpoint Type | Limit |
|--------------|-------|
| Request Weight | 1200/minute |
| Order Rate | 10 orders/second, 100,000/day |
| Raw Requests | 5000/5 minutes |

---

## References

- [Binance Fee Schedule](https://www.binance.com/en/fee/schedule)
- [Binance Futures Fees](https://www.binance.com/en/support/faq/360033544231)
- [Spot API Documentation](https://binance-docs.github.io/apidocs/spot/en/)
- [Futures API Documentation](https://binance-docs.github.io/apidocs/futures/en/)
