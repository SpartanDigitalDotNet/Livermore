# Requirements: Livermore v8.0 Perseus Web Public API

**Defined:** 2026-02-18
**Core Value:** Data accuracy and timely alerts
**Critical Constraint:** MACD-V is proprietary IP — NEVER expose indicator names, formulas, or calculation details through public endpoints.

## v8.0 Requirements

Requirements for v8.0 release. Each maps to roadmap phases.

### Public REST API

- [ ] **API-01**: Public REST endpoint `GET /public/v1/candles/:exchange/:symbol/:timeframe` returns OHLCV candle data from Redis cache with `timestamp`, `open`, `high`, `low`, `close`, `volume` fields
- [ ] **API-02**: Public REST endpoint `GET /public/v1/signals/:exchange/:symbol` returns trade signals with generic labels (`momentum_signal`, `trend_signal`) — NO internal indicator names (MACD-V, histogram, EMA) exposed
- [ ] **API-03**: Public REST endpoint `GET /public/v1/alerts` returns alert history with `timestamp`, `symbol`, `exchange`, `timeframe`, `signal_type`, `direction`, `strength`, `price` — internal indicator details stripped
- [ ] **API-04**: Public REST endpoint `GET /public/v1/exchanges` returns exchange metadata with `id`, `name`, `status`, `symbol_count`
- [ ] **API-05**: Public REST endpoint `GET /public/v1/symbols` returns symbol list with `symbol`, `base`, `quote`, `exchange`, `liquidity_grade`
- [ ] **API-06**: All public endpoints support cursor-based pagination via `cursor` and `limit` params, returning `next_cursor` and `has_more` in response metadata
- [ ] **API-07**: All public endpoints support time range filtering via `start_time` and `end_time` query params in ISO8601 format (where applicable)
- [ ] **API-08**: All responses use consistent JSON envelope: `{ success: boolean, data: T, meta: { count, next_cursor, has_more } }` with ISO8601 timestamps and string decimals for prices/volumes

### OpenAPI Specification

- [ ] **OAS-01**: OpenAPI 3.1 spec auto-generated from Zod schemas via `@fastify/swagger` + `fastify-type-provider-zod` — code is single source of truth
- [ ] **OAS-02**: Every endpoint has AI-optimized descriptions with concrete use-case examples (e.g., "Retrieve 1h candles for BTC-USD on Coinbase from the last 7 days")
- [ ] **OAS-03**: Every endpoint includes concrete JSON examples for both successful responses and error cases
- [ ] **OAS-04**: All error codes documented: 400 (invalid params), 401 (unauthorized), 403 (forbidden), 404 (not found), 429 (rate limited), 500 (server error)
- [ ] **OAS-05**: Spec serves at `/public/v1/openapi.json` and is compatible with `openapi-typescript` + `openapi-fetch` for typed client generation
- [ ] **OAS-06**: Common schemas (Candle, Signal, Alert, Exchange, Symbol, Error) extracted into `components/schemas` for reuse

### WebSocket Bridge

- [ ] **WS-01**: WebSocket endpoint at `/public/v1/stream` accepts connections with API key auth via query parameter
- [ ] **WS-02**: Client sends `{ action: "subscribe", channels: ["candles:BTC-USD:1h", "signals:ETH-USD:15m"] }` to manage subscriptions
- [ ] **WS-03**: Candle close events from Redis pub/sub relayed to subscribed WebSocket clients with generic envelope (no internal field names)
- [ ] **WS-04**: Alert/signal events relayed to subscribed clients as generic trade signals (direction, strength, price only — NO indicator details)
- [ ] **WS-05**: Protocol-level ping/pong heartbeat every 30s detects dead connections and closes stale sockets
- [ ] **WS-06**: Per-API-key connection limit (max 5 concurrent WebSocket connections) enforced at connection time
- [ ] **WS-07**: Backpressure handling: track per-client `bufferedAmount`, pause relay if buffer exceeds threshold, disconnect slow clients

### AsyncAPI Specification

