# Feature Landscape: v8.0 Perseus Web Public API

**Domain:** Public REST API, WebSocket bridge, OpenAPI/AsyncAPI specifications, AI-agent-ready documentation
**Project:** Livermore Trading Platform
**Researched:** 2026-02-18
**Overall Confidence:** HIGH

---

## Executive Summary

v8.0 transforms Livermore from an internal-only admin platform to a public-facing data API with AI-agent-ready documentation. The milestone exposes curated trading data (candles, trade signals, alert history, exchange metadata) through REST and WebSocket endpoints while protecting proprietary MACD-V algorithms through generic labeling.

The Perseus Web Public API milestone builds four interconnected subsystems:

1. **Public REST API** -- Versioned endpoints at `/public/v1/*` delivering OHLCV candles, trade signals (generic labels only), alert history, and exchange metadata with cursor-based pagination and ISO8601 time filtering.

2. **OpenAPI Specification** -- AI-agent-optimized OpenAPI 3.1 spec generated from Zod schemas via `zod-to-openapi` with rich descriptions, concrete examples, comprehensive error schemas, and typed client generation support.

3. **WebSocket Bridge** -- Real-time event streaming relaying Redis pub/sub (candle closes, trade signals) to external clients with AsyncAPI 3.1 documentation, subscription management, and protocol-level ping/pong.

4. **Runtime Modes** -- Headless operation mode (`LIVERMORE_MODE=pw-host`) separates public API hosting from exchange operation, enabling distributed architecture where one instance connects to exchanges while another serves public endpoints.

The critical IP protection constraint: MACD-V indicator names NEVER appear in public responses. All signal endpoints use generic labels ("trade_signal", "momentum_signal", "trend_signal") with strength/direction fields only. Internal implementation details remain hidden.

---

## Table Stakes (Must Have for v8.0)

Features users expect from a modern financial data API. Missing any means the product is incomplete.

### REST API: Core Endpoints

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **API-01** | OHLCV candles endpoint | `GET /public/v1/candles/:symbol/:timeframe` returns candle array with `timestamp`, `open`, `high`, `low`, `close`, `volume` in consistent JSON format | Medium | Table stakes for any financial data API. OHLCV is universal format across TradingView, Binance, Coinbase, Alpha Vantage |
| **API-02** | Trade signals endpoint | `GET /public/v1/signals/:symbol/:timeframe` returns generic signals array with `timestamp`, `type`, `direction`, `strength`, `price` (NO MACD-V label) | High | Core differentiator — exposes Livermore's proprietary analysis without leaking IP. Generic labels protect algorithm |
| **API-03** | Alert history endpoint | `GET /public/v1/alerts` returns triggered alerts with `timestamp`, `symbol`, `timeframe`, `signal_type`, `price`, `message` | Low | Users expect historical signal data for backtesting and analysis |
| **API-04** | Exchange metadata endpoint | `GET /public/v1/exchanges` returns exchange list with `id`, `name`, `status`, `supported_symbols`, `fee_structure` (publicly safe fields only) | Low | Discovery endpoint — what exchanges are available, what symbols are tradeable |
| **API-05** | Symbol metadata endpoint | `GET /public/v1/symbols` returns symbol list with `name`, `base`, `quote`, `exchange`, `tier`, `liquidity_score` | Low | Discovery endpoint — what assets are monitored, which are high-liquidity Tier 1 |

### REST API: Query Parameters & Filtering

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **FLT-01** | Time range filtering | Support `start_time` and `end_time` query params in ISO8601 format (e.g., `2026-02-15T00:00:00Z`) | Low | Industry standard for financial APIs. Alpaca, Twelve Data, FCS API all use ISO8601 |
| **FLT-02** | Cursor-based pagination | Use `cursor` param with `limit` for pagination, return `next_cursor` in response. Prevents data inconsistency during concurrent writes | Medium | Cursor-based prevents duplicate/missing entries when new candles arrive during pagination. Stripe, Slack, Zendesk all use cursor-based for financial data |
| **FLT-03** | Limit parameter | `limit` param controls page size (default: 100, max: 1000). Prevents excessive data transfer | Low | Rate limiting through page size. Standard across CoinAPI, Alpha Vantage |
| **FLT-04** | Exchange filtering | `exchange` query param filters results by exchange ID or name | Low | Multi-exchange platform requires per-exchange filtering |
| **FLT-05** | Signal type filtering | `type` param filters signals by generic type (`momentum`, `trend`, `volume`) | Low | Users want specific signal categories without knowing internal indicator names |

