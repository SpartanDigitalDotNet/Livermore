# Kucoin - Exchange Specification

## Overview

| Attribute | Value |
|-----------|-------|
| **Exchange** | Kucoin |
| **Region** | Non-USA (restricted in USA) |
| **User** | Kaia |
| **Shorting** | Yes (Futures) |
| **Spot API** | `https://api.kucoin.com` |
| **Futures API** | `https://api-futures.kucoin.com` |
| **Authentication** | API Key + HMAC-SHA256 signature + passphrase |

---

## Fee Structure

### Spot Trading Fees

Based on **30-day trading volume** and **KCS holdings**:

| VIP Level | 30-Day Volume (BTC) | KCS Holdings | Maker | Taker |
|-----------|---------------------|--------------|-------|-------|
| VIP 0 | < 50 | < 1,000 | 0.10% | 0.10% |
| VIP 1 | >= 50 | >= 1,000 | 0.09% | 0.10% |
| VIP 2 | >= 200 | >= 10,000 | 0.07% | 0.09% |
| VIP 3 | >= 500 | >= 20,000 | 0.05% | 0.08% |
| VIP 4 | >= 1,000 | >= 30,000 | 0.03% | 0.07% |
| VIP 5 | >= 2,000 | >= 40,000 | 0.00% | 0.06% |
| VIP 6 | >= 4,000 | >= 50,000 | 0.00% | 0.05% |
| VIP 7 | >= 8,000 | >= 60,000 | 0.00% | 0.045% |
| VIP 8 | >= 15,000 | >= 70,000 | 0.00% | 0.04% |

**KCS Discount:** 20% off fees when paying with KCS

### Futures Trading Fees

| VIP Level | 30-Day Volume (USD) | Maker | Taker |
|-----------|---------------------|-------|-------|
| VIP 0 | < $5M | 0.02% | 0.06% |
| VIP 1 | >= $5M | 0.015% | 0.055% |
| VIP 2 | >= $10M | 0.012% | 0.052% |
| VIP 3 | >= $25M | 0.01% | 0.05% |
| VIP 4 | >= $50M | 0.008% | 0.048% |
| VIP 5 | >= $100M | 0.006% | 0.048% |

**VIP 8-9:** Maker fees can go to 0% or become **rebates** (negative fees)

### Funding Fees (Perpetual Futures)

- Charged every **8 hours** (00:00, 08:00, 16:00 UTC)
- Rate varies based on market conditions
- Funding = Position Value × Funding Rate

---

## API Endpoints

### Get Spot Trade Fee

```
GET /api/v1/trade-fees?symbols=BTC-USDT
```

**Response:**
```json
{
  "code": "200000",
  "data": [
    {
      "symbol": "BTC-USDT",
      "takerFeeRate": "0.001",
      "makerFeeRate": "0.001"
    }
  ]
}
```

### Get Spot Fills (Actual Fees)

```
GET /api/v1/fills
```

**Response:**
```json
{
  "code": "200000",
  "data": {
    "items": [
      {
        "symbol": "BTC-USDT",
        "tradeId": "5c35c02709e4f67d5266954e",
        "orderId": "5c35c02709e4f67d5266954e",
        "side": "buy",
        "price": "42500.00",
        "size": "0.01",
        "funds": "425.00",
        "fee": "0.425",
        "feeRate": "0.001",
        "feeCurrency": "USDT",
        "liquidity": "taker",
        "type": "limit",
        "createdAt": 1547026472000
      }
    ]
  }
}
```

**Key Fields:**
- `fee` - Actual fee charged
- `feeRate` - Applied rate
- `feeCurrency` - Fee asset
- `liquidity` - "maker" or "taker"

### Get Futures Fee (Actual Rate)

```
GET /api/v1/trade-fees?symbol=XBTUSDTM
```

**Response:**
```json
{
  "code": "200000",
  "data": {
    "symbol": "XBTUSDTM",
    "takerFeeRate": "0.0006",
    "makerFeeRate": "0.0002"
  }
}
```

### Get Futures Fills

```
GET /api/v1/fills
```

