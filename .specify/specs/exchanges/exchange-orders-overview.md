# Exchange Orders - Overview Specification

## Purpose

This document defines the architecture for retrieving and managing open orders across
multiple cryptocurrency exchanges in the Livermore platform.

## Use Cases

1. **Order Awareness** - System knows about user's existing open orders
2. **Order Cancellation** - User can cancel pending orders through the platform
3. **Order Modification** - User can modify limit order prices/quantities
4. **Risk Management** - Calculate exposure from open orders before placing new ones
5. **Duplicate Prevention** - Avoid placing duplicate orders at same price level

---

## Order States

### Standard Order Lifecycle

```
PENDING → OPEN → FILLED
              ↘ CANCELLED
              ↘ EXPIRED
              ↘ FAILED
```

| Status | Description | Action Available |
|--------|-------------|------------------|
| PENDING | Order submitted, awaiting matching engine | Cancel |
| OPEN | Order on order book, waiting to be filled | Cancel, Modify |
| FILLED | Order completely executed | None |
| CANCELLED | Order cancelled by user or system | None |
| EXPIRED | Time-in-force expired (GTT orders) | None |
| FAILED | Order rejected by exchange | None |

### Partial Fills

Orders can be partially filled:
- `filled_size` / `size` = fill percentage
- Remaining quantity still OPEN
- Can cancel remaining portion

---

## Normalized Order Schema

```typescript
interface NormalizedOrder {
  // Identifiers
  exchange: string;              // 'coinbase', 'kraken', etc.
  orderId: string;               // Exchange-assigned order ID
  clientOrderId?: string;        // User-assigned ID (for tracking)

  // Order Details
  symbol: string;                // Canonical symbol (e.g., 'BTC-USD')
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LIMIT' | 'STOP_MARKET';
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

  // Quantities
  size: number;                  // Original order size
  filledSize: number;            // Amount filled
  remainingSize: number;         // size - filledSize

  // Prices
  price?: number;                // Limit price (if limit order)
  stopPrice?: number;            // Stop trigger price (if stop order)
  averageFilledPrice?: number;   // Average execution price

  // Value
  quoteSize?: number;            // For market orders: spend/receive amount in quote
  filledValue?: number;          // Total filled value in quote currency

  // Time
  createdAt: number;             // Unix timestamp (ms)
  updatedAt?: number;            // Last update timestamp
  expiresAt?: number;            // GTT expiration (if applicable)

  // Time-in-Force
  timeInForce: 'GTC' | 'IOC' | 'FOK' | 'GTT';

  // Flags
  postOnly?: boolean;            // Maker-only order
  reduceOnly?: boolean;          // Close position only (futures)
}
```

---

## Storage Strategy

### Current Decision: Redis Only (No Database)

**Rationale:**
- Orders are transient (OPEN orders become FILLED/CANCELLED)
- Need fast access for pre-trade checks
- Privacy concerns about persisting order history
- Historical orders available via exchange API if needed

### Redis Key Structure

```
orders:{userId}:{exchangeId}:open        → Hash of open orders
orders:{userId}:{exchangeId}:last_sync   → Timestamp of last sync
```

### Redis Hash Structure

```
Key: orders:1:1:open
Field: {orderId}
Value: JSON-serialized NormalizedOrder
```

### Cache TTL

- Open orders: No TTL (updated on sync)
- Stale check: Compare `last_sync` timestamp
- Force refresh: On user request or before placing new order

---

## Sync Strategy

### On-Demand Sync

```
User opens order management UI
    ↓
Check last_sync timestamp
    ↓
Stale (> 30 seconds)? → Fetch from exchange API
    ↓
Update Redis hash (replace all)
    ↓
Return orders to UI
```

### Pre-Trade Sync

```
User initiates new order
    ↓
Fetch latest open orders (fresh)
    ↓
Check for conflicts/duplicates
    ↓
Proceed with order if OK
```

### WebSocket Updates (Future)

Some exchanges support order update WebSocket channels:
- Coinbase: `user` channel with order updates
- Binance: User Data Stream
- Kraken: `openOrders` subscription

---

## Privacy Considerations

### What We Store (Redis)

- Open orders only (transient)
- Order IDs, symbols, prices, quantities
- No historical data retained

### What We DON'T Store

- Filled orders (query exchange if needed)
- Cancelled order history
- Trade execution details (except in fills for fee tracking)

### User Controls (Future)

- Option to disable order caching entirely
- Option to encrypt order data at rest
- Clear orders on logout

---

## Exchange-Specific Mappings

### Order Status Mapping

| Normalized | Coinbase | Kraken | Binance | Kucoin | MEXC |
|------------|----------|--------|---------|--------|------|
| PENDING | PENDING | pending | NEW | active | NEW |
| OPEN | OPEN | open | NEW | active | NEW |
| FILLED | FILLED | closed | FILLED | done | FILLED |
| CANCELLED | CANCELLED | canceled | CANCELED | cancelled | CANCELED |
| EXPIRED | EXPIRED | expired | EXPIRED | - | EXPIRED |
| FAILED | FAILED | - | REJECTED | - | REJECTED |

### Order Type Mapping

| Normalized | Coinbase | Kraken | Binance |
|------------|----------|--------|---------|
| MARKET | market_market_ioc | market | MARKET |
| LIMIT | limit_limit_gtc | limit | LIMIT |
| STOP_LIMIT | stop_limit_stop_limit_gtc | stop-loss-limit | STOP_LOSS_LIMIT |
| STOP_MARKET | trigger_bracket_gtc | stop-loss | STOP_LOSS |

---

## API Endpoints by Exchange

### Coinbase
```
GET /api/v3/brokerage/orders/historical/batch
  ?order_status=OPEN
  &order_status=PENDING
```

### Kraken
```
POST /0/private/OpenOrders
```

### Binance
```
GET /api/v3/openOrders
  ?symbol=BTCUSDT (optional)
```

### Kucoin
```
GET /api/v1/orders
  ?status=active
```

### MEXC
```
GET /api/v3/openOrders
  ?symbol=BTCUSDT (optional)
```

---

## Related Documents

- `coinbase-advanced.md` - Coinbase order endpoints
- `kraken.md` - Kraken order endpoints
- `binance.md` - Binance order endpoints
- `kucoin.md` - Kucoin order endpoints
- `mexc.md` - MEXC order endpoints
