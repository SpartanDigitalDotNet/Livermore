---
phase: 39-public-api-foundation-ip-protection
plan: 02
subsystem: public-api
tags:
  - rest-endpoints
  - fastify
  - openapi
  - zod-validation
dependency_graph:
  requires:
    - "39-01 (schemas, transformers, pagination helpers)"
  provides:
    - "GET /public/v1/candles/:exchange/:symbol/:timeframe endpoint"
    - "GET /public/v1/exchanges endpoint"
    - "GET /public/v1/symbols endpoint"
    - "Fastify plugin with OpenAPI 3.1 spec generation"
    - "Swagger UI at /public/v1/docs"
  affects:
    - "Plan 39-03 (server integration will register this plugin)"
    - "Plan 40-01 (trade signal endpoints will follow same pattern)"
tech_stack:
  added:
    - "drizzle-orm: ^0.36.4"
  patterns:
    - "Direct Redis commands (not CandleCacheStrategy) for userId-free reads"
    - "In-memory exchange name -> ID caching"
    - "Liquidity score -> grade mapping (0.8+ = high, 0.5+ = medium, else low)"
    - "Cursor-based pagination with Base64-encoded IDs/timestamps"
    - "Sanitized error handler with Zod validation error mapping"
key_files:
  created:
    - "packages/public-api/src/routes/candles.route.ts"
    - "packages/public-api/src/routes/exchanges.route.ts"
    - "packages/public-api/src/routes/symbols.route.ts"
    - "packages/public-api/src/routes/index.ts"
    - "packages/public-api/src/plugin.ts"
  modified:
    - "packages/public-api/src/index.ts"
    - "packages/public-api/package.json"
    - "pnpm-lock.yaml"
decisions:
  - "Use direct Redis commands (getRedisClient + exchangeCandleKey) instead of CandleCacheStrategy to avoid userId dependency - candles are exchange-scoped only"
  - "In-memory caching of exchange name -> ID mapping (exchanges table is small and rarely changes)"
  - "Liquidity score thresholds: >= 0.8 = high, >= 0.5 = medium, < 0.5 or null = low"
  - "Error handler uses (error as any) type assertions for Fastify error properties to maintain type safety"
  - "OpenAPI description includes AI-optimized language for LLM clients (use cases, data freshness, pagination patterns)"
metrics:
  duration_seconds: 364
  tasks_completed: 2
  files_created: 5
  commits: 2
  completed_date: "2026-02-19"
---

# Phase 39 Plan 02: REST Endpoints Summary

**One-liner:** Three production-ready REST endpoints (candles, exchanges, symbols) with Zod validation, cursor pagination, OpenAPI spec generation, and sanitized error handling.

## What Was Built

Created the core public REST API endpoints as Fastify route handlers:

1. **GET /public/v1/candles/:exchange/:symbol/:timeframe** - OHLCV candle data from Redis cache
   - Exchange name -> ID resolution with in-memory caching
   - Cursor-based pagination and time-range filtering
   - Direct Redis reads via `exchangeCandleKey()` (no userId dependency)
   - Supports `cursor`, `limit`, `start_time`, `end_time` query params

2. **GET /public/v1/exchanges** - Exchange metadata with status and symbol counts
   - Database query for active exchanges
   - Redis instance registry check for online/offline status
   - Per-exchange active symbol counts via SQL aggregation
   - No pagination (small fixed list)

3. **GET /public/v1/symbols** - Trading pair catalog with liquidity grading
   - Database query with optional exchange filter
   - Liquidity score -> grade mapping (high/medium/low)
   - Cursor-based pagination (ID-based for stable ordering)
   - Supports `exchange`, `cursor`, `limit` query params

4. **Fastify Plugin** - OpenAPI 3.1 integration with route registration
   - Zod type provider for schema validation and serialization
   - OpenAPI spec generation via `@fastify/swagger`
   - Swagger UI at `/docs` for interactive exploration
   - Sanitized error handler (strips stack traces, maps Zod errors)
   - OpenAPI spec endpoint at `/openapi.json`

## Key Technical Decisions

### Direct Redis Access (No CandleCacheStrategy)

The candle route uses raw Redis commands instead of `CandleCacheStrategy`:

```typescript
const key = exchangeCandleKey(exchangeId, symbol, timeframe);
const results = await redis.zrangebyscore(key, startMs, endMs, 'LIMIT', 0, limit);
```

**Reason:** `CandleCacheStrategy` requires `userId` parameter, but public API reads exchange-scoped candles only (no user context). Direct Redis access avoids this mismatch.

### In-Memory Exchange Name Caching

Exchange name -> ID resolution is cached in a Map:

