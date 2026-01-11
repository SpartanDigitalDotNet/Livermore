# MEXC - Exchange Specification

## Overview

| Attribute | Value |
|-----------|-------|
| **Exchange** | MEXC Global |
| **Region** | Non-USA (restricted in USA) |
| **User** | Kaia |
| **Shorting** | Yes (Futures) |
| **Spot API** | `https://api.mexc.com` |
| **Futures API** | `https://contract.mexc.com` |
| **Authentication** | API Key + HMAC-SHA256 signature |

---

## Fee Structure

### Spot Trading Fees

MEXC is known for **zero maker fees** on spot trading:

| VIP Level | 30-Day Volume (USD) | MX Holdings | Maker | Taker |
|-----------|---------------------|-------------|-------|-------|
| Regular | Any | Any | 0.00% | 0.05% |
| VIP 1 | >= $1M | >= 10,000 | 0.00% | 0.04% |
| VIP 2 | >= $5M | >= 50,000 | 0.00% | 0.035% |
| VIP 3 | >= $10M | >= 100,000 | 0.00% | 0.03% |
| VIP 4 | >= $50M | >= 200,000 | 0.00% | 0.025% |
| VIP 5 | >= $100M | >= 500,000 | 0.00% | 0.02% |

**MX Token Discount:**
- Hold >= 500 MX: 50% discount on fees
- Pay fees with MX: Additional 20% discount

### Futures Trading Fees

MEXC also offers competitive futures fees:

| VIP Level | 30-Day Volume (USD) | Maker | Taker |
|-----------|---------------------|-------|-------|
| Regular | < $10M | 0.00% | 0.02% |
| VIP 1 | >= $10M | 0.00% | 0.018% |
| VIP 2 | >= $50M | 0.00% | 0.016% |
| VIP 3 | >= $100M | 0.00% | 0.015% |
| VIP 4 | >= $250M | 0.00% | 0.014% |
| VIP 5 | >= $500M | 0.00% | 0.012% |

**Promotional:** Some pairs have 0% maker AND 0% taker (140+ pairs as of 2025)

### Funding Fees (Perpetual Futures)

- Charged every **8 hours** (00:00, 08:00, 16:00 UTC)
- Rate varies based on market conditions

---

## API Endpoints

### Get Spot Trade Fee

```
GET /api/v3/tradeFee
```

**Headers:**
```
X-MEXC-APIKEY: <api-key>
```

**Response:**
```json
{
  "symbol": "BTCUSDT",
  "makerCommission": "0",
  "takerCommission": "0.0005"
}
```

### Get Spot Fills (Actual Fees)

```
GET /api/v3/myTrades
```

**Parameters:**
- `symbol` - Trading pair (required)
- `orderId` - Filter by order (optional)

**Response:**
```json
[
  {
    "symbol": "BTCUSDT",
    "id": 28457,
    "orderId": 100234,
    "price": "42500.00",
    "qty": "0.01",
    "quoteQty": "425.00",
    "commission": "0.2125",
    "commissionAsset": "USDT",
    "time": 1499865549590,
    "isBuyer": true,
    "isMaker": false,
    "isBestMatch": true
  }
]
```

**Key Fields:**
- `commission` - Fee charged
- `commissionAsset` - Fee currency
- `isMaker` - true = maker, false = taker

### Get Futures Trade Fee

```
GET /api/v1/private/account/commission_fee
```

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTC_USDT",
    "makerFeeRate": "0",
    "takerFeeRate": "0.0002"
  }
}
```

### Get Futures Fills

```
GET /api/v1/private/order/list/trade_deals
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "orderId": "123456",
      "symbol": "BTC_USDT",
      "positionId": 789,
      "side": 1,
      "price": "42500.00",
      "vol": "0.01",
      "dealVol": "0.01",
      "fee": "0.085",
      "feeCurrency": "USDT",
      "timestamp": 1499865549590,
      "isTaker": true
    }
  ]
}
```

### Get Funding Rate

```
GET /api/v1/contract/funding_rate/BTC_USDT
```

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTC_USDT",
    "fundingRate": "0.0001",
    "nextSettleTime": 1558334902000
  }
}
```

