# Pitfalls Research: Perseus Web Public API

**Domain:** Public REST API with OpenAPI, WebSocket bridge, dual auth, and runtime modes for trading platform
**Researched:** 2026-02-18
**Confidence:** HIGH

## Executive Summary

Adding a public API to an existing internal trading platform introduces critical security surface expansion. The primary risk is intellectual property leakage - Livermore uses proprietary MACD-V indicators that must never be exposed through field names, error messages, or API documentation. Secondary risks include WebSocket memory leaks (fan-out to external clients), CORS misconfiguration exposing internal tRPC routes, rate limiting blocking admin operations, and spec drift causing client integration failures.

This research focuses on pitfalls **specific to adding public-facing features to an existing internal system**, not generic API development mistakes.

## Critical Pitfalls

### Pitfall 1: Intellectual Property Leakage Through Error Messages

**What goes wrong:**
Stack traces, field names, and error messages expose proprietary indicator names ("MACD-V", "informativeATR"), calculation formulas (EMA periods, ATR normalization), and internal architecture details that reveal competitive advantages. The codebase includes detailed documentation comments in `macd-v.ts` describing the Spiroglou formula - these must never appear in public API responses.

**Why it happens:**
Development-mode error handling gets deployed to production. Default Fastify error handlers return full stack traces. Field names in validation errors expose internal terminology. TypeScript type errors leak schema details. Developers focus on debugging convenience over IP protection.

**How to avoid:**
1. **Error sanitization layer:** Strip stack traces, replace internal field names with generic equivalents before returning to public API
2. **Generic alert schema:** Transform alerts to generic "trade signal" format - never return "macdV", "signal", "histogram" field names
3. **Separate error handlers:** Production error handler for public routes vs. verbose handler for internal tRPC routes
4. **Field name mapping:** Public API uses `value`, `timestamp`, `direction` instead of `macdV`, `signal`, `stage`
5. **No validation error details:** Return "Invalid request" not "macdV must be between -200 and 200"
6. **Audit tool:** Pre-deployment script that scans OpenAPI spec for proprietary terms

**Warning signs:**
- OpenAPI spec contains fields named "macdV", "fastEMA", "slowEMA", "atr", "informativeATR"
- Error responses include file paths like `packages/indicators/src/indicators/macd-v.ts`
- 400 errors expose Zod validation details with internal schema structure
- Debug logs enabled in production (LOG_LEVEL=debug) exposing calculation steps

**Phase to address:**
Phase 1 (Public API Foundation) - must be built into initial public route structure, impossible to retrofit cleanly later

---

### Pitfall 2: WebSocket Fan-Out Memory Leaks

**What goes wrong:**
WebSocket relay pattern broadcasts candle pulses and alerts to external clients. Without proper backpressure handling, slow clients cause unbounded memory buffering. Zombie connections (disconnected but not cleaned up) accumulate in `alertClients` and `candlePulseClients` Sets, growing indefinitely. Each leaked connection holds ~8MB per 2000 connects (based on Stomp Relay research).

Current code in `server.ts` lines 49-70 manages Sets but lacks:
- Backpressure detection (send() doesn't check if client is reading)
- Connection timeout (slow clients never removed)
- Buffer size limits per client
- Heartbeat/ping to detect zombies

**Why it happens:**
Fastify 5.7.2 and earlier ignore backpressure signals in Web Streams. The `ws` library doesn't auto-cleanup zombie connections. Developers assume `socket.readyState === 1` is sufficient (it's not - connection can be half-open). Fan-out pattern (1 Redis event → N WebSocket sends) amplifies memory consumption.