### REST API: Response Format Standards

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **FMT-01** | Consistent JSON envelope | All responses wrapped in `{success: boolean, data: T, meta: {}, error?: {}}` envelope | Low | Stripe, Twilio pattern. Makes client parsing predictable |
| **FMT-02** | ISO8601 timestamps | All timestamps in UTC ISO8601 format (`2026-02-18T12:34:56Z`) | Low | Industry standard. Prevents timezone ambiguity |
| **FMT-03** | Numeric precision | Price/volume fields as strings to prevent float precision loss (e.g., `"19234.56"` not `19234.56`) | Low | Financial data standard. Binance, Coinbase use string decimals |
| **FMT-04** | Metadata in responses | Include `meta` object with `count`, `total`, `next_cursor`, `has_more` for pagination context | Low | Lets clients build UI elements (page count, "load more" buttons) |
| **FMT-05** | Consistent error schema | Error responses include `{error: {code, message, details}}` with standard HTTP codes and machine-readable error codes | Medium | OpenAPI spec + client generation require consistent error types |

### OpenAPI Specification

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **OAS-01** | OpenAPI 3.1 spec generation | Generate spec from Zod schemas via `zod-to-openapi` with operation IDs, tags, descriptions | Medium | OpenAPI 3.1 is the current standard (released 2021). Supports JSON Schema 2020-12 |
| **OAS-02** | AI-agent-optimized descriptions | Rich, verbose operation summaries with concrete use-case examples in descriptions (e.g., "Retrieve OHLCV candles for BTC-USD on 1h timeframe from 2026-02-01 to 2026-02-15") | Low | AI agents rely on descriptions to understand intent. Generic "Get candles" is useless; specific examples teach the agent |
| **OAS-03** | Request/response examples | Every endpoint includes concrete JSON examples for requests and responses (successful + error cases) | Medium | Alpha Vantage, Twelve Data pattern. Examples prevent guessing |
| **OAS-04** | Comprehensive error documentation | Document all error codes with descriptions: `400` (invalid params), `401` (unauthorized), `403` (rate limited), `404` (not found), `500` (server error) | Low | Zalando API guidelines standard. Clients need to know what errors to handle |
| **OAS-05** | Typed client generation support | Spec structure compatible with `openapi-typescript` + `openapi-fetch` for type-safe client generation | Medium | Differentiator — spec as product. Clients generate types from spec, reducing integration time from days to hours |
| **OAS-06** | Schema component reuse | Extract common schemas (Candle, Signal, Alert, Error) into `components/schemas` for DRY spec | Low | Keeps spec maintainable and generates cleaner types |
| **OAS-07** | Server URL configuration | Document base URL with environment variable support (prod: `https://api.livermore.trade`, dev: `http://localhost:3000`) | Low | Multi-environment support |

### WebSocket Bridge

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **WS-01** | WebSocket endpoint | `wss://api.livermore.trade/public/v1/stream` accepts connections with auth token in query param or header | Medium | Industry standard. Alpaca, Binance, FMP all use `/stream` or `/ws` path |
| **WS-02** | Subscription management | Client sends `{action: "subscribe", channels: ["candles:BTC-USD:1h", "signals:ETH-USD:15m"]}` to control subscriptions | Medium | Binance, Alpaca pattern. Prevents bandwidth waste from unneeded streams |
| **WS-03** | Candle close events | When Redis pub/sub fires `candle:close:{exchange}:{symbol}:{timeframe}`, relay to subscribed WS clients with generic envelope | Medium | Real-time candle data is table stakes for live charts |
| **WS-04** | Trade signal events | When alert fires, relay to subscribed clients as generic signal event (NO MACD-V label) | High | Real-time signals enable live trading bot integration |
| **WS-05** | Ping/pong heartbeat | Protocol-level ping/pong every 30s to detect dead connections and close stale sockets | Low | WebSocket standard (RFC 6455). Prevents resource leaks |
| **WS-06** | Connection limits per API key | Rate limit: max 5 concurrent WS connections per API key | Low | Prevents abuse. CoinAPI, Twelve Data enforce connection limits |
| **WS-07** | Graceful error handling | Send error frames (`{type: "error", code, message}`) for invalid subscriptions before closing connection | Low | Better UX than silent disconnects |

### AsyncAPI Specification

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **AAS-01** | AsyncAPI 3.1 spec | Document WebSocket message schemas, channels, operations using AsyncAPI 3.1 format | Medium | AsyncAPI is OpenAPI equivalent for event-driven APIs. Current spec is 3.1.0 (released 2024) |
| **AAS-02** | Message schema definitions | Define schemas for `candle_close`, `trade_signal`, `error`, `ping`, `pong` messages | Low | Clients need to know message structure |
| **AAS-03** | Channel documentation | Document subscription patterns (`candles:{symbol}:{timeframe}`, `signals:{symbol}:{timeframe}`) | Low | Discovery — what channels exist, what format to subscribe |
| **AAS-04** | WebSocket binding | Use AsyncAPI WebSocket bindings to document connection URL, query params, headers | Low | Standardized way to document WebSocket-specific details |
| **AAS-05** | Example messages | Include concrete JSON examples for each message type (successful events + errors) | Low | Same rationale as OpenAPI examples — prevents guessing |

