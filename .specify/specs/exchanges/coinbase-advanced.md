# Coinbase Advanced Trade - Exchange Specification

## Overview

| Attribute | Value |
|-----------|-------|
| **Exchange** | Coinbase Advanced Trade |
| **Region** | USA (primary) |
| **Shorting** | No (spot only) |
| **API Base URL** | `https://api.coinbase.com/api/v3/brokerage` |
| **Authentication** | JWT (ES256) with CDP API Key |
| **WebSocket** | `wss://advanced-trade-ws.coinbase.com` |

---

## Fee Structure

### Tiered Maker/Taker Fees

Based on **30-day USD trading volume**:

| 30-Day Volume | Taker Fee | Maker Fee |
|---------------|-----------|-----------|
| $0 - $1,000 | 1.20% | 0.60% |
| $1,000 - $10,000 | 0.75% | 0.35% |
| $10,000 - $50,000 | 0.40% | 0.25% |
| $50,000 - $100,000 | 0.25% | 0.15% |
| $100,000 - $1M | 0.20% | 0.10% |
| $1M - $25M | 0.15% | 0.08% |
| $25M - $100M | 0.10% | 0.05% |
| $100M - $250M | 0.08% | 0.02% |
| $250M - $400M | 0.05% | 0.00% |
| $400M+ | 0.05% | 0.00% |

### Stablecoin Pairs

For stable-to-stable pairs (USDT/EUR, WBTC/BTC, etc.):
- Maker: 0.00%
- Taker: 0.10% - 0.45% (based on tier)

### VIP Fee Matching

Traders with >$500K monthly volume can submit proof of volume from other exchanges
for a 60-day fee upgrade.

---

## API Endpoints

### Get User's Fee Tier

```
GET /api/v3/brokerage/transaction_summary
```

**Response:**
```json
{
  "total_volume": 125000.50,
  "total_fees": 312.50,
  "fee_tier": {
    "pricing_tier": "Advanced 3",
    "usd_from": "50000",
    "usd_to": "100000",
    "taker_fee_rate": "0.0025",
    "maker_fee_rate": "0.0015"
  },
  "margin_rate": null,
  "goods_and_services_tax": null,
  "advanced_trade_only_volume": 125000.50,
  "advanced_trade_only_fees": 312.50,
  "coinbase_pro_volume": 0,
  "coinbase_pro_fees": 0
}
```

**Key Fields:**
- `fee_tier.taker_fee_rate` - Current taker rate (decimal string)
- `fee_tier.maker_fee_rate` - Current maker rate (decimal string)
- `advanced_trade_only_volume` - 30-day volume for tier calculation

### Get Fills (Actual Fees)

```
GET /api/v3/brokerage/orders/historical/fills
```

**Query Parameters:**
- `order_id` - Filter by specific order
- `product_id` - Filter by trading pair (e.g., "BTC-USD")
- `start_date` / `end_date` - Date range (RFC3339)
- `limit` - Max results (default 100)
- `cursor` - Pagination

**Response:**
```json
{
  "fills": [
    {
      "entry_id": "abc123",
      "trade_id": "12345",
      "order_id": "order-xyz",
      "trade_time": "2024-01-15T10:30:00Z",
      "trade_type": "FILL",
      "price": "42500.00",
      "size": "0.01",
      "commission": "1.70",
      "product_id": "BTC-USD",
      "sequence_timestamp": "2024-01-15T10:30:00.123Z",
      "liquidity_indicator": "TAKER",
      "side": "BUY",
      "user_id": "user-123"
    }
  ],
  "cursor": "next-page-cursor"
}
```

**Key Fields:**
- `commission` - Actual fee charged (string, in quote currency)
- `liquidity_indicator` - "MAKER" or "TAKER"
- `price`, `size` - Execution details

---

## Order Types

| Order Type | Liquidity | Fee Type |
|------------|-----------|----------|
| Market Order | Removes | Taker |
| Limit Order (IOC) | Removes | Taker |
| Limit Order (GTC, resting) | Adds | Maker |
| Stop-Limit (triggers as limit) | Depends | Depends |

---

## Order Management

### List Orders (Open/Pending)

```
GET /api/v3/brokerage/orders/historical/batch
```

**Query Parameters:**
- `order_status` - Filter by status (can repeat for multiple)
  - `OPEN` - Orders on book waiting to fill
  - `PENDING` - Orders submitted, awaiting matching engine
  - `FILLED` - Completed orders
  - `CANCELLED` - Cancelled orders
  - `EXPIRED` - GTT orders that expired
  - `FAILED` - Rejected orders
- `product_id` - Filter by trading pair (e.g., "BTC-USD")
- `order_type` - Filter by type (MARKET, LIMIT, STOP_LIMIT)
- `order_side` - Filter by side (BUY, SELL)
- `start_date` / `end_date` - Date range (RFC3339)
- `limit` - Max results (default 100, max 1000)
- `cursor` - Pagination

**Example - Get Open Orders:**
```
GET /api/v3/brokerage/orders/historical/batch?order_status=OPEN&order_status=PENDING
```

