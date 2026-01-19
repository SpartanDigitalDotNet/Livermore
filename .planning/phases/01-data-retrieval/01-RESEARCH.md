# Phase 1: Data Retrieval - Research

**Researched:** 2026-01-18
**Domain:** Coinbase Advanced Trade API - Orders and Fills
**Confidence:** HIGH

## Summary

This phase requires extending the existing `CoinbaseRestClient` to fetch filled order history and verify fee tier data. The codebase already has solid foundations: a working REST client with JWT authentication, an established pagination pattern using cursor-based iteration, and a `getTransactionSummary()` method for fee tiers.

The Coinbase Advanced Trade API provides two endpoints relevant to this work:
1. **List Orders** (`/orders/historical/batch`) - Returns order records including status, fees, and fill information
2. **List Fills** (`/orders/historical/fills`) - Returns individual fill/trade records with per-fill commission data

For fee analysis, the **List Fills** endpoint is the correct choice because it provides granular per-trade commission data with `commission` and `commission_detail_total` fields, whereas the orders endpoint provides aggregated `total_fees`.

**Primary recommendation:** Implement `getFilledOrders()` using the existing pagination pattern from `getOpenOrders()`, filtering by `order_status: ['FILLED']`. For detailed fee analysis, also implement `getFills()` to get per-fill commission data with maker/taker breakdown.

## Standard Stack

This phase uses only existing dependencies in the codebase.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | Built-in | HTTP requests | Already used in CoinbaseRestClient |
| `@livermore/coinbase-client` | Internal | Coinbase API wrapper | Existing authenticated client |
| `@livermore/utils` | Internal | Logging | Consistent structured logging |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 3.24.1 | Response validation | Validating API responses |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| List Orders endpoint | List Fills endpoint | Fills has per-trade commission detail; Orders has aggregated total_fees. Use both if granular breakdown needed. |
| Fetching all statuses | Filtering by FILLED only | Reduces API calls and response size. Only FILLED orders have fee data. |

**Installation:**
No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
No new files needed - extend existing client:
```
packages/coinbase-client/src/rest/
  client.ts         # Add getFilledOrders() and getFills() methods
```

### Pattern 1: Cursor-Based Pagination (Existing Pattern)
**What:** Iterate through paginated results using cursor token
**When to use:** Any endpoint returning `cursor` and `has_next`
**Example:**
```typescript
// Source: Existing getOpenOrders() in client.ts, lines 497-534
async getFilledOrders(options?: FilledOrdersOptions): Promise<CoinbaseOrder[]> {
  const allOrders: CoinbaseOrder[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams();
    params.append('order_status', 'FILLED');
    params.append('limit', '100');

    if (options?.productId) {
      params.append('product_id', options.productId);
    }
    if (options?.startDate) {
      params.append('start_date', options.startDate);
    }
    if (options?.endDate) {
      params.append('end_date', options.endDate);
    }
    if (cursor) {
      params.append('cursor', cursor);
    }

    const path = `/api/v3/brokerage/orders/historical/batch?${params.toString()}`;
    const response = await this.request('GET', path);
    const orders = response.orders || [];
    allOrders.push(...orders);

    cursor = response.has_next && response.cursor ? response.cursor : undefined;
  } while (cursor);

  return allOrders;
}
```

### Pattern 2: Options Object for Query Parameters
**What:** Use typed options object for optional parameters
**When to use:** Endpoints with multiple optional filters
**Example:**
```typescript
// Source: Codebase convention from CONVENTIONS.md
interface FilledOrdersOptions {
  productId?: string;      // Filter by trading pair (e.g., "BTC-USD")
  startDate?: string;      // RFC3339 timestamp
  endDate?: string;        // RFC3339 timestamp
  limit?: number;          // Results per page (default 100)
}
```

### Pattern 3: Null Coalescing for Response Arrays
**What:** Safely handle potentially missing array fields
**When to use:** API responses where arrays may be missing
**Example:**
```typescript
// Source: Existing pattern in client.ts
const orders = response.orders || [];
const fills = response.fills || [];
```

### Anti-Patterns to Avoid
- **Fetching all orders then filtering:** Always use `order_status` parameter to filter server-side
- **Ignoring pagination:** Large accounts may have thousands of orders; always paginate
- **Hardcoding date ranges:** Accept start/end dates as parameters for flexibility
- **Requesting multiple status values:** Coinbase API does not support multiple order_status values in one request

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| API Authentication | Custom JWT signing | `CoinbaseAuth.generateRestToken()` | Already handles JWT with correct claims |
| Pagination | Manual offset tracking | Cursor-based loop pattern | API uses cursors, not offsets |
| Fee tier lookup | Calculate from trades | `getTransactionSummary()` | Already implemented, returns current tier |
| Rate limiting | Custom throttling | None needed for single script | 30 req/s is sufficient for one-time data fetch |