**Response:**
```json
{
  "code": "200000",
  "data": {
    "items": [
      {
        "symbol": "XBTUSDTM",
        "tradeId": "5ce24c1f0c19fc3c58edc47c",
        "orderId": "5ce24c1f0c19fc3c58edc47c",
        "side": "sell",
        "price": "42500.00",
        "size": 1,
        "value": "0.01",
        "feeRate": "0.0006",
        "fee": "0.00255",
        "feeCurrency": "USDT",
        "liquidity": "taker",
        "createdAt": 1558334902000
      }
    ]
  }
}
```

### Get Funding Rate

```
GET /api/v1/funding-rate/XBTUSDTM/current
```

**Response:**
```json
{
  "code": "200000",
  "data": {
    "symbol": "XBTUSDTM",
    "granularity": 28800000,
    "timePoint": 1558000800000,
    "value": 0.000120
  }
}
```

---

## Shorting via Futures

### Contract Types

| Type | Symbol Format | Margin | Settlement |
|------|---------------|--------|------------|
| USDT-Margined | XBTUSDTM | USDT | Every 8 hours |
| Coin-Margined | XBTUSDM | BTC | Every 8 hours |

### Opening a Short Position

```
POST /api/v1/orders
```

**Parameters:**
```json
{
  "symbol": "XBTUSDTM",
  "side": "sell",
  "type": "market",
  "size": 1,
  "leverage": 10
}
```

**Key Points:**
- `side: "sell"` opens a short
- `leverage` can be 1-100x depending on pair
- `size` is in contracts (1 contract = 0.001 BTC for XBTUSDTM)

### Closing a Short Position

```json
{
  "symbol": "XBTUSDTM",
  "side": "buy",
  "type": "market",
  "size": 1,
  "closeOrder": true
}
```

---

## Symbol Format

| Canonical | Kucoin Spot | Kucoin Futures |
|-----------|-------------|----------------|
| BTC/USD | BTC-USDT | XBTUSDTM |
| ETH/USD | ETH-USDT | ETHUSDTM |
| SOL/USD | SOL-USDT | SOLUSDTM |

**Note:** Futures symbols end in "M" for perpetual

---

## Implementation Notes

### Fee Rate Sync

```typescript
async function syncKucoinFees(userId: number, exchangeId: number): Promise<void> {
  // Spot fees
  const spotFee = await kucoinClient.get('/api/v1/trade-fees', {
    symbols: 'BTC-USDT',
  });

  // Futures fees
  const futuresFee = await kucoinFuturesClient.get('/api/v1/trade-fees', {
    symbol: 'XBTUSDTM',
  });

  await db.userExchangeFees.upsert({
    userId,
    exchangeId,
    spotMakerRate: parseFloat(spotFee.data[0].makerFeeRate),
    spotTakerRate: parseFloat(spotFee.data[0].takerFeeRate),
    futuresMakerRate: parseFloat(futuresFee.data.makerFeeRate),
    futuresTakerRate: parseFloat(futuresFee.data.takerFeeRate),
    lastSyncedAt: new Date(),
  });
}
```

### Authentication

Kucoin requires three headers:
```typescript
const headers = {
  'KC-API-KEY': apiKey,
  'KC-API-SIGN': signature,          // HMAC-SHA256(timestamp + method + path + body)
  'KC-API-TIMESTAMP': timestamp,
  'KC-API-PASSPHRASE': passphrase,   // User-defined passphrase (encrypted in V2)
  'KC-API-KEY-VERSION': '2',
};
```

---

## Rate Limits

| Type | Limit |
|------|-------|
| Spot (public) | 3 requests/second |
| Spot (private) | 6 requests/second |
| Futures | 30 requests/second (REST) |

---

## References

- [Kucoin Fee Schedule](https://www.kucoin.com/vip/level)
- [Kucoin Futures Fees](https://www.kucoin.com/announcement/en-futures-fee)
- [Spot API Documentation](https://www.kucoin.com/docs/rest/spot-trading/fills/get-filled-list)
- [Futures API Documentation](https://www.kucoin.com/docs/rest/futures-trading/fills/get-filled-list)
- [Get Trade Fee API](https://www.kucoin.com/docs-new/rest/account-info/trade-fee/get-actual-fee-futures)