**Response:**
```json
{
  "orders": [
    {
      "order_id": "0000-0000-0000-0001",
      "client_order_id": "my-order-123",
      "product_id": "BTC-USD",
      "side": "BUY",
      "status": "OPEN",
      "time_in_force": "GTC",
      "created_time": "2024-01-15T10:30:00Z",
      "completion_percentage": "0",
      "filled_size": "0",
      "average_filled_price": "0",
      "fee": "",
      "number_of_fills": "0",
      "filled_value": "0",
      "pending_cancel": false,
      "size_in_quote": false,
      "total_fees": "0",
      "size_inclusive_of_fees": false,
      "total_value_after_fees": "0",
      "trigger_status": "INVALID_ORDER_TYPE",
      "order_type": "LIMIT",
      "reject_reason": "REJECT_REASON_UNSPECIFIED",
      "settled": false,
      "product_type": "SPOT",
      "reject_message": "",
      "cancel_message": "",
      "order_placement_source": "RETAIL_ADVANCED",
      "outstanding_hold_amount": "425.00",
      "order_configuration": {
        "limit_limit_gtc": {
          "base_size": "0.01",
          "limit_price": "42500.00",
          "post_only": false
        }
      }
    }
  ],
  "sequence": "123456",
  "has_next": false,
  "cursor": ""
}
```

### Order Status Values

| Status | Description |
|--------|-------------|
| `PENDING` | Order submitted, awaiting matching engine |
| `OPEN` | Order on book, waiting to be filled |
| `FILLED` | Order completely filled |
| `CANCELLED` | Order cancelled by user or system |
| `EXPIRED` | GTT order expired |
| `FAILED` | Order rejected by exchange |
| `UNKNOWN_ORDER_STATUS` | Unknown state |

### Order Configuration Types

Coinbase uses `order_configuration` object with type-specific nested objects:

| Order Type | Config Key | Key Fields |
|------------|------------|------------|
| Market (quote) | `market_market_ioc` | `quote_size` |
| Market (base) | `market_market_ioc` | `base_size` |
| Limit GTC | `limit_limit_gtc` | `base_size`, `limit_price`, `post_only` |
| Limit GTD | `limit_limit_gtd` | `base_size`, `limit_price`, `end_time`, `post_only` |
| Stop-Limit GTC | `stop_limit_stop_limit_gtc` | `base_size`, `limit_price`, `stop_price`, `stop_direction` |
| Stop-Limit GTD | `stop_limit_stop_limit_gtd` | `base_size`, `limit_price`, `stop_price`, `end_time`, `stop_direction` |

### Get Single Order

```
GET /api/v3/brokerage/orders/historical/{order_id}
```

**Response:** Same structure as single order in list response.

### Cancel Order

```
POST /api/v3/brokerage/orders/batch_cancel
```

**Request:**
```json
{
  "order_ids": ["order-id-1", "order-id-2"]
}
```

**Response:**
```json
{
  "results": [
    {
      "success": true,
      "order_id": "order-id-1"
    },
    {
      "success": false,
      "order_id": "order-id-2",
      "failure_reason": "UNKNOWN_CANCEL_ORDER"
    }
  ]
}
```

### Edit Order (Limit Orders Only)

```
POST /api/v3/brokerage/orders/edit
```

**Request:**
```json
{
  "order_id": "order-id-1",
  "price": "43000.00",
  "size": "0.02"
}
```

**Note:** Only unfilled limit orders can be edited. This is atomic (cancel + replace).

---

## Implementation Notes

### Fee Rate Sync

```typescript
// Sync user's fee tier from Coinbase
async function syncCoinbaseFees(userId: number, exchangeId: number): Promise<void> {
  const response = await coinbaseClient.getTransactionSummary();

  await db.userExchangeFees.upsert({
    userId,
    exchangeId,
    makerFeeRate: parseFloat(response.fee_tier.maker_fee_rate),
    takerFeeRate: parseFloat(response.fee_tier.taker_fee_rate),
    tierName: response.fee_tier.pricing_tier,
    lastSyncedAt: new Date(),
  });
}
```

### Pre-Trade Calculation

```typescript
interface TradeFeeEstimate {
  entryFee: number;
  exitFee: number;
  roundTripFee: number;
  roundTripPercent: number;
  breakEvenPrice: number;
}

function estimateTradeFees(
  entryPrice: number,
  quantity: number,
  makerRate: number,
  takerRate: number,
  orderType: 'MARKET' | 'LIMIT'
): TradeFeeEstimate {
  const positionValue = entryPrice * quantity;
  const feeRate = orderType === 'MARKET' ? takerRate : makerRate;

  const entryFee = positionValue * feeRate;
  const exitFee = positionValue * feeRate;  // Assume same order type for exit
  const roundTripFee = entryFee + exitFee;
  const roundTripPercent = (roundTripFee / positionValue) * 100;

  // For LONG: price must rise by roundTripPercent to break even
  const breakEvenPrice = entryPrice * (1 + roundTripPercent / 100);

  return {
    entryFee,
    exitFee,
    roundTripFee,
    roundTripPercent,
    breakEvenPrice,
  };
}
```

### Post-Trade Verification

```typescript
async function recordActualFees(orderId: string): Promise<void> {
  const fills = await coinbaseClient.getFills({ orderId });

  let totalCommission = 0;
  for (const fill of fills) {
    totalCommission += parseFloat(fill.commission);
  }

  await db.trades.update({
    where: { orderId },
    data: { actualFee: totalCommission },
  });
}
```

---

## Limitations

1. **No Shorting** - Coinbase Advanced is spot-only
2. **No Futures** - Use Coinbase Financial Markets (separate platform) for futures
3. **USD Pairs Only** - Most liquid pairs are XXX-USD or XXX-USDC
4. **Rate Limits** - 10 requests/second per IP for REST API

---

## References

- [Coinbase Advanced fees](https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/advanced-trade-fees)
- [Get Transaction Summary API](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/fees/get-transaction-summary)
- [List Fills API](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/list-fills)
- [Advanced Trade API Overview](https://docs.cdp.coinbase.com/advanced-trade/docs/welcome)