---

## Shorting via Futures

### Contract Types

| Type | Symbol Format | Margin |
|------|---------------|--------|
| USDT-Margined | BTC_USDT | USDT |
| Coin-Margined | BTC_USD | BTC |

### Opening a Short Position

```
POST /api/v1/private/order/submit
```

**Parameters:**
```json
{
  "symbol": "BTC_USDT",
  "side": 2,
  "openType": 2,
  "type": 1,
  "vol": 0.01,
  "leverage": 10
}
```

**Side Values:**
- `1` = Open Long
- `2` = Close Long
- `3` = Open Short
- `4` = Close Short

**Type Values:**
- `1` = Limit
- `2` = Post Only
- `3` = IOC
- `5` = Market

### Closing a Short Position

```json
{
  "symbol": "BTC_USDT",
  "side": 4,
  "type": 5,
  "vol": 0.01
}
```

---

## Symbol Format

| Canonical | MEXC Spot | MEXC Futures |
|-----------|-----------|--------------|
| BTC/USD | BTCUSDT | BTC_USDT |
| ETH/USD | ETHUSDT | ETH_USDT |
| SOL/USD | SOLUSDT | SOL_USDT |

**Note:** Futures uses underscores, spot does not

---

## API Access Restrictions

**Important:** As of 2025, MEXC Futures API is available to **institutional users only**.
Retail traders must apply for API access or use spot API.

```
Contact: newapi@mexc.plus
```

---

## Implementation Notes

### Fee Rate Sync

```typescript
async function syncMexcFees(userId: number, exchangeId: number): Promise<void> {
  // Spot fees
  const spotFee = await mexcClient.get('/api/v3/tradeFee', {
    symbol: 'BTCUSDT',
  });

  // Futures fees (if available)
  let futuresFee = null;
  try {
    futuresFee = await mexcFuturesClient.get('/api/v1/private/account/commission_fee', {
      symbol: 'BTC_USDT',
    });
  } catch (e) {
    // Futures API may not be available for retail
  }

  await db.userExchangeFees.upsert({
    userId,
    exchangeId,
    spotMakerRate: parseFloat(spotFee.makerCommission),
    spotTakerRate: parseFloat(spotFee.takerCommission),
    futuresMakerRate: futuresFee ? parseFloat(futuresFee.data.makerFeeRate) : null,
    futuresTakerRate: futuresFee ? parseFloat(futuresFee.data.takerFeeRate) : null,
    lastSyncedAt: new Date(),
  });
}
```

### Authentication

MEXC uses standard HMAC-SHA256:
```typescript
const timestamp = Date.now();
const queryString = `symbol=BTCUSDT&timestamp=${timestamp}`;
const signature = crypto
  .createHmac('sha256', secretKey)
  .update(queryString)
  .digest('hex');

const headers = {
  'X-MEXC-APIKEY': apiKey,
};

const url = `/api/v3/tradeFee?${queryString}&signature=${signature}`;
```

---

## Rate Limits

| Type | Limit |
|------|-------|
| Spot (general) | 20 requests/second |
| Spot (orders) | 10 requests/second |
| Futures | 20 requests/second |

---

## Competitive Advantage

MEXC's 0% maker fee policy makes it attractive for:
- Market making strategies
- Grid trading
- High-frequency limit order strategies

---

## References

- [MEXC Fee Schedule](https://www.mexc.com/fee)
- [MEXC Spot API Docs](https://mexcdevelop.github.io/apidocs/spot_v3_en/)
- [MEXC Futures API Docs](https://mexcdevelop.github.io/apidocs/contract_v1_en/)
- [MEXC Trading Fees Guide](https://www.mexc.com/learn/article/mexc-fees-explained-complete-trading-futures-withdrawal-fees-guide/1)