**Key insight:** The existing client handles all the hard parts (auth, request signing, base URL). This phase is purely about adding new methods following established patterns.

## Common Pitfalls

### Pitfall 1: Assuming Order.total_fees Contains Per-Fill Breakdown
**What goes wrong:** Using `CoinbaseOrder.total_fees` expecting maker/taker split
**Why it happens:** Orders aggregate fees; fills have the granular data
**How to avoid:** Use List Fills endpoint when you need per-trade commission breakdown
**Warning signs:** Missing `liquidity_indicator` field (only on fills)

### Pitfall 2: Not Filtering by Order Status
**What goes wrong:** Fetching all orders including PENDING, OPEN, CANCELLED
**Why it happens:** Default behavior returns all statuses
**How to avoid:** Always pass `order_status: 'FILLED'` for fee analysis
**Warning signs:** Receiving orders with empty `total_fees` (unfilled orders)

### Pitfall 3: Date Format Mismatch
**What goes wrong:** Passing JavaScript Date objects or Unix timestamps
**Why it happens:** API expects RFC3339 format
**How to avoid:** Convert dates: `new Date().toISOString()`
**Warning signs:** 400 errors mentioning invalid date format

### Pitfall 4: Missing Pagination Leading to Incomplete Data
**What goes wrong:** Getting only first 100 orders
**Why it happens:** Not checking `has_next` flag
**How to avoid:** Always implement full pagination loop
**Warning signs:** Order count seems suspiciously round (exactly 100)

### Pitfall 5: Rate Limit During Heavy Pagination
**What goes wrong:** 429 Too Many Requests errors
**Why it happens:** Paginating very fast through thousands of orders
**How to avoid:** For large histories, add small delay between pages (e.g., 50ms)
**Warning signs:** Errors after 30+ rapid requests

## Code Examples

Verified patterns from official sources and existing codebase:

### List Filled Orders
```typescript
// Source: Coinbase API Reference + existing client.ts pattern
async getFilledOrders(options: FilledOrdersOptions = {}): Promise<CoinbaseOrder[]> {
  const allOrders: CoinbaseOrder[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams();
    params.append('order_status', 'FILLED');
    params.append('limit', (options.limit || 100).toString());

    if (options.productId) {
      params.append('product_id', options.productId);
    }
    if (options.startDate) {
      params.append('start_date', options.startDate);
    }
    if (options.endDate) {
      params.append('end_date', options.endDate);
    }
    if (cursor) {
      params.append('cursor', cursor);
    }

    const path = `/api/v3/brokerage/orders/historical/batch?${params.toString()}`;

    try {
      const response = await this.request('GET', path);
      const orders = response.orders || [];
      allOrders.push(...orders);
      cursor = response.has_next && response.cursor ? response.cursor : undefined;
    } catch (error) {
      logger.error({ error, options }, 'Failed to fetch filled orders');
      throw error;
    }
  } while (cursor);

  logger.debug({ count: allOrders.length }, 'Fetched filled orders');
  return allOrders;
}
```

### List Fills (For Detailed Commission Data)
```typescript
// Source: Coinbase API Reference - List Fills endpoint
interface CoinbaseFill {
  entry_id: string;
  trade_id: string;
  order_id: string;
  trade_time: string;
  trade_type: string;
  price: string;
  size: string;
  commission: string;
  product_id: string;
  sequence_timestamp: string;
  liquidity_indicator: 'MAKER' | 'TAKER' | 'UNKNOWN_LIQUIDITY_INDICATOR';
  size_in_quote: boolean;
  user_id: string;
  side: 'BUY' | 'SELL';
}

async getFills(options: FillsOptions = {}): Promise<CoinbaseFill[]> {
  const allFills: CoinbaseFill[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams();
    params.append('limit', (options.limit || 100).toString());

    if (options.productId) {
      params.append('product_ids', options.productId);
    }
    if (options.startDate) {
      params.append('start_sequence_timestamp', options.startDate);
    }
    if (options.endDate) {
      params.append('end_sequence_timestamp', options.endDate);
    }
    if (cursor) {
      params.append('cursor', cursor);
    }

    const path = `/api/v3/brokerage/orders/historical/fills?${params.toString()}`;
    const response = await this.request('GET', path);
    const fills = response.fills || [];
    allFills.push(...fills);

    // Fills endpoint uses cursor directly (no has_next field)
    cursor = response.cursor || undefined;
  } while (cursor);

  return allFills;
}
```