### Authentication & Security

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **AUTH-01** | API key authentication | Support `X-API-Key` header with UUID v4 keys stored in database `api_keys` table | Medium | Simpler than OAuth for read-only public data. Stripe, SendGrid pattern |
| **AUTH-02** | Clerk token support | Accept Clerk JWT tokens via `Authorization: Bearer` header for user-authenticated requests | Low | Already integrated in Admin UI. Reuse existing auth |
| **AUTH-03** | API key scopes | Keys have scopes (`candles:read`, `signals:read`, `alerts:read`) stored as JSONB array. Enforce per-endpoint | Medium | OAuth-style scopes without OAuth complexity. Allows tiered access |
| **AUTH-04** | Rate limiting by API key | Enforce request limits per key: Free tier (60 req/min), Basic ($19/mo, 300 req/min), Pro ($99/mo, 1000 req/min) | High | SaaS product model. Tiered pricing standard across CoinAPI, Alpha Vantage, Twelve Data |
| **AUTH-05** | CORS configuration | Enable CORS for `https://*.perseusw eb.com` and configurable allowed origins | Low | Public API requires CORS. Restrict origins to prevent abuse |
| **AUTH-06** | HTTPS enforcement | Redirect HTTP to HTTPS in production. Reject unencrypted requests | Low | Financial data security baseline. PCI compliance requirement |

### Runtime Modes

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **MODE-01** | Headless mode flag | `LIVERMORE_MODE=pw-host` env var enables headless mode (public API only, no exchange connection) | Low | Distributed architecture — one instance connects to exchanges, another serves public API |
| **MODE-02** | Exchange mode (default) | `LIVERMORE_MODE=exchange` connects to exchanges, calculates indicators, fires alerts (existing behavior) | Low | Preserves current functionality as default |
| **MODE-03** | Mode-aware startup | In `pw-host` mode, skip exchange adapter initialization, skip backfill, skip indicator services | Medium | Reduces startup time and resource usage for API-only instances |
| **MODE-04** | Redis-only data access | In `pw-host` mode, read from Redis cache (candles, indicators, tickers) without owning the data write path | Low | Cache is shared across modes. PW-host reads what exchange instances write |
| **MODE-05** | Health check per mode | `/health` endpoint reports mode and mode-appropriate status (exchange mode: WebSocket connected; pw-host mode: Redis connected) | Low | Monitoring needs to know what mode an instance is running |

### IP Protection Patterns

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **IP-01** | Generic signal labeling | Map internal indicator names (MACD-V) to generic labels (`momentum_signal`) at API boundary | High | Protects proprietary IP. Users see signals, not implementation |
| **IP-02** | Signal metadata filtering | Expose `direction` (long/short), `strength` (0-100), `timeframe`, `price` only — NO histogram values, EMA differences, or algorithm internals | Medium | Provides actionable data without leaking calculation method |
| **IP-03** | Indicator name scrubbing | Audit all public responses to ensure NO internal indicator names escape (use Zod transforms to enforce) | Medium | One leak destroys IP value. Requires deliberate validation layer |
| **IP-04** | Admin-only endpoints | Internal indicator details available ONLY via Admin UI (Clerk-authenticated tRPC endpoints) | Low | Two-tier access: public sees curated data, admins see everything |
| **IP-05** | Source code exclusion | Public API code in separate package (`@livermore/public-api`), indicator calculation in private `@livermore/indicators` | Low | Code-level separation prevents accidental exposure in open-source PW reference client |

---

## Differentiators (Competitive Advantage)

Features that set Perseus Web Public API apart from competitors. Not required for launch, but highly valuable.

### AI-First Documentation

| ID | Feature | Value Proposition | Complexity | Notes |
|----|---------|-------------------|------------|-------|
| **AI-01** | Spec-as-product positioning | Market API spec as "AI agent can generate a working client in 60 seconds" — spec quality is the product, PW is the reference implementation | Low | Stripe's API documentation is famously excellent. They position the docs as a product feature, not an afterthought |
| **AI-02** | Natural language query examples | Each endpoint description includes natural language query example: "Show me Bitcoin price candles on 1-hour chart for the last 7 days" | Low | Teaches AI agents how humans think about the data |
| **AI-03** | Common mistake warnings | Document common pitfalls in descriptions: "Note: Timestamps are in UTC. Convert to your local timezone for display." | Low | Prevents integration bugs. Alpha Vantage does this well |
| **AI-04** | SDK code generation guide | Dedicated OpenAPI spec section documenting how to generate TypeScript, Python, Rust clients from spec | Low | Makes "try it in 60 seconds" claim tangible |
| **AI-05** | Postman/Insomnia collection export | Auto-generate and publish Postman collection from OpenAPI spec for manual testing | Low | Non-AI users still need HTTP client support |