```typescript
const exchangeCache = new Map<string, number>();
```

**Reason:** The `exchanges` table is small (< 10 rows) and rarely changes. Caching eliminates repeated DB queries for the same exchange name in URL paths.

### Liquidity Grade Mapping

Internal `liquidity_score` (0.000-1.000) maps to public `liquidity_grade` enum:

- `>= 0.8` → `'high'`
- `>= 0.5` → `'medium'`
- `< 0.5` or `null` → `'low'`

**Reason:** Exposes useful classification without revealing internal scoring algorithm or raw numeric values.

### Sanitized Error Handler

The plugin's error handler:
- Logs full error server-side (includes stack trace)
- Returns sanitized envelope to client (no stack, no internal field names)
- Maps Zod validation errors to generic "Invalid request parameters" with field names only

**Example:**

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request parameters",
    "details": [
      { "field": "limit", "message": "Number must be less than or equal to 1000" }
    ]
  }
}
```

## OpenAPI Spec Features

The generated OpenAPI 3.1 spec includes:

- **AI-optimized descriptions:** Explains use cases for trading bots, portfolio trackers, AI agents
- **Schema validation:** All params, querystring, and response schemas from Zod
- **Interactive docs:** Swagger UI at `/public/v1/docs` with "Try it out" functionality
- **Tag organization:** Routes grouped by Candles, Exchanges, Symbols
- **Pagination guidance:** Explains cursor-based pagination in endpoint descriptions

## Verification Results

All plan verification criteria passed:

- ✅ `npx tsc --noEmit` compiles cleanly
- ✅ Zero proprietary field names (grep verified)
- ✅ `publicApiPlugin` exported from `index.ts`
- ✅ All three routes have Zod schemas for params, querystring, response
- ✅ Error handler strips stack traces and internal details

## Deviations from Plan

**None** - plan executed exactly as written.

## Task Breakdown

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement candle, exchange, and symbol route handlers | 363c4d3 | candles.route.ts, exchanges.route.ts, symbols.route.ts, routes/index.ts, package.json, pnpm-lock.yaml |
| 2 | Create Fastify plugin with OpenAPI registration | 4cecc94 | plugin.ts, index.ts |

## Dependencies

**Added:**
- `drizzle-orm: ^0.36.4` - ORM for database queries in route handlers

**Imported from workspace:**
- `@livermore/cache` - Redis client and key builders
- `@livermore/database` - Database client and schema exports
- `@livermore/schemas` - Internal types (Candle, InstanceStatus)
- `@livermore/utils` - Logger (implicitly via other packages)

## Response Examples

**Candle endpoint:**

```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2026-02-19T03:00:00.000Z",
      "open": "42350.50",
      "high": "42450.75",
      "low": "42300.25",
      "close": "42400.00",
      "volume": "123.456"
    }
  ],
  "meta": {
    "count": 100,
    "next_cursor": "MTcyNjUyMTYwMDAwMA==",
    "has_more": true
  }
}
```

**Exchange endpoint:**

```json
{
  "success": true,
  "data": [
    {
      "id": "coinbase",
      "name": "Coinbase Advanced Trade",
      "status": "online",
      "symbol_count": 45
    }
  ],
  "meta": {
    "count": 6,
    "next_cursor": null,
    "has_more": false
  }
}
```

**Symbol endpoint:**

```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTC-USD",
      "base": "BTC",
      "quote": "USD",
      "exchange": "coinbase",
      "liquidity_grade": "high"
    }
  ],
  "meta": {
    "count": 100,
    "next_cursor": "MTI1",
    "has_more": true
  }
}
```

## Next Steps

This plan enables:

1. **Plan 39-03:** Server integration (register `publicApiPlugin` in `apps/api/src/server.ts` under `/public/v1` prefix)
2. **Plan 40-01:** Trade signal endpoints (will follow same route handler pattern)
3. **Plan 41-01:** API authentication (API key middleware will wrap these endpoints)

## Self-Check: PASSED

Verified all created files exist:

```bash
✅ packages/public-api/src/routes/candles.route.ts
✅ packages/public-api/src/routes/exchanges.route.ts
✅ packages/public-api/src/routes/symbols.route.ts
✅ packages/public-api/src/routes/index.ts
✅ packages/public-api/src/plugin.ts
```

Verified all modified files exist:

```bash
✅ packages/public-api/src/index.ts
✅ packages/public-api/package.json
```

Verified commits exist:

```bash
✅ 363c4d3: feat(39-02): implement candle, exchange, and symbol route handlers
✅ 4cecc94: feat(39-02): create Fastify plugin with OpenAPI registration
```

All files created successfully, all commits present, TypeScript compiles cleanly, zero proprietary field exposure.