### Get Transaction Summary (Already Implemented)
```typescript
// Source: Existing client.ts lines 476-486
async getTransactionSummary(): Promise<CoinbaseTransactionSummary> {
  const path = '/api/v3/brokerage/transaction_summary';
  const response = await this.request('GET', path);
  return response;
}

// Response structure (already typed in client.ts)
interface CoinbaseTransactionSummary {
  total_volume: number;
  total_fees: number;
  fee_tier: {
    pricing_tier: string;
    usd_from: string;
    usd_to: string;
    taker_fee_rate: string;
    maker_fee_rate: string;
  };
  advanced_trade_only_volume: number;
  advanced_trade_only_fees: number;
}
```

## API Reference

### List Orders Endpoint
| Property | Value |
|----------|-------|
| Method | GET |
| URL | `https://api.coinbase.com/api/v3/brokerage/orders/historical/batch` |
| Auth | Bearer JWT |
| Rate Limit | 30 req/s (private endpoints) |

**Key Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `order_status` | enum | PENDING, OPEN, FILLED, CANCELLED, EXPIRED, FAILED |
| `product_ids` | string[] | Filter by trading pair(s) |
| `start_date` | RFC3339 | Orders created after this date |
| `end_date` | RFC3339 | Orders created before this date |
| `limit` | int | Results per page |
| `cursor` | string | Pagination cursor |

**Response:**
```json
{
  "orders": [...],
  "has_next": true,
  "cursor": "eyJsYXN0X..."
}
```

### List Fills Endpoint
| Property | Value |
|----------|-------|
| Method | GET |
| URL | `https://api.coinbase.com/api/v3/brokerage/orders/historical/fills` |
| Auth | Bearer JWT |
| Rate Limit | 30 req/s (private endpoints) |

**Key Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `product_ids` | string[] | Filter by trading pair(s) |
| `start_sequence_timestamp` | RFC3339 | Fills after this date |
| `end_sequence_timestamp` | RFC3339 | Fills before this date |
| `limit` | int | Results per page (default 100) |
| `cursor` | string | Pagination cursor |

**Response:**
```json
{
  "fills": [
    {
      "commission": "1.25",
      "liquidity_indicator": "TAKER",
      ...
    }
  ],
  "cursor": "789100"
}
```

### Transaction Summary Endpoint
| Property | Value |
|----------|-------|
| Method | GET |
| URL | `https://api.coinbase.com/api/v3/brokerage/transaction_summary` |
| Auth | Bearer JWT |
| Rate Limit | 30 req/s (private endpoints) |

**Response includes:**
- `fee_tier.pricing_tier` - Current tier name
- `fee_tier.taker_fee_rate` - Current taker rate (e.g., "0.006" = 0.6%)
- `fee_tier.maker_fee_rate` - Current maker rate (e.g., "0.004" = 0.4%)
- `total_volume` - 30-day trading volume
- `total_fees` - 30-day fees paid

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Coinbase Pro API | Advanced Trade API | 2023 | New v3 endpoints, JWT auth |
| API key + secret HMAC | CDP API key + JWT | 2023 | Existing client already uses JWT |

**Deprecated/outdated:**
- Coinbase Pro API endpoints - migrated to Advanced Trade API
- HMAC signature authentication - replaced by JWT Bearer tokens

## Open Questions

Things that couldn't be fully resolved:

1. **Fills pagination termination**
   - What we know: Response includes `cursor` field
   - What's unclear: Whether empty cursor or absent cursor indicates end
   - Recommendation: Test empirically; likely empty string or missing field

2. **Maximum order history depth**
   - What we know: API supports `start_date`/`end_date` filters
   - What's unclear: How far back order history is retained
   - Recommendation: Start without date filter to get all available history

3. **Fills vs Orders for fee analysis**
   - What we know: Both have fee data; fills have `liquidity_indicator`
   - What's unclear: Whether fills `commission` always matches order `total_fees`
   - Recommendation: Implement both methods; verify totals match

## Sources

### Primary (HIGH confidence)
- [Coinbase List Orders Endpoint](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/list-orders) - Full parameter and response documentation
- [Coinbase List Fills Endpoint](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/list-fills) - Fill response schema with commission fields
- Existing `CoinbaseRestClient` implementation (`packages/coinbase-client/src/rest/client.ts`) - Pagination pattern, auth, error handling

### Secondary (MEDIUM confidence)
- [Coinbase Advanced Trade API Overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/overview) - General API structure
- [Coinbase Advanced Trade REST Endpoints](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api) - Endpoint listing

### Tertiary (LOW confidence)
- WebSearch results for rate limits (30 req/s for private endpoints) - Multiple sources agree

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses only existing dependencies
- Architecture: HIGH - Follows established patterns in codebase
- API endpoints: HIGH - Verified against official documentation
- Pitfalls: MEDIUM - Based on API documentation and common patterns

**Research date:** 2026-01-18
**Valid until:** 2026-02-18 (API is stable; 30 days reasonable)