### Developer Experience

| ID | Feature | Value Proposition | Complexity | Notes |
|----|---------|-------------------|------------|-------|
| **DX-01** | Interactive API explorer | Embed Swagger UI or Scalar at `/public/docs` for in-browser API testing | Low | Table stakes for modern APIs. Stripe, Twilio, SendGrid all have this |
| **DX-02** | Sandbox environment | Free-tier API keys work against sandbox data (historical BTC/ETH only, no live signals) | Medium | Lets developers test integration without commitment. Plaid, Stripe pattern |
| **DX-03** | Verbose error messages | Error responses include `hint` field with actionable fix suggestion (e.g., "Invalid time format. Use ISO8601: 2026-02-18T12:00:00Z") | Low | Reduces support burden. Developers fix issues themselves |
| **DX-04** | Rate limit headers | Include `X-RateLimit-Remaining`, `X-RateLimit-Reset` in all responses | Low | Lets clients implement backoff before hitting limit. GitHub, Stripe pattern |
| **DX-05** | Client SDK npm package | Publish `@perseus-web/sdk` TypeScript SDK generated from OpenAPI spec | Medium | Reduces integration time. Users `npm install` instead of writing HTTP client |

### Real-Time Features

| ID | Feature | Value Proposition | Complexity | Notes |
|----|---------|-------------------|------------|-------|
| **RT-01** | Server-Sent Events (SSE) fallback | Offer `/public/v1/events` SSE endpoint for clients that can't use WebSocket | Medium | SSE works through corporate proxies that block WebSocket. Mercure, Ably offer both |
| **RT-02** | Replay buffer | New WebSocket subscribers receive last N events on connection (e.g., last 10 candle closes) | Medium | Prevents "dead air" on connect. Ably, Pusher do this |
| **RT-03** | Backpressure handling | If client can't keep up with event stream, send warning then disconnect slow clients | High | Prevents one slow client from degrading server performance |
| **RT-04** | Subscription limits | Free tier: max 5 channels, Basic tier: 20 channels, Pro tier: unlimited | Low | Encourages upgrades while preventing abuse |

### Analytics & Monitoring

| ID | Feature | Value Proposition | Complexity | Notes |
|----|---------|-------------------|------------|-------|
| **MON-01** | Usage dashboard for API keys | Admin UI shows per-key metrics: requests/day, endpoints called, errors, rate limit hits | Medium | Helps admins monitor usage and detect abuse |
| **MON-02** | Public status page | `/status` endpoint shows API health, uptime, incident history | Low | Transparency builds trust. GitHub, Stripe, Cloudflare all have public status |
| **MON-03** | Webhook delivery for alerts | Instead of polling `/alerts`, users can register webhook URL to receive POST on new alerts | High | Push > poll for real-time use cases. Stripe, GitHub pattern |
| **MON-04** | Audit logging | Log all public API requests (endpoint, API key, response time, status code) to database for security/compliance | Medium | Required for SaaS. Helps detect abuse and debug user issues |

---

## Anti-Features (Commonly Requested, Often Problematic)

Features that seem valuable but create problems or conflict with project goals.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **GraphQL API** | "GraphQL is more flexible than REST" | Adds complexity (schema, resolvers, N+1 queries), breaks OpenAPI spec generation, makes caching harder. Financial data APIs rarely use GraphQL (Coinbase, Binance, Alpaca all use REST). | Stick with REST + OpenAPI. Let clients request exactly what they need via query params. |
| **Real-time everything** | "Users want instant updates for all data" | WebSocket overhead for infrequently-changing data (exchange metadata, symbols list). Most clients poll these endpoints once on startup. | WebSocket for candles + signals only. REST for metadata. Let usage metrics drive expansion. |
| **OAuth 2.0 for public data** | "OAuth is more secure than API keys" | Overkill for read-only public data. OAuth adds auth server, token refresh, scope management. Increases integration time from 5 minutes to 1 hour. | API keys for public endpoints. OAuth only for write operations (if ever added). |
| **Unlimited free tier** | "Free tier attracts users" | Costs scale with usage. Free tier abuse (crypto arbitrage bots) can rack up infrastructure costs. Alpha Vantage learned this lesson and now heavily restricts free tier. | Free tier with strict limits (60 req/min, BTC/ETH only). Requires credit card after 7 days. |
| **Historical data dumps** | "Users want years of candle data" | Expensive to store and serve. Competes with paid historical data providers. Livermore's value is real-time signals, not data warehousing. | Limit historical queries to 90 days. Offer CSV export for paid tiers (1-year max). Partner with data providers for deeper history. |
| **Custom indicator endpoints** | "Let users define their own indicators" | Opens attack vector (arbitrary code execution). Requires sandboxing, resource limits, complex pricing. Breaks "spec as product" model (spec becomes infinite). | Expose building blocks (OHLCV, signals, alerts). Let users calculate custom indicators client-side. |
| **Admin API in public spec** | "One spec for everything" | Leaks internal capabilities. Confuses AI agents ("which endpoints are public?"). Mixing auth models (Clerk JWT vs API keys) in one spec is messy. | Separate specs: `openapi-public.json` and `openapi-admin.json`. Public spec ONLY for public endpoints. |
| **Verbose JSON-RPC** | "JSON-RPC is cleaner than REST" | Breaks HTTP semantics (everything is POST). Incompatible with OpenAPI tooling. No HTTP caching. Financial APIs standardized on REST (Binance, Kraken, Alpaca). | Stick with REST. Use POST for writes, GET for reads. Leverage HTTP caching and status codes. |

