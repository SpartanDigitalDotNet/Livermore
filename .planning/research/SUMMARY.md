# Project Research Summary

**Project:** v8.0 Perseus Web Public API
**Domain:** Public REST/WebSocket API for cryptocurrency trading platform
**Researched:** 2026-02-18
**Confidence:** HIGH

## Executive Summary

Livermore v8.0 adds a public API layer to expose trading signals and market data to external clients while protecting proprietary MACD-V indicator algorithms. The research reveals this is a **lightweight integration** (5 official Fastify plugins) rather than a framework migration - the existing stack (Fastify 5.2.2, Zod 3.25.76, ioredis 5.4.2) supports all required functionality with minimal additions.

The recommended approach is **dual-mode architecture**: exchange instances ingest live data and calculate indicators while pw-host instances serve public API requests from Redis cache. This separation prevents public API load from degrading internal operations. Public endpoints use generic signal labeling (momentum_signal, trend_signal) with NO indicator names or calculation parameters exposed. OpenAPI 3.1 and AsyncAPI 3.1 specs are generated from Zod schemas to maintain spec-code sync and enable AI-agent-ready documentation.

The critical risk is **intellectual property leakage** through field names, error messages, or documentation. One exposed parameter (EMA period, ATR multiplier) destroys competitive advantage. Mitigation requires a DTO transformation layer that whitelists public fields and strips all proprietary internals before responses leave the server. Secondary risks include WebSocket memory leaks (unbounded client buffering), CORS misconfiguration exposing internal tRPC routes, and OpenAPI spec drift breaking client integrations.

## Key Findings

### Recommended Stack

The stack addition is minimal and focused. All new packages are official Fastify ecosystem plugins with verified version compatibility. No custom protocols, no heavy frameworks - everything integrates with existing infrastructure.

**Core technologies:**
- **@fastify/swagger@^9.7.0** + **fastify-type-provider-zod@^4.0.2**: Generate OpenAPI 3.1 spec from existing Zod schemas - zero schema duplication, single source of truth for validation and documentation
- **@fastify/bearer-auth@^10.1.1**: API key authentication via Bearer tokens - constant-time comparison prevents timing attacks, async validator allows database lookup
- **@fastify/rate-limit@^10.3.0**: Distributed rate limiting backed by existing ioredis cluster - enforces per-key limits across multiple API instances
- **@fastify/websocket@^11.0.1**: Already installed - existing bridge pattern for /ws/alerts extends to public WebSocket endpoints with authentication
- **@asyncapi/cli@^2.21.0**: Dev-only tool to generate WebSocket event documentation - AsyncAPI 3.1 spec with concrete examples

**Critical constraint:** MACD-V details are proprietary IP and MUST NEVER appear in public responses. Field names like "macdV", "signal", "histogram", "fastEMA", "slowEMA", "atr" expose the algorithm. Public API returns generic "trade_signal" with direction/strength only.

### Expected Features

Public API must deliver real-time trading signals (the differentiator) and standard market data (table stakes). AI-agent-ready documentation positions the API spec as the product, with Perseus Web as the reference implementation.

**Must have (table stakes):**
- REST endpoints for OHLCV candles, generic trade signals, alert history, exchange/symbol metadata
- Cursor-based pagination with ISO8601 time filtering (prevents duplicate/missing data during concurrent writes)
- OpenAPI 3.1 spec with AI-optimized descriptions, concrete examples, comprehensive error schemas
- WebSocket bridge for real-time candle closes and trade signals with subscription management
- API key authentication with tiered rate limiting (60/300/1000 req/min for Free/Basic/Pro)
- Runtime mode flag (exchange vs pw-host) enabling distributed architecture

**Should have (competitive):**
- Interactive API explorer (Swagger UI at /docs) for in-browser testing
- Rate limit headers (X-RateLimit-Remaining, X-RateLimit-Reset) enabling client backoff logic
- Verbose error messages with hints ("Use ISO8601: 2026-02-18T12:00:00Z")
- Usage dashboard showing per-key metrics (requests/day, endpoints called, rate limit hits)
- Sandbox environment with historical BTC/ETH data only (no live signals)