**How to avoid:**
1. **Upgrade to Fastify 5.7.3+** (fixes CVE backpressure vulnerability)
2. **Per-client buffer limits:** Track bufferedAmount per WebSocket, disconnect if > 1MB
3. **Heartbeat/ping every 30s:** Detect zombies, remove from Sets if no pong response
4. **Connection age timeout:** Auto-disconnect clients connected > 24h (forces reconnect/cleanup)
5. **Rate limit broadcasts:** Skip clients if bufferedAmount > threshold (they're already behind)
6. **Connection metadata:** Track client ID, connect time, messages sent for debugging leaks
7. **Metrics:** Expose `/metrics` endpoint showing `alertClients.size`, `candlePulseClients.size`, avg bufferedAmount

**Warning signs:**
- Memory usage grows proportionally to connected client count and never drops
- `alertClients.size` or `candlePulseClients.size` grows but never shrinks during normal operation
- Process crashes with "JavaScript heap out of memory" under load
- WebSocket broadcast latency increases over time (backpressure accumulation)
- Redis contains "candle:close" events but WebSocket clients stop receiving updates

**Phase to address:**
Phase 2 (WebSocket Bridge) - must implement cleanup BEFORE public release, memory leaks in production are catastrophic

---

### Pitfall 3: CORS Allowing Unintended Cross-Origin Access to Internal tRPC Routes

**What goes wrong:**
Public API requires permissive CORS (`origin: true` or specific domains). But current `server.ts` line 241 sets `origin: true` globally, applying to ALL routes including internal tRPC admin routes at `/trpc/*`. External sites can make authenticated requests to admin endpoints if user has valid Clerk session cookies.

Form-based CSRF attacks succeed because tRPC Fastify adapter doesn't check `Content-Type: application/json` header. Attacker site submits form to `/trpc/control.stop`, browser sends Clerk session cookie, command executes.

**Why it happens:**
Single CORS configuration applies to all routes. Developers add CORS for public API, unknowingly expose internal routes. tRPC Fastify adapter lacks Content-Type validation (unlike Express adapter). `origin: true` seems "safe" during development, becomes vulnerability in production.

**How to avoid:**
1. **Route-scoped CORS:** Register `@fastify/cors` twice - permissive for `/api/v1/*`, restrictive for `/trpc/*`
2. **Internal routes CORS:** `/trpc/*` only allows `origin: process.env.ADMIN_ORIGIN` (single admin dashboard domain)
3. **Content-Type validation middleware:** Reject tRPC requests without `Content-Type: application/json`
4. **CSRF tokens:** Add token validation for state-changing tRPC procedures
5. **SameSite cookies:** Clerk session cookies use `SameSite=Strict` or `SameSite=Lax`
6. **Separate ports:** Consider running public API on :3000, internal tRPC on :3001 (network-level isolation)

**Warning signs:**
- Single `fastify.register(cors, ...)` call applies to all routes
- OpenAPI spec includes `/trpc/*` endpoints (they shouldn't be documented publicly)
- CORS `origin` header in responses matches attacker domain for internal routes
- Browser DevTools shows `/trpc/*` requests succeed from external domains
- Fastify startup logs show CORS registered once, not per-route

**Phase to address:**
Phase 1 (Public API Foundation) - CORS misconfiguration is security vulnerability from day one, must be architected correctly initially

---

### Pitfall 4: OpenAPI Spec Drift from Actual Implementation

**What goes wrong:**
OpenAPI spec is hand-written separately from route handlers. Over time, implementation adds/removes fields, changes validation rules, adds new endpoints - but spec isn't updated. Clients generate SDKs from stale spec, receive different responses than documented. Runtime validation (Zod schemas) diverges from OpenAPI schemas.

Example: Public API adds `exchangeId` field to alert responses (Phase 27), spec still documents old schema without it. Generated TypeScript clients expect wrong type, runtime errors occur.

**Why it happens:**
No single source of truth. Developers update Zod schemas in route handlers, forget to regenerate OpenAPI spec. Manual spec updates are tedious, error-prone. No CI check that spec matches implementation. TypeScript types provide compile-time safety but don't enforce runtime/spec alignment.

**How to avoid:**
1. **Spec as source of truth:** Use `openapi-typescript-server` to generate route handlers from spec, OR
2. **Code as source of truth:** Use `@fastify/swagger` with `@fastify/swagger-ui` to auto-generate spec from Zod schemas
3. **Runtime validation:** Use `openapi-ts-router` to validate requests/responses against spec at runtime in development
4. **CI drift detection:** Script that compares OpenAPI spec fields against actual API responses from test suite
5. **Versioned specs:** `/api/v1/openapi.json` versioned alongside code, breaking changes require version bump
6. **Pre-commit hook:** Regenerate spec from code before each commit (if using code-first approach)
7. **Contract testing:** Use Pact or similar to verify spec matches actual behavior

**Warning signs:**
- OpenAPI spec `lastModified` date is weeks/months before last code change
- Client SDK bug reports about missing/unexpected fields
- Spec shows fields that don't exist in actual responses (discovered via manual testing)
- No automated process to regenerate spec (purely manual updates)
- Zod schema changes in PRs without corresponding spec updates

**Phase to address:**
Phase 1 (Public API Foundation) - must establish spec sync strategy BEFORE writing first public endpoint, retrofitting is extremely difficult

---

### Pitfall 5: Rate Limiting Affecting Internal Admin Operations

**What goes wrong:**
Rate limiter applies globally to all routes, including internal admin tRPC endpoints. Admin performs bulk operation (backfill 50 symbols, import historical data), hits rate limit, operation fails mid-execution leaving inconsistent state. Public API rate limits (100 req/min per API key) accidentally throttle admin dashboard making 200 req/min for portfolio analysis.

**Why it happens:**
Rate limiting middleware registered globally before route differentiation. No exemption for internal operations. Same Redis rate limit keys used for public API keys and admin sessions. Developers test with small datasets, bulk operations only fail in production.

**How to avoid:**
1. **Route-scoped rate limiting:** Apply rate limiter ONLY to `/api/v1/*` public routes, skip `/trpc/*`
2. **Role-based limits:** Admin role bypasses rate limits or has 100x higher thresholds
3. **Separate Redis keyspaces:** Public API uses `ratelimit:apikey:{key}`, admin uses `ratelimit:admin:{userId}` with different limits
4. **Operation-level exemptions:** Bulk operations check `X-Admin-Token` header, bypass rate limiting
5. **Rate limit headers:** Return `X-RateLimit-Remaining` so admin can detect approaching limit
6. **Emergency bypass:** Environment variable `DISABLE_RATE_LIMITING=1` for emergency admin access
7. **Metrics/alerting:** Monitor rate limit rejections by role, alert if admin hits limits

**Warning signs:**
- Admin dashboard shows "Rate limit exceeded" errors during normal use
- Bulk operations fail with 429 status codes
- Redis contains `ratelimit:*` keys for admin user IDs (should be exempt)
- No distinction in rate limit middleware between public/internal routes
- Rate limit thresholds are same for all user roles

**Phase to address:**
Phase 3 (Authentication & Rate Limiting) - must architect role-aware rate limiting from start, global limits break admin workflows

---

### Pitfall 6: Runtime Mode Flag Accidentally Disabling Exchange Connections

**What goes wrong:**
Adding `--headless` flag for public API mode (no exchange connections, serve cached data only) accidentally breaks normal exchange mode. Logic like `if (headlessMode) skipExchange()` has bug where `headlessMode` is undefined/null, evaluates truthy, skips exchange connection. Production deployment with typo `--headles` (missing 's') defaults to wrong mode, stops live data ingestion.

Current `server.ts` has `--autostart` flag (line 165-177). Adding `--headless` creates interaction: what if both flags provided? Undefined behavior.

**Why it happens:**
Boolean flag logic with implicit defaults. No validation that flag combinations are valid. ENV var `HEADLESS_MODE` conflicts with CLI `--headless` (which takes precedence?). Runtime mode affects multiple services (exchange adapter, indicator service, boundary service) - easy to miss one. No startup self-test that verifies mode is correct.

**How to avoid:**
1. **Explicit mode enum:** `--mode=exchange|headless|hybrid` (mutually exclusive, no boolean confusion)
2. **Mode validation:** Startup checks that mode is valid, no conflicting flags, required config for each mode exists
3. **Self-test per mode:** Exchange mode pings exchange API, headless mode verifies cached data exists
4. **Mode indicator in logs:** Every log line includes `[mode:exchange]` or `[mode:headless]` prefix
5. **Startup banner:** ASCII art showing current mode, exchange connections, monitored symbols
6. **Health check includes mode:** `/health` returns `{ mode: "exchange", exchangeConnected: true }` for monitoring
7. **Immutable mode:** Mode set at startup, cannot change at runtime (prevents race conditions)

**Warning signs:**
- Boolean mode flags (`--headless`, `--autostart`) instead of enum
- No validation of flag combinations (can provide both `--autostart coinbase --headless`)
- Runtime mode checks use `if (config.headless)` without explicit `=== true`
- Exchange connection logic scattered across multiple files, easy to miss mode check
- No startup log confirming mode: "Starting in EXCHANGE mode with autostart"

**Phase to address:**
Phase 4 (Runtime Modes) - must design mode system carefully from start, refactoring mode logic after deployment is risky

---

### Pitfall 7: API Key Auth Bypass via Clerk Session Cookies

**What goes wrong:**
Public API endpoints protected by API key auth middleware. But Clerk middleware also runs globally, attaches `auth` context if session cookie present. Developer forgets API key auth on one endpoint, Clerk session from admin login grants access. External user discovers they can access "API-key-only" endpoint using stolen/leaked Clerk session cookie.

Example: `/api/v1/alerts` requires API key, but accidentally uses `publicProcedure` not `apiKeyProcedure`. User with Clerk session (e.g., from shared admin dashboard access) can call endpoint without API key.

**Why it happens:**
Two parallel auth systems with unclear precedence. Clerk plugin registered globally (required for `/trpc/*`), inadvertently applies to `/api/v1/*`. Easy to forget API key middleware on new routes. No clear distinction between "internal user auth" (Clerk) and "external developer auth" (API key).

**How to avoid:**
1. **Route prefix isolation:** `/trpc/*` uses Clerk ONLY, `/api/v1/*` uses API key ONLY, never both
2. **Explicit auth middleware:** Public API routes explicitly check `req.headers.authorization` has Bearer token, reject if Clerk session present
3. **Separate tRPC instances:** Internal tRPC uses `protectedProcedure` (Clerk), public tRPC/REST uses `apiKeyProcedure` (API key)
4. **Auth test suite:** Every public endpoint has test that verifies API key required, Clerk session rejected
5. **Route registration order:** Register API key routes BEFORE Clerk plugin (so Clerk doesn't attach auth context)
6. **Middleware exclusions:** Clerk plugin config: `excludeRoutes: ['/api/v1/*', '/webhooks/*']`
7. **Security audit script:** Scans routes for missing auth middleware, flags publicProcedure usage in `/api/v1/*`

**Warning signs:**
- Clerk plugin registered globally without `excludeRoutes` config
- Public API routes sometimes check `ctx.auth.userId` instead of API key
- Mix of `publicProcedure` and `apiKeyProcedure` in same router
- No test that verifies Clerk session CANNOT access public API endpoints
- API key validation logic in some routes but not others

**Phase to address:**
Phase 3 (Authentication & Rate Limiting) - dual auth is security-critical, must be architecturally sound from the start

---

### Pitfall 8: AsyncAPI Spec Drift for WebSocket Events

**What goes wrong:**
WebSocket bridge broadcasts `candle_pulse` and `alert_trigger` events. AsyncAPI spec documents old event schema. Implementation adds `sourceExchangeId` field (Phase 27, line 90 in `server.ts`), spec not updated. Client libraries generated from spec don't expect new field, ignore it or crash on unexpected property.

Unlike REST API (request-response, easy to test), WebSocket events are fire-and-forget. Spec drift goes unnoticed until client bug reports. No compile-time or runtime validation that events match AsyncAPI schema.

**Why it happens:**
AsyncAPI less mature than OpenAPI, fewer tools for auto-generation from code. WebSocket events defined in `broadcastAlert()` and `broadcastCandlePulse()` functions, not centralized schemas. No validation that outgoing messages match AsyncAPI spec. Manual spec updates forgotten during feature development.

**How to avoid:**
1. **Event schema validation:** Validate events against Zod schema before `JSON.stringify()`, schemas shared with AsyncAPI spec generation
2. **AsyncAPI from code:** Use AsyncAPI code-first tools (if available) to generate spec from TypeScript event types
3. **Contract testing:** Record actual WebSocket events in integration tests, compare against AsyncAPI spec
4. **Version WebSocket protocols:** Include `{ version: "1.0", type: "alert_trigger", data: {...} }` in every message, bump version on breaking changes
5. **Deprecation warnings:** When adding new fields, include `{ _deprecated: false }` metadata, set true before removing old fields
6. **Dual event formats:** Temporarily send both old and new event formats during migration period
7. **Client SDK updates:** Publish AsyncAPI spec changes in release notes, provide migration guide

**Warning signs:**
- AsyncAPI spec manually edited, no automation
- WebSocket event objects defined inline in `broadcastAlert()`, not imported from schema file
- No Zod schema for WebSocket events (only REST API has schemas)
- Integration tests mock WebSocket events instead of using real event generation
- No version field in WebSocket messages (breaking changes are invisible to clients)

**Phase to address:**
Phase 2 (WebSocket Bridge) - establish AsyncAPI sync strategy before first WebSocket event goes public

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hand-written OpenAPI spec instead of code-gen | Full control over API design, no tooling setup | Guaranteed spec drift, manual sync burden, client SDK bugs | Never - always use code-first OR spec-first with tooling |
| Global CORS `origin: true` | Works immediately, no CORS errors | Exposes internal routes to CSRF, security vulnerability | Development only, NEVER production |
| Single rate limit for all routes | Simple implementation, one Redis keyspace | Admin operations fail, no role-based limits | MVP only if admin is single user, refactor before multi-user |
| Generic error responses with no detail | IP protection, hides internal structure | Difficult debugging for API consumers, poor DX | Acceptable for production public API, use detailed errors in sandbox |
| No WebSocket backpressure handling | Simpler code, works for small client counts | Memory leaks, crashes under load | Never acceptable, implement from day one |
| Boolean mode flags (`--headless`, `--autostart`) | Quick CLI implementation | Undefined behavior with flag combinations, hard to extend | Prototype only, refactor to enum mode before production |
| Reusing tRPC routes for public API | Code reuse, faster development | IP leakage via field names, CORS complexity, tight coupling | Never - always create separate public API layer with field mapping |
| No AsyncAPI spec for WebSockets | Faster initial development | Client integration pain, breaking changes invisible | Early prototype only, spec required before public beta |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Clerk + API Keys | Clerk middleware applies to all routes, API key endpoints accept Clerk sessions | Use `excludeRoutes` in Clerk config, explicitly reject Clerk auth in API key middleware |
| Fastify + CORS | Single global CORS applies to internal and public routes | Register CORS twice with different configs, or use route-scoped CORS plugin |
| tRPC + OpenAPI | Expose internal tRPC routes via trpc-openapi, leak proprietary field names | Create separate public API layer, map internal fields to generic names before exposing |
| WebSocket + Redis Pub/Sub | Relay all Redis events to all WebSocket clients (N:M fan-out) | Filter events per client subscription, implement per-client backpressure |
| Zod + OpenAPI | Maintain separate Zod schemas (code) and OpenAPI schemas (spec) | Use @fastify/swagger to generate OpenAPI from Zod, single source of truth |
| Redis Cluster + Rate Limiting | Each cluster node has independent rate limit counters | Use Redis Lua scripts for atomic distributed rate limiting, or centralized rate limit service |
| Fastify + WebSocket | Use `@fastify/websocket` with default settings (vulnerable to backpressure CVE) | Upgrade to Fastify 5.7.3+, implement per-client bufferedAmount checks |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| WebSocket fan-out without filtering | Memory grows with client count, CPU spikes on each Redis event | Per-client subscriptions (subscribe to specific symbols/timeframes only) | >100 concurrent WebSocket clients |
| N+1 Redis queries in portfolio analysis | Slow response times, Redis CPU spikes, timeout errors | Use MGET for bulk indicator fetches (already implemented in `getPortfolioAnalysis`) | >20 symbols in portfolio |
| No rate limit on WebSocket connect | Attacker opens 1000s of connections, exhausts file descriptors | Connection rate limit per IP (max 10 connects/min), max connections per IP (50) | >500 concurrent connections total |
| Broadcasting to disconnected WebSockets | CPU waste, slows down broadcast loop | Check `readyState === WebSocket.OPEN` before send (already implemented), remove zombies via ping/pong | >50 disconnected clients in Set |
| No pagination on public API endpoints | Response size grows unbounded, JSON parsing OOM | Max limit of 100 items per response, require cursor-based pagination for more | Returning >1000 candles in single response |
| Global rate limiter mutex | Single Redis lock blocks all rate limit checks | Per-key rate limiting, Lua script for atomic increment/check | >1000 req/sec across all users |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Returning internal field names (macdV, signal, atr) in public API | Exposes proprietary indicator formulas, names, calculation approach | Field name mapping layer: macdV → value, signal → baseline, atr → volatility |
| Including calculation parameters in responses | Reveals EMA periods (12, 26), ATR period (26), signal period (9) | Never return config/params in public API, only derived values |
| Verbose error messages in production | Stack traces reveal file structure, library versions, internal logic | Generic errors only: "Invalid request", "Resource not found", log details server-side |
| No API key rotation mechanism | Leaked keys grant permanent access | Implement key rotation, expiration, and revocation endpoints |
| Using sequential IDs for API keys | Enumeration attacks, key prediction | Use cryptographically random API keys (32+ bytes, URL-safe base64) |
| Storing API keys in plain text | Database breach exposes all keys | Hash API keys with bcrypt/argon2, store hash only (like passwords) |
| No rate limit on auth endpoints | Brute force API key guessing | Aggressive rate limit on `/auth` endpoints (5 attempts/min per IP) |
| CORS allows all origins in production | CSRF attacks on authenticated endpoints | Whitelist specific origins, never `origin: true` in production |
| No webhook signature verification | Fake webhook events trigger actions | HMAC signature verification for Clerk webhooks (already implemented at line 248) |
| Exposing internal routes in OpenAPI spec | Documents admin endpoints publicly, aids reconnaissance | Only include `/api/v1/*` in OpenAPI spec, exclude `/trpc/*`, `/webhooks/*` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Generic "Invalid request" errors | Developer can't fix their API call, no actionable guidance | Error codes + field-level errors: `{ error: "INVALID_TIMEFRAME", field: "timeframe", allowed: ["1m","5m",...] }` |
| No OpenAPI spec versioning | Breaking changes break all clients, no migration path | Semantic versioning: `/api/v1/`, `/api/v2/`, deprecation notices in headers |
| Missing rate limit headers | Developers don't know how many requests remain, sudden 429 errors | Always return `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| No API changelog | Developers miss breaking changes, new features undiscovered | Public changelog with dates, examples: "2026-02-18: Added sourceExchangeId field to alerts" |
| No sandbox environment | Developers test against production, risk bans, corrupt real data | Free tier sandbox with mock data, same API surface as production |
| No WebSocket reconnection guidance | Clients implement naive reconnect (rapid retries), get rate limited | Docs recommend exponential backoff, max retries, jitter |
| No pagination metadata | Developers don't know if more data exists, can't request next page | Include `{ hasNext: true, cursor: "..." }` in paginated responses |
| Inconsistent error response format | Clients need custom error handling per endpoint | Standardize: `{ success: false, error: { code: "...", message: "..." } }` |
| No WebSocket event filtering | Clients receive all events, must filter client-side (bandwidth waste) | Allow subscription to specific symbols/types: `{ subscribe: ["BTC-USD:alerts"] }` |
| Missing field documentation in OpenAPI | Developers guess field meaning, misuse API | Every field has description, example, constraints in OpenAPI spec |

## "Looks Done But Isn't" Checklist

- [ ] **OpenAPI Spec:** Spec exists but not validated against actual responses - verify with contract testing or runtime validation
- [ ] **Rate Limiting:** Rate limiter added but applies to admin routes too - verify admin can perform bulk operations
- [ ] **CORS:** CORS configured but allows all origins - verify production uses whitelist only
- [ ] **Error Handling:** Errors return 400/500 but include stack traces - verify production strips internal details
- [ ] **WebSocket Cleanup:** Close handler removes client from Set but zombies accumulate - verify ping/pong heartbeat implemented
- [ ] **API Key Auth:** API key middleware exists but some routes skip it - verify all `/api/v1/*` routes require API key
- [ ] **Field Name Mapping:** Public API exists but returns internal field names - verify no "macdV", "atr", "informativeATR" in responses
- [ ] **AsyncAPI Spec:** Spec exists but never updated - verify matches actual WebSocket events via contract tests
- [ ] **Runtime Mode:** Headless mode flag exists but not tested with exchange mode - verify startup with both flags fails gracefully
- [ ] **Dual Auth:** Both Clerk and API key work but unclear precedence - verify Clerk cannot access API-key-only endpoints

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| IP Leakage (field names exposed) | HIGH | 1. Immediate API version bump (v1 → v2), 2. Add field mapping layer, 3. Deprecate v1 with 6-month sunset, 4. Audit all endpoints for other leaks |
| WebSocket Memory Leak | LOW | 1. Deploy fix with ping/pong + backpressure, 2. Restart instances (clears leaked connections), 3. Add metrics/alerting |
| CORS Misconfiguration | LOW | 1. Update CORS config to whitelist, 2. Deploy immediately (hot fix), 3. Audit access logs for unauthorized origins |
| OpenAPI Spec Drift | MEDIUM | 1. Freeze API changes, 2. Generate spec from code or validate spec against tests, 3. Publish updated spec, 4. Contact affected developers |
| Rate Limit Blocks Admin | LOW | 1. Add admin bypass in rate limiter, 2. Deploy fix, 3. Clear rate limit Redis keys for admin user |
| Runtime Mode Bug | MEDIUM | 1. Add mode validation at startup, 2. Add self-test per mode, 3. Deploy with startup banner showing mode |
| Dual Auth Bypass | HIGH | 1. Audit all public routes for missing API key check, 2. Add test coverage, 3. Deploy fix, 4. Rotate API keys if breach suspected |
| AsyncAPI Drift | MEDIUM | 1. Version WebSocket protocol, 2. Send both old/new formats temporarily, 3. Publish updated AsyncAPI spec, 4. Deprecate old format |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| IP Leakage | Phase 1 (Public API Foundation) | Audit OpenAPI spec for proprietary terms, test error responses contain no stack traces |
| WebSocket Memory Leak | Phase 2 (WebSocket Bridge) | Load test with 1000 clients, verify memory stable after disconnects, check `alertClients.size` returns to 0 |
| CORS Misconfiguration | Phase 1 (Public API Foundation) | Test `/trpc/*` rejects cross-origin requests, `/api/v1/*` allows whitelisted origins only |
| OpenAPI Spec Drift | Phase 1 (Public API Foundation) | CI fails if spec doesn't match generated types or test responses |
| Rate Limit Blocks Admin | Phase 3 (Authentication & Rate Limiting) | Admin can backfill 100 symbols without 429 errors, public API key hits limit at 100 req/min |
| Runtime Mode Bug | Phase 4 (Runtime Modes) | Startup fails if both `--autostart` and `--headless` provided, health check shows correct mode |
| Dual Auth Bypass | Phase 3 (Authentication & Rate Limiting) | Test suite verifies Clerk session cannot access any `/api/v1/*` endpoint |
| AsyncAPI Drift | Phase 2 (WebSocket Bridge) | Integration test compares actual WebSocket events against AsyncAPI schemas |

## Sources

### Fastify & WebSocket
- [DoS via Unbounded Memory Allocation in sendWebStream - GitHub Advisory](https://github.com/fastify/fastify/security/advisories/GHSA-mrq3-vjjr-p77c)
- [How to Fix WebSocket Performance Issues - OneUpTime](https://oneuptime.com/blog/post/2026-01-24-websocket-performance/view)
- [Backpressure in WebSocket Streams - Skyline Codes](https://skylinecodes.substack.com/p/backpressure-in-websocket-streams)
- [Memory leak in Stomp Relay Broker - Spring Boot Issue #5810](https://github.com/spring-projects/spring-boot/issues/5810)
- [How to reproduce zombie connections - websockets/ws Issue #2127](https://github.com/websockets/ws/issues/2127)

### OpenAPI & Spec Drift
- [Zero-Config OpenAPI with Express, TypeScript, and Zod - Medium](https://medium.com/@pvakharia007/zero-config-openapi-swagger-with-express-typescript-and-zod-5e861a7f4f16)
- [How to Create Type-Safe API Clients in TypeScript - OneUpTime](https://oneuptime.com/blog/post/2026-01-30-typescript-type-safe-api-clients/view)
- [Typescript with the OpenAPI specification - Simon Reilly](https://blog.simonireilly.com/posts/typescript-openapi/)
- [openapi-typescript documentation](https://openapi-ts.dev/6.x/introduction)

### Dual Authentication
- [Using API keys - Machine authentication - Clerk Docs](https://clerk.com/docs/guides/development/machine-auth/api-keys)
- [Add API Key support to your SaaS - Clerk Blog](https://clerk.com/blog/add-api-key-support-to-your-saas-with-clerk)
- [Making authenticated requests - Clerk Docs](https://clerk.com/docs/guides/development/making-requests)

### CORS Security
- [Handling CORS on the Fastify Adapter - tRPC Discussion #5180](https://github.com/trpc/trpc/discussions/5180)
- [Explicit Content-Type checks - tRPC Issue #5522](https://github.com/trpc/trpc/issues/5522)
- [fastify-cors - GitHub](https://github.com/fastify/fastify-cors)

### Rate Limiting
- [Bypassing rate limits via race conditions - PortSwigger Lab](https://portswigger.net/web-security/race-conditions/lab-race-conditions-bypassing-rate-limits)
- [Rate Limiting and Throttling Patterns - Hakia](https://www.hakia.com/engineering/rate-limiting/)
- [Rate limiting best practices - Cloudflare](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)
- [API Rate Limiting 2026 Guide - Levo.ai](https://www.levo.ai/resources/blogs/api-rate-limiting-guide-2026)

### IP Protection
- [Protecting proprietary algorithms in 2026 - Linklaters](https://techinsights.linklaters.com/post/102lwgp/protecting-proprietary-algorithms-in-2026-a-strategic-imperative)
- [Information leakage via error messages - CQR](https://cqr.company/web-vulnerabilities/information-leakage-via-error-messages/)
- [ORM Error Message Information Disclosure - Medium](https://medium.com/@cameronbardin/when-error-messages-leak-more-than-logs-orms-frameworks-and-the-quiet-reconnaissance-problem-cfb336ce1117)
- [Sensitive Data in Error Messages - InstaTunnel](https://instatunnel.my/blog/sensitive-data-in-error-messages-when-your-stack-traces-give-away-the-database-schema)
- [Your Stack Trace Is Leaking - Debugg.ai](https://debugg.ai/resources/stack-trace-leaking-ai-debug-pipelines-secrets-mitigations)

### AsyncAPI
- [Creating AsyncAPI for WebSocket API - AsyncAPI Blog](https://www.asyncapi.com/blog/websocket-part2)
- [AsyncAPI 3.0.0 Release Notes](https://www.asyncapi.com/blog/release-notes-3.0.0)
- [AsyncAPI 3.1.0 Specification](https://www.asyncapi.com/docs/reference/specification/v3.1.0)
- [From API-First to Code Generation - WebSocket Use Case](https://www.asyncapi.com/blog/websocket-part3)

### tRPC Public APIs
- [Aggregate public tRPC procedures - tRPC Discussion #4964](https://github.com/trpc/trpc/discussions/4964)
- [Using tRPC for public-facing APIs - tRPC Issue #755](https://github.com/trpc/trpc/issues/755)
- [Build a Public tRPC API: trpc-openapi vs ts-rest](https://catalins.tech/public-api-trpc/)

---
*Pitfalls research for: Perseus Public API (Livermore trading platform)*
*Researched: 2026-02-18*