---

## Feature Dependencies

```
[OpenAPI Spec (OAS-01)]
    └──requires──> [REST API Core Endpoints (API-01 through API-05)]
                       └──requires──> [IP Protection Generic Labeling (IP-01, IP-02)]

[AsyncAPI Spec (AAS-01)]
    └──requires──> [WebSocket Bridge (WS-01 through WS-07)]
                       └──requires──> [IP Protection Generic Labeling (IP-01, IP-02)]

[Runtime Headless Mode (MODE-01)]
    └──requires──> [Mode-Aware Startup (MODE-03)]
    └──requires──> [Redis-Only Data Access (MODE-04)]

[Rate Limiting (AUTH-04)]
    └──requires──> [API Key Authentication (AUTH-01)]
    └──requires──> [API Key Scopes (AUTH-03)]

[Client SDK Generation (DX-05)]
    └──requires──> [OpenAPI Spec (OAS-01)]
    └──requires──> [Schema Component Reuse (OAS-06)]

[Typed Client Support (OAS-05)]
    └──enhances──> [AI-First Positioning (AI-01)]

[Cursor Pagination (FLT-02)]
    └──prevents-conflict-with──> [Offset Pagination (Anti-feature)]
```

### Dependency Notes

- **OpenAPI spec requires REST endpoints:** Can't document APIs that don't exist. REST endpoints (API-01 through API-05) must be functional before spec generation.

- **IP protection is foundational:** Both REST and WebSocket require generic signal labeling (IP-01, IP-02) before exposing any signal data. This is a hard security requirement.

- **Runtime modes require mode-aware logic:** Headless mode (MODE-01) is useless without startup logic that skips exchange initialization (MODE-03) and data access that works from Redis cache (MODE-04).

- **Rate limiting requires API keys:** Can't enforce per-key rate limits (AUTH-04) without API key infrastructure (AUTH-01) and scope enforcement (AUTH-03).

- **Client SDK requires quality spec:** Auto-generated SDK (DX-05) is only as good as the OpenAPI spec. Requires schema reuse (OAS-06) and consistent patterns.

- **Typed clients enhance AI positioning:** The "AI agent can generate a client in 60 seconds" claim (AI-01) is proven by typed client support (OAS-05). These features reinforce each other.

- **Cursor pagination conflicts with offset:** Cursor-based (FLT-02) and offset-based pagination are mutually exclusive design choices. Cursor is superior for financial data (prevents duplicates/gaps during concurrent writes).

---

## MVP Definition

### Launch With (v8.0)

Minimum viable public API — what's needed to validate the "spec as product" concept.

- [x] **REST API Core Endpoints (API-01 through API-05)** — Essential data access (candles, signals, alerts, metadata). Without these, there's no API.
- [x] **Time Range Filtering (FLT-01)** — Financial data without time filtering is useless. Users always query "last 7 days" or "February 2026."
- [x] **Cursor Pagination (FLT-02)** — Prevents data inconsistency bugs that would undermine trust. Must be right from v1.
- [x] **Consistent JSON Envelope (FMT-01, FMT-02, FMT-03)** — Changing response format post-launch breaks clients. Must standardize now.
- [x] **OpenAPI 3.1 Spec (OAS-01 through OAS-07)** — The product. Without excellent spec, the "AI-agent-ready" claim is hollow.
- [x] **WebSocket Bridge (WS-01 through WS-07)** — Real-time signals are the differentiator. REST-only would be commodity.
- [x] **AsyncAPI Spec (AAS-01 through AAS-05)** — WebSocket without documentation is unusable. AsyncAPI completes the spec-as-product vision.
- [x] **API Key Authentication (AUTH-01, AUTH-03)** — Can't launch a public API without auth. Simplest viable approach.
- [x] **Rate Limiting (AUTH-04)** — Protects infrastructure from abuse and enables SaaS pricing model.
- [x] **IP Protection (IP-01 through IP-05)** — Non-negotiable. One leak destroys IP value.
- [x] **Runtime Headless Mode (MODE-01 through MODE-05)** — Enables distributed architecture (exchange instance + public API instance). Required for scaling.