**Defer (v2+):**
- Client SDK npm package (@perseus-web/sdk) - wait for spec stability (no breaking changes for 2+ months)
- Server-Sent Events fallback for corporate proxies that block WebSocket
- Webhook delivery for alerts (push vs poll) - requires retry/failure infrastructure
- Public status page with uptime/incident history

### Architecture Approach

The architecture extends existing Fastify server with public routes at separate path prefix. Two authentication systems coexist via route scoping: Clerk JWT for /trpc/* admin routes, Bearer token API keys for /api/v1/* public routes. OpenAPI spec generation uses zod-openapi library to add .openapi() metadata to schemas - same schemas provide runtime validation, TypeScript types, and documentation.

**Major components:**
1. **Public API Routes** (packages/public-api/) - New bounded context with REST handlers, registered via fastify-zod-openapi, isolated from internal tRPC routes
2. **Data Transformation Layer** (DTO pattern) - Whitelists public fields, strips proprietary internals (indicator formulas, internal IDs, user context) before response
3. **WebSocket Bridge** (extends existing pattern) - Subscribes to Redis pub/sub via psubscribe, fans out to N external clients with backpressure handling
4. **Runtime Mode Manager** - Conditional service initialization based on RUNTIME_MODE env var (exchange starts adapters/indicators, pw-host reads cache only)
5. **OpenAPI Generator** - Fastify plugin that transforms Zod schemas to OpenAPI 3.1, serves spec at /public/v1/openapi.json

**Data flow (pw-host mode):** HTTP request → Zod validation → Redis cache read → DTO transformation → Response
**Data flow (WebSocket):** Exchange adapter → Redis pub/sub → Bridge filters by subscription → Transform to public format → WebSocket.send() to clients

### Critical Pitfalls

Research identified 8 critical pitfalls specific to adding public-facing features to an existing internal system. These are not generic API mistakes - they exploit the intersection of internal proprietary logic and public exposure.

1. **Intellectual Property Leakage Through Error Messages** - Stack traces, field names in validation errors, and debug logs expose "MACD-V", EMA periods, ATR normalization. Fix: Error sanitization layer strips stack traces, generic field names only ("value" not "macdV"), audit OpenAPI spec for proprietary terms. MUST be built into Phase 1 - impossible to retrofit cleanly.

2. **WebSocket Fan-Out Memory Leaks** - Slow clients cause unbounded buffering. Zombie connections (disconnected but not cleaned up) accumulate in Sets. Each leaked connection holds ~8MB per 2000 connects. Fix: Upgrade to Fastify 5.7.3+, per-client buffer limits, ping/pong heartbeat every 30s, disconnect if bufferedAmount > 1MB. Address in Phase 2 before public release.

3. **CORS Allowing Unintended Cross-Origin Access to Internal tRPC Routes** - Single global CORS config (origin: true) exposes /trpc/* admin endpoints to form-based CSRF. Fix: Route-scoped CORS - permissive for /api/v1/*, restrictive for /trpc/* (only admin dashboard origin). MUST architect correctly in Phase 1 - security vulnerability from day one.

4. **OpenAPI Spec Drift from Actual Implementation** - Hand-written spec diverges from code. Implementation adds fields, spec not updated. Generated clients break. Fix: Use @fastify/swagger to auto-generate spec from Zod schemas (code as source of truth), CI drift detection comparing spec against test responses. Establish sync strategy in Phase 1 before writing first endpoint.

5. **Rate Limiting Affecting Internal Admin Operations** - Global rate limiter throttles /trpc/* admin bulk operations (backfill 50 symbols). Fix: Route-scoped rate limiting ONLY on /api/v1/*, admin role bypasses or has 100x higher limits. Address in Phase 3 when adding rate limiting.

## Implications for Roadmap

Based on research, a **5-phase roadmap** balances risk mitigation (IP protection first) with iterative delivery (REST before WebSocket). Each phase delivers independently testable value.

### Phase 1: Public API Foundation & IP Protection
**Rationale:** Security first - establish field mapping and error sanitization before exposing any data. Can't retrofit IP protection after fields are public.
**Delivers:**
- REST endpoints for candles, symbols, exchange metadata (read-only, non-proprietary data)
- DTO transformation layer with field whitelisting (internal → public schema mapping)
- OpenAPI 3.1 spec auto-generated from Zod schemas
- Route-scoped CORS (permissive for /api/v1/*, restrictive for /trpc/*)
- Error sanitization (no stack traces, generic field names)
**Addresses:** API-01 through API-05 (core endpoints), FMT-01 through FMT-05 (response standards), IP-01 through IP-05 (protection patterns)
**Avoids:** Pitfall 1 (IP leakage), Pitfall 3 (CORS misconfiguration), Pitfall 4 (spec drift)

### Phase 2: Trade Signals with Generic Labeling
**Rationale:** Proprietary value comes from signals. DTO layer from Phase 1 strips MACD-V internals, returns generic momentum_signal/trend_signal.
**Delivers:**
- /api/v1/signals/:symbol/:timeframe endpoint returning generic trade signals
- /api/v1/alerts endpoint with alert history (transformed to hide indicator names)
- Signal metadata filtering (direction, strength, timeframe, price ONLY - no histogram/EMA values)
- Audit tool scanning OpenAPI spec for proprietary terms (macdV, atr, informativeATR)
**Addresses:** API-02 (trade signals), API-03 (alert history), IP-02 (signal metadata filtering), IP-03 (indicator name scrubbing)
**Uses:** Signal transformation logic from Phase 1 DTO layer
**Avoids:** Pitfall 1 (IP leakage through field names)

### Phase 3: Authentication & Rate Limiting
**Rationale:** Can't launch public API without auth/rate limiting. Defer until REST endpoints work to avoid blocking development.
**Delivers:**
- API key authentication via @fastify/bearer-auth (database lookup in users.api_key column)
- Rate limiting via @fastify/rate-limit with Redis backing (60/300/1000 req/min tiers)
- Route-scoped rate limiting (ONLY /api/v1/*, admin /trpc/* exempt)
- API key generation tRPC mutation for admin UI
- API key display/regenerate UI in admin panel
**Addresses:** AUTH-01 (API key auth), AUTH-03 (API key scopes), AUTH-04 (tiered rate limiting)
**Avoids:** Pitfall 5 (rate limiting blocks admin operations), Pitfall 7 (dual auth bypass)

### Phase 4: WebSocket Bridge with Backpressure
**Rationale:** Most complex component - build last after REST patterns validated. Memory leaks in production are catastrophic.
**Delivers:**
- WebSocket endpoint /public/ws/market-data with API key auth via query param
- Redis pub/sub subscription (psubscribe to candle:close:* and alert:trigger:*)
- Fan-out logic with per-client subscription filtering
- Backpressure handling (track bufferedAmount, pause/disconnect slow clients)
- Ping/pong heartbeat every 30s to detect zombie connections
- Connection limits per API key (max 5 concurrent WebSocket connections)
**Addresses:** WS-01 through WS-07 (WebSocket bridge features)
**Uses:** DTO transformers from Phase 1 to sanitize WebSocket events
**Avoids:** Pitfall 2 (WebSocket memory leaks), Pitfall 8 (AsyncAPI spec drift)

### Phase 5: Runtime Modes & Distributed Architecture
**Rationale:** Enables horizontal scaling - exchange instances ingest data, pw-host instances serve API. Required before production load.
**Delivers:**
- RUNTIME_MODE env var (exchange | pw-host)
- Mode validation at startup (exchange requires API credentials, pw-host requires Redis only)
- Conditional service initialization (exchange starts adapters/indicators, pw-host skips)
- Redis-only data access in pw-host mode (read from cache, no writes)
- Health check includes mode status (/health returns { mode: "pw-host", redisConnected: true })
**Addresses:** MODE-01 through MODE-05 (runtime mode features)
**Avoids:** Pitfall 6 (runtime mode flag bugs)

### Phase Ordering Rationale

- **IP protection first** (Phase 1) because field names can't be changed after public release - breaking API change
- **REST before WebSocket** (Phases 1-3 before 4) because WebSocket requires working DTO layer and simpler to test/debug REST first
- **Auth deferred to Phase 3** to avoid blocking REST endpoint development - can test with mock API keys initially
- **Runtime modes last** (Phase 5) because not required until production deployment - single instance handles both ingest and API for MVP
- **Trade signals second** (Phase 2) validates IP protection layer works correctly before exposing proprietary data

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Authentication):** API key storage patterns (hash vs plaintext), rotation mechanisms, scope enforcement details
- **Phase 4 (WebSocket):** Backpressure algorithms, connection pool sizing, Redis Streams vs pub/sub for replay

Phases with standard patterns (skip research-phase):
- **Phase 1 (REST API):** Well-documented Fastify + OpenAPI patterns, similar to Stripe/Twilio APIs
- **Phase 2 (Trade Signals):** DTO transformation is standard pattern, no novel approaches needed
- **Phase 5 (Runtime Modes):** Environment-based service initialization is common Node.js pattern

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified against installed versions (Fastify 5.2.2, Zod 3.25.76, ioredis 5.4.2). Official Fastify ecosystem plugins with active maintenance. Version compatibility confirmed via release notes. |
| Features | HIGH | Feature landscape validated against industry standards (Binance, Coinbase, Alpaca APIs). OpenAPI/AsyncAPI specs are established standards. AI-agent-ready documentation patterns emerging but clear direction. |
| Architecture | HIGH | Patterns verified in existing codebase (WebSocket bridge already exists for /ws/alerts, Redis pub/sub pattern in IndicatorCalculationService). Dual auth via route scoping is standard Fastify pattern. |
| Pitfalls | HIGH | Pitfalls sourced from CVE advisories (Fastify backpressure vulnerability), production bug reports (WebSocket memory leaks in Spring Boot, zombie connections in ws library), and security best practices (CORS/CSRF, error message leakage). |

**Overall confidence:** HIGH

### Gaps to Address

Research was comprehensive but identified areas requiring validation during implementation:

- **API key hashing strategy**: Research recommends bcrypt/argon2 like passwords, but unclear if performance impact (database lookup on every request) is acceptable. May need caching layer or plaintext with encryption at rest. Validate during Phase 3 planning.

- **WebSocket connection limits**: Research suggests 1000 concurrent connections per instance as limit, but actual limit depends on server specs (ulimit -n, available memory). Load testing required during Phase 4 to establish real limits.

- **Rate limiting granularity**: Unclear if per-endpoint rate limits (strict for /signals, relaxed for /candles) are necessary at MVP or single global limit suffices. Defer decision until usage patterns emerge post-launch.

- **Cursor pagination implementation**: Research confirms cursor-based is superior to offset, but Redis ZRANGE cursor patterns need validation. Existing cache keys (candles:userId:exchangeId:symbol:timeframe) may not support efficient cursor queries. Address during Phase 1 planning.

## Sources

### Primary (HIGH confidence)
- **STACK.md**: @fastify/swagger@9.7.0, @fastify/bearer-auth@10.1.1, @fastify/rate-limit@10.3.0, fastify-type-provider-zod@4.0.2, @asyncapi/cli@2.21.0 verified against npm registry and GitHub releases
- **FEATURES.md**: Binance API, Coinbase API, Alpaca Markets API analysis, AsyncAPI 3.1.0 specification, OpenAPI 3.1 specification, financial data API best practices from multiple providers
- **ARCHITECTURE.md**: Fastify documentation, tRPC Fastify adapter, fastify-zod-openapi GitHub, Redis pub/sub documentation, existing codebase analysis (server.ts, cache/client.ts, indicator-calculation.service.ts)
- **PITFALLS.md**: Fastify CVE-2026-backpressure advisory, WebSocket memory leak reports (Spring Boot issue #5810, websockets/ws issue #2127), CORS security (tRPC discussions #5180, #5522), OpenAPI spec drift patterns, Clerk dual auth documentation

### Secondary (MEDIUM confidence)
- API versioning best practices (Redocly, xMatters, GetLate)
- WebSocket scaling patterns (Ably, Mercure, Pusher)
- AsyncAPI WebSocket bindings tutorial
- Rate limiting patterns (Cloudflare, Levo.ai, Hakia)

### Tertiary (LOW confidence)
- DTO pattern in TypeScript (CodeWithStyle blog)
- Monorepo internal packages (Konrad Reiche blog)

---
*Research completed: 2026-02-18*
*Ready for roadmap: yes*