- [ ] **AAS-01**: AsyncAPI 3.1 spec documents all WebSocket message schemas, channels, and operations
- [ ] **AAS-02**: Message schemas defined for `candle_close`, `trade_signal`, `error`, `ping`, `pong` message types with concrete JSON examples
- [ ] **AAS-03**: Channel documentation covers subscription patterns (`candles:{symbol}:{timeframe}`, `signals:{symbol}:{timeframe}`)
- [ ] **AAS-04**: WebSocket bindings document connection URL, authentication params, and protocol details

### Authentication & Security

- [ ] **AUTH-01**: API key authentication via `X-API-Key` header with UUID keys stored in `api_keys` database table
- [ ] **AUTH-02**: Single rate limit for all API keys (300 req/min) enforced via `@fastify/rate-limit` backed by Redis — admin tRPC routes exempt
- [ ] **AUTH-03**: Route-scoped CORS: permissive for `/public/v1/*` (public API), restrictive for `/trpc/*` (admin dashboard origin only)
- [ ] **AUTH-04**: Error sanitization layer strips stack traces and internal field names from all public API responses — generic error messages only
- [ ] **AUTH-05**: Admin UI page for API key generation, display, and regeneration (tRPC mutation behind Clerk auth)

### IP Protection

- [ ] **IP-01**: Data transformation layer (DTO) maps internal indicator data to generic public labels at the API boundary — explicit field whitelisting, not field omission
- [ ] **IP-02**: Internal field names (`macdV`, `signal`, `histogram`, `fastEMA`, `slowEMA`, `atr`, `informativeATR`) NEVER appear in any public response, error message, or OpenAPI spec
- [ ] **IP-03**: Public API code lives in separate package (`packages/public-api`) isolated from internal indicator packages

### Runtime Modes

- [ ] **MODE-01**: `LIVERMORE_MODE` env var controls runtime mode: `exchange` (default, current behavior) or `pw-host` (headless, public API only)
- [ ] **MODE-02**: In `pw-host` mode, skip exchange adapter initialization, warmup, and indicator calculation — only serve public API from Redis cache
- [ ] **MODE-03**: In `pw-host` mode, Redis-only data access — read candles, indicators, tickers from cache without owning the write path
- [ ] **MODE-04**: `/health` endpoint reports runtime mode and mode-appropriate status (exchange: WebSocket connected; pw-host: Redis connected)

## Future Requirements (v8.1+)

Deferred until v8.0 is live and user feedback validates need.

- [ ] Interactive API explorer (Swagger UI at `/public/docs`)
- [ ] Rate limit headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) in responses
- [ ] Verbose error messages with `hint` field for common mistakes
- [ ] Clerk JWT token support for authenticated user context
- [ ] Usage dashboard showing per-API-key metrics
- [ ] Sandbox environment with historical-only data
- [ ] Tiered rate limiting (Free/Basic/Pro) with billing integration

## Out of Scope

| Feature | Reason |
|---------|--------|
| GraphQL API | Adds complexity, breaks OpenAPI spec generation, financial APIs use REST |
| OAuth 2.0 for public endpoints | Overkill for read-only data — API keys are simpler |
| Client SDK npm package | Wait for spec stability (2+ months without breaking changes) |
| Server-Sent Events fallback | No evidence of WebSocket blocking in target audience |
| Webhook delivery for alerts | Requires retry/failure infrastructure — defer to v9+ |
| Historical data dumps (>90 days) | Livermore's value is real-time signals, not data warehousing |
| Custom indicator endpoints | Security risk (arbitrary code execution), breaks spec-as-product model |
| Admin API in public spec | Leaks internal capabilities, confuses AI agents |
| NATS migration | Deferred to future milestone — Redis pub/sub sufficient for v8.0 |

## Traceability

_Filled by roadmap — maps REQ-IDs to phases._

| Requirement | Phase |
|-------------|-------|
| API-01..API-08 | TBD |
| OAS-01..OAS-06 | TBD |
| WS-01..WS-07 | TBD |
| AAS-01..AAS-04 | TBD |
| AUTH-01..AUTH-05 | TBD |
| IP-01..IP-03 | TBD |
| MODE-01..MODE-04 | TBD |