### Add After Validation (v8.1)

Features to add once v8.0 is live and users are integrating.

- [ ] **Interactive API Explorer (DX-01)** — Trigger: Users request "how do I test this?" Add Swagger UI for in-browser testing.
- [ ] **Rate Limit Headers (DX-04)** — Trigger: Users hit rate limits without warning. Add `X-RateLimit-*` headers to help clients implement backoff.
- [ ] **Verbose Error Messages (DX-03)** — Trigger: Support requests reveal common integration mistakes. Add `hint` field to errors.
- [ ] **Clerk Token Support (AUTH-02)** — Trigger: Perseus Web UI needs authenticated user context (user-specific watchlists, settings). Add Bearer token support.
- [ ] **Usage Dashboard (MON-01)** — Trigger: Need to monitor API key usage for billing and abuse detection. Build admin dashboard.
- [ ] **Sandbox Environment (DX-02)** — Trigger: Users request "can I test without live data?" Create sandbox mode with historical-only data.

### Future Consideration (v9+)

Features to defer until product-market fit is established and revenue justifies investment.

- [ ] **Client SDK Package (DX-05)** — Defer until: Spec is stable (no breaking changes for 2+ months) and user demand is clear (5+ requests).
- [ ] **SSE Fallback (RT-01)** — Defer until: Users report WebSocket connection issues (corporate proxies). Adds complexity without proven need.
- [ ] **Replay Buffer (RT-02)** — Defer until: Users complain about "dead air" on WebSocket connect. Nice-to-have, not critical.
- [ ] **Webhook Delivery (MON-03)** — Defer until: Users request push notifications for alerts. Requires webhook infrastructure (retry, failure handling).
- [ ] **Audit Logging (MON-04)** — Defer until: SaaS compliance requirements emerge (SOC 2, GDPR). Increases storage costs.
- [ ] **Public Status Page (MON-02)** — Defer until: Users need uptime transparency for SLA commitments. Build when revenue justifies operational overhead.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| REST API Core Endpoints (API-01 to API-05) | HIGH | MEDIUM | **P1** |
| Cursor Pagination (FLT-02) | HIGH | MEDIUM | **P1** |
| OpenAPI Spec (OAS-01 to OAS-07) | HIGH | MEDIUM | **P1** |
| WebSocket Bridge (WS-01 to WS-07) | HIGH | MEDIUM | **P1** |
| AsyncAPI Spec (AAS-01 to AAS-05) | HIGH | MEDIUM | **P1** |
| API Key Auth (AUTH-01, AUTH-03) | HIGH | MEDIUM | **P1** |
| Rate Limiting (AUTH-04) | HIGH | HIGH | **P1** |
| IP Protection (IP-01 to IP-05) | HIGH | HIGH | **P1** |
| Runtime Modes (MODE-01 to MODE-05) | MEDIUM | MEDIUM | **P1** |
| Time Range Filtering (FLT-01) | HIGH | LOW | **P1** |
| Consistent JSON Format (FMT-01 to FMT-05) | HIGH | LOW | **P1** |
| Interactive API Explorer (DX-01) | MEDIUM | LOW | **P2** |
| Rate Limit Headers (DX-04) | MEDIUM | LOW | **P2** |
| Verbose Errors (DX-03) | MEDIUM | LOW | **P2** |
| Clerk Token Support (AUTH-02) | MEDIUM | LOW | **P2** |
| Usage Dashboard (MON-01) | MEDIUM | MEDIUM | **P2** |
| Sandbox Environment (DX-02) | MEDIUM | MEDIUM | **P2** |
| AI-First Documentation (AI-01 to AI-05) | MEDIUM | LOW | **P2** |
| Client SDK Package (DX-05) | MEDIUM | MEDIUM | **P3** |
| SSE Fallback (RT-01) | LOW | MEDIUM | **P3** |
| Replay Buffer (RT-02) | LOW | MEDIUM | **P3** |
| Webhook Delivery (MON-03) | MEDIUM | HIGH | **P3** |
| Audit Logging (MON-04) | LOW | MEDIUM | **P3** |
| Public Status Page (MON-02) | LOW | LOW | **P3** |

**Priority key:**
- **P1:** Must have for v8.0 launch — blocking features
- **P2:** Should have for v8.1 — add when user feedback validates need
- **P3:** Nice to have for v9+ — defer until product-market fit

---

## Competitor Feature Analysis

| Feature | Binance API | Coinbase API | Alpaca Markets | Our Approach |
|---------|-------------|--------------|----------------|--------------|
| **OHLCV Candles** | REST endpoint with kline format. 1000 candle limit per request. | REST endpoint with nested array format. Pagination by cursor or page number. | REST bars endpoint with ISO8601 timestamps. Cursor pagination. | Cursor pagination, ISO8601, JSON object format (not nested arrays). Follows Alpaca pattern. |
| **Real-time WebSocket** | Native WebSocket with kline streams. Subscribe per symbol. | WebSocket with subscription management. Max 8 connections per IP. | WebSocket with SIP feed for stocks. Crypto via Coinbase. | Subscription management like Coinbase. Redis pub/sub bridge. Per-key connection limits (not IP). |
| **API Documentation** | OpenAPI spec available. Examples provided. Not AI-optimized. | Extensive docs with code samples. No OpenAPI spec. | OpenAPI spec + interactive docs. Good examples. | OpenAPI + AsyncAPI + AI-optimized descriptions. Spec as product. |
| **Authentication** | API key + secret (HMAC signature). Supports IP whitelisting. | API key + secret (HMAC signature). OAuth for user data. | API key (alphanumeric). OAuth for brokerage accounts. | Simple API key for read-only data. Clerk JWT for user context. Simpler than competitors. |
| **Rate Limiting** | Weight-based system (different endpoints consume different weights). 1200 weight/min for general API. | 10 req/sec public, 15 req/sec private. Burst allowance. | 200 req/min for free, unlimited for paid. Per-endpoint limits. | Credit-based system per tier. 60/300/1000 req/min. Standard tiered model. |
| **Pagination** | Limit + offset for some endpoints. No cursor for klines. | Cursor-based for most endpoints. `before`/`after` params. | Cursor-based (`page_token`). Consistent across all endpoints. | Cursor-based like Coinbase/Alpaca. Prevents duplicate/missing data. |
| **Trade Signals** | No proprietary signals. Raw market data only. | No proprietary signals. Raw market data only. | No proprietary signals (market data provider). | **DIFFERENTIATOR:** Generic trade signals without revealing algorithm. |
| **AsyncAPI Spec** | Not provided. WebSocket documented in prose. | Not provided. WebSocket documented in prose. | Not provided. WebSocket documented in prose. | **DIFFERENTIATOR:** AsyncAPI 3.1 spec for WebSocket. Machine-readable event docs. |
| **Client SDKs** | Official Python, Node, Java SDKs. Community-maintained others. | Official Node, Python, Go SDKs. Well-maintained. | Official Python, Node, C#, Go SDKs. Auto-generated from OpenAPI. | Start without SDK. Let users generate from spec. Offer official SDK if demand emerges (v9+). |
| **Error Handling** | Numeric error codes + message. Documented per endpoint. | Structured error objects with `id`, `message`. | Standard HTTP codes + JSON error body. | Follow Alpaca pattern. HTTP codes + structured JSON with `hint` field for AI agents. |

**Key Takeaways:**
- **Cursor pagination is industry standard** for modern financial APIs (Coinbase, Alpaca). Binance's limit/offset is legacy.
- **OpenAPI spec is expected** but not universal. Alpaca does it best. We can differentiate with AsyncAPI + AI-first docs.
- **Trade signals are unique to Livermore.** Binance/Coinbase/Alpaca provide raw data only. Our signals are the product.
- **Rate limiting models vary widely.** Weight-based (Binance) is complex. Simple req/min tiers (Alpaca) are easier to understand and price.
- **Authentication simplicity matters.** HMAC signature (Binance, Coinbase) is harder to integrate than simple API keys (Alpaca). Start simple.

---

## Sources

**API Best Practices & Standards:**
- [Best Real-Time Stock Market Data APIs in 2026 | Financial Modeling Prep](https://site.financialmodelingprep.com/education/other/best-realtime-stock-market-data-apis-in-)
- [Crypto API Trading Guide: Tips & Best Practices (2026) | HyroTrader](https://www.hyrotrader.com/blog/crypto-api-trading/)
- [API Governance Best Practices for 2026 | Treblle](https://treblle.com/blog/api-governance-best-practices)
- [Top API Trends to Watch in 2026 | Capital Numbers](https://www.capitalnumbers.com/blog/top-api-trends-2026/)

**AI-Agent-Ready APIs:**
- [How to make your APIs ready for AI agents? | DigitalAPI](https://www.digitalapi.ai/blogs/how-to-make-your-apis-ready-for-ai-agents)
- [How To Prepare Your API for AI Agents | The New Stack](https://thenewstack.io/how-to-prepare-your-api-for-ai-agents/)
- [Comparing 7 AI Agent-to-API Standards | Nordic APIs](https://nordicapis.com/comparing-7-ai-agent-to-api-standards/)
- [Announcing the "AI Agent Standards Initiative" | NIST](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure)

**Rate Limiting & Tiered Access:**
- [Navigating API Rate Limits in Crypto Trading | WEEX Crypto News](https://www.weex.com/news/detail/navigating-api-rate-limits-in-crypto-trading-essential-strategies-for-developers-and-traders-204698)
- [API Rate Limits and Credit Consumption Guide | CoinAPI](https://www.coinapi.io/blog/api-rate-limits-and-credit-consumption-guide-coinapi-usage-and-billing-explained)
- [What are the API rate limits? | Kraken](https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-)
- [Top 5 Cryptocurrency Data APIs: Comprehensive Comparison (2025) | Medium](https://medium.com/coinmonks/top-5-cryptocurrency-data-apis-comprehensive-comparison-2025-626450b7ff7b)

**WebSocket Best Practices:**
- [Building real-time streaming pipelines for market data | Google Cloud](https://cloud.google.com/blog/topics/financial-services/building-real-time-streaming-pipelines-for-market-data)
- [WebSocket architecture best practices | Ably](https://ably.com/topic/websocket-architecture-best-practices)
- [Why WebSocket Multiple Updates Beat REST APIs for Real-Time Crypto Trading | CoinAPI](https://www.coinapi.io/blog/why-websocket-multiple-updates-beat-rest-apis-for-real-time-crypto-trading)
- [WebSocket Streaming in 2025 | VideoSDK](https://www.videosdk.live/developer-hub/websocket/websocket-streaming)

**Pagination Standards:**
- [A Developer's Guide to API Pagination: Offset vs. Cursor-Based | Embedded Blog](https://embedded.gusto.com/blog/api-pagination/)
- [Pagination Best Practices in REST API Design | Speakeasy](https://www.speakeasy.com/api-design/pagination)
- [Cursor pagination: how it works and its pros and cons | Merge](https://www.merge.dev/blog/cursor-pagination)
- [Comparing cursor pagination and offset pagination | Zendesk](https://developer.zendesk.com/documentation/api-basics/pagination/comparing-cursor-pagination-and-offset-pagination/)

**AsyncAPI & WebSocket Documentation:**
- [Creating AsyncAPI for WebSocket API - Step by Step | AsyncAPI Initiative](https://www.asyncapi.com/blog/websocket-part2)
- [AsyncAPI 3.1.0 Specification | AsyncAPI Initiative](https://www.asyncapi.com/docs/reference/specification/v3.1.0)
- [WebSocket Bindings | AsyncAPI](https://github.com/asyncapi/bindings/blob/master/websockets/README.md)
- [Create an AsyncAPI document for a Slackbot with WebSocket | AsyncAPI Initiative](https://www.asyncapi.com/docs/tutorials/websocket)

**OHLCV Data Standards:**
- [Mastering OHLC Data: The Core of Candlestick Charts and API Integration | OHLC.dev](https://blog.ohlc.dev/mastering-ohlc-data-the-core-of-candlestick-charts-and-api-integration-for-developers/)
- [New API endpoints for DEX OHLCV candle data | Trading Strategy](https://tradingstrategy.ai/blog/new-api-endpoints-for-dex-ohlcv-candle-data)
- [Historical Candle Data | Upstox Developer API](https://upstox.com/developer/api-documentation/get-historical-candle-data/)

**API Versioning:**
- [8 API Versioning Best Practices for Developers in 2026 | GetLate](https://getlate.dev/blog/api-versioning-best-practices)
- [API Versioning Best Practices | Redocly](https://redocly.com/blog/api-versioning-best-practices)
- [API Versioning: Strategies & Best Practices | xMatters](https://www.xmatters.com/blog/api-versioning-strategies)

**Authentication & Security:**
- [API Keys vs OAuth: Which API Authentication Method Is More Secure? | Aembit](https://aembit.io/blog/api-keys-vs-oauth-authentication-security/)
- [OAuth vs API Keys: Which API authentication method to choose? | DigitalAPI](https://www.digitalapi.ai/blogs/oauth-vs-api-keys-which-api-authentication-method-to-choose)
- [11 API Security Best Practices | Wiz](https://www.wiz.io/academy/api-security/api-security-best-practices)
- [API Security Best Practices In 2026 | Devcom](https://devcom.com/tech-blog/api-security-best-practices-protect-your-data/)

**Trading Signal APIs:**
- [JSON Message Template Creator | TradersPost](https://docs.traderspost.io/docs/core-concepts/signals/json-message-template-creator)
- [Signal Bot: Comprehensive JSON Guide | WunderTrading](https://help.wundertrading.com/en/articles/10475473-signal-bot-comprehensive-json-guide)
- [200+ Technical Analysis Indicators API | TAAPI.IO](https://taapi.io/)

---

*Feature research for: Perseus Web Public API (v8.0)*
*Researched: 2026-02-18*
*Confidence: HIGH (verified against industry standards from Binance, Coinbase, Alpaca, Stripe, and AsyncAPI/OpenAPI specifications)*
