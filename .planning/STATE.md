# Project State: Livermore Trading Platform

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Data accuracy and timely alerts
**Current focus:** v8.0 Perseus Web Public API - Phase 43 (Runtime Modes & Distributed Architecture)

## Current Position

**Milestone:** v8.0 Perseus Web Public API
**Phase:** 43 of 43 (Runtime Modes & Distributed Architecture)
**Plan:** 2 of 2 complete
**Status:** Phase 43 Complete

**Last activity:** 2026-02-19 — Phase 43 Plan 02 complete (mode-gated server startup for pw-host vs exchange)

Progress: [████░░░░░░] 8 of 13 milestones complete (61%)

## Performance Metrics

**Velocity:**
- Total plans completed: 85+ (across v1.0-v8.0)
- Average duration: Varies by phase complexity
- Total execution time: ~45.1 hours (across 8 milestones in progress)

**Recent milestones:**
- v7.0: 7 phases, 2 days (2026-02-13)
- v6.0: 6 phases, 2 days (2026-02-10)
- v5.0: 7 phases, 2 days (2026-02-08)

## Milestones

| Version | Name | Status | Shipped |
|---------|------|--------|---------|
| v1.0 | Fee Analysis Spike | Archived | 2026-01-19 |
| v2.0 | Data Pipeline Redesign | Archived | 2026-01-24 |
| v3.0 | Admin UI + IAM Foundation | Archived | 2026-01-30 |
| v4.0 | User Settings + Runtime Control | Archived | 2026-02-06 |
| v5.0 | Distributed Exchange Architecture | Archived | 2026-02-08 |
| v6.0 | Perseus Network | Archived | 2026-02-10 |
| v7.0 | Smart Warmup & Binance Adapter | Archived | 2026-02-13 |
| v8.0 | Perseus Web Public API | **Active** | — |

See `.planning/MILESTONES.md` for full history.

| Plan | Duration (s) | Tasks | Files |
|------|--------------|-------|-------|
| Phase 39 P01 | 298 | 2 tasks | 9 files |
| Phase 39 P02 | 364 | 2 tasks | 5 files |
| Phase 39 P03 | 281 | 1 task | 3 files |
| Phase 40 P01 | 223 | 2 tasks | 6 files |
| Phase 40 P02 | 241 | 2 tasks | 4 files |
| Phase 41 P01 | 474 | 2 tasks | 11 files |
| Phase 41 P02 | 264 | 1 task | 3 files |
| Phase 42 P01 | 294 | 2 tasks | 6 files |
| Phase 42 P02 | 540 | 2 tasks | 7 files |
| Phase 43 P01 | 286 | 2 tasks | 3 files |
| Phase 43 P02 | 287 | 1 task | 1 file |

## Tech Debt (Carried Forward)

| Issue | Priority | Impact | From |
|-------|----------|--------|------|
| indicator.router.ts uses publicProcedure | High | Unprotected API access | v3.0 |
| alert.router.ts uses publicProcedure | High | Unprotected API access | v3.0 |
| position.router.ts uses publicProcedure | High | Unprotected API access | v3.0 |
| switch-mode is a stub | Medium | Mode doesn't actually switch | v4.0 |
| Autostart has no user context | High | Can't load user settings/symbols | v5.0 |
| Autostart hardcodes exchangeId=1 (Coinbase) | Medium | Autostart only supports Coinbase | v5.0 |
| Routers hardcode TEST_USER_ID/TEST_EXCHANGE_ID | Medium | Tied to publicProcedure debt | v3.0 |
| Legacy userId param in cache calls (candle/indicator only) | Low | Ticker keys migrated (v7.0 Phase 34); candle/indicator still have userId | v5.0 |
| Swagger UI CSP inline style violation | Low | swagger-ui-bundle.js blocked by Content Security Policy 'style-src' directive; needs 'unsafe-inline' or nonce | v8.0 |

## Accumulated Context

### Hard Constraints (User-Specified)

| Constraint | Reason |
|------------|--------|
| **NO cron jobs** | User explicitly rejected node-cron approach |
| **NO aggregation** | User stated "Don't suggest aggregate to me ever again" |
| **Zero 429 errors** | Core reliability requirement |
| **Atlas-only migrations** | Drizzle migrations BANNED - schema.sql is source of truth |
| **SSL required** | Azure PostgreSQL requires SSL - hardcode, don't use env vars |
| **No silent defaults** | If exchange unknown, surface error -- never default to Coinbase |
| **One instance per exchange** | Only one Livermore API may actively serve a given exchange at any time |
| **Env vars from Windows User scope** | Never use .env files -- environment variables injected via .ps1 scripts |
| **MACD-V is proprietary IP** | NEVER expose MACD-V name, formula, or calculation details publicly. Public API uses generic labels ("trade signal", "momentum", "divergence"). Internal indicator names must not leak through public endpoints. |

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Recent decisions affecting v8.0 work:

- **IP protection first**: Phase 39 establishes DTO transformation layer before any proprietary data is exposed (can't retrofit after fields are public)
- **REST before WebSocket**: Simpler protocol establishes data contracts first (Phases 39-41 before 42)
- **Auth deferred to Phase 41**: Allows REST endpoint development without blocking on API key infrastructure
- **Runtime modes last**: Phase 43 (pw-host mode) not required until production deployment
- **5-phase structure**: Derived from requirements (not imposed template), aligns with research recommendations

**Phase 39-01 decisions:**
- **Explicit field whitelisting over omission**: transformCandle() uses explicit field selection (not spreading and omitting) - ensures new internal fields never leak
- **String decimals for prices**: API uses string format (not numbers) to prevent precision loss, aligns with API-08 requirement
- **Opaque Base64 cursors**: Pagination cursors encode internal values (hides implementation details)
- **Zero indicators dependency**: @livermore/public-api does NOT depend on @livermore/indicators - hard IP isolation boundary
- [Phase 39]: Direct Redis access (not CandleCacheStrategy) for candle route to avoid userId dependency
- [Phase 39]: In-memory exchange name -> ID caching (exchanges rarely change)
- [Phase 39]: Liquidity score thresholds: >=0.8=high, >=0.5=medium, else low

**Phase 40-01 decisions:**
- **Local interface copies for IP isolation**: CachedIndicator and AlertHistoryRow defined locally in transformers, no imports from @livermore/cache or @livermore/database
- **Strength thresholds**: >=150 extreme, >=80 strong, >=30 moderate, <30 weak (consistent across signals and alerts)
- **Conservative alert direction fallback**: Unrecognized trigger labels default to bearish

**Phase 41-01 decisions:**
- **In-memory Map cache for API key validation**: 60s TTL avoids DB hit per request; single-instance makes distributed cache unnecessary
- **Negative cache entries for invalid keys**: Prevents repeated DB hits from bad actors
- **Fire-and-forget last_used_at update**: Non-blocking, informational only
- **CORS delegator pattern**: Single registration with route-scoped origin logic
- **Redis hash tag {rl}: for rate limit namespace**: Ensures cluster slot compatibility

**Phase 41-02 decisions:**
- **Radix Dialog for confirmations**: Used existing Dialog component over window.confirm for visual consistency
- **Page-level revealed key state**: Create and regenerate share single revealedKey state, one key shown at a time

**Phase 40-02 decisions:**
- **Signals not paginated**: Fixed set of 4 timeframes per symbol, static meta with has_more: false
- **Internal alertType in WHERE only**: `alertType='macdv'` filters DB query but never appears in response
- **Bidirectional exchange cache**: alerts route caches name->id and id->name from same DB query

**Phase 42-02 decisions:**
- **Triple-slash reference for @fastify/websocket types**: Module augmentation needed in plugin scope for websocket route options
- **Variable declaration reorder in server.ts**: activeExchangeId/Name moved before plugin registration
- **Skip /stream in buildAuthHook**: WS auth via query param, not X-API-Key header
- **Bridge conditional on exchangeId**: Idle mode (no exchange) has no WebSocket bridge

**Phase 43-02 decisions:**
- **Early-return pattern for mode isolation**: isPwHost block returns early, keeping exchange code at original indentation and unchanged
- **Conditional validateEnv call**: isPwHost ? validateEnv('pw-host') : validateEnv() satisfies TypeScript overloads (union type doesn't match either overload)
- **Exchange identity from env vars in pw-host**: LIVERMORE_EXCHANGE_ID/NAME enables optional WS bridge without exchange adapter

**Phase 43-01 decisions:**
- **Zod .omit() for schema derivation**: PwHostEnvConfigSchema derived from EnvConfigSchema, stays in sync automatically
- **Function overloads for validateEnv()**: Compile-time type narrowing based on mode parameter
- **resolveMode() standalone function**: Separated from validateEnv() so mode is resolved once at startup

**Phase 42-01 decisions:**
- **bufferedAmount thresholds**: 64KB skip, 256KB terminate -- heuristic backpressure detection
- **Pong handler in constructor**: Attached once to avoid listener accumulation
- **Stringify once, fan out many**: Envelope JSON.stringify'd once then sent to all matching clients
- **Alert channel from payload**: External channel built from parsed JSON payload (symbol+timeframe), not Redis channel
- **External channel format**: `candles:SYMBOL:TIMEFRAME` and `signals:SYMBOL:TIMEFRAME`

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

### Last Session

**Date:** 2026-02-19
**Activity:** Executing Phase 43 Plan 02
**Stopped At:** Completed 43-02-PLAN.md (mode-gated server startup for pw-host vs exchange)

### Resume Context

**PHASE 39 COMPLETE AND VERIFIED**

Phase 39 delivered:
- `@livermore/public-api` package with Zod schemas, DTO transformers, cursor pagination
- GET /public/v1/candles/:exchange/:symbol/:timeframe (Redis sorted set read)
- GET /public/v1/exchanges (DB + Redis status check)
- GET /public/v1/symbols (DB with liquidity grading)
- Fastify plugin with OpenAPI 3.1 spec (jsonSchemaTransform), Swagger UI at /docs
- Sanitized error handler (no stack traces, no internal fields)
- Verification: 8/8 must-haves passed, zero proprietary field names in code/spec

**Fixes applied post-execution:**
- Added `jsonSchemaTransform` to swagger config (spec was dumping raw Zod internals)
- Moved error handler before route registration (wasn't covering child scopes)
- Bypassed Zod response serializer in error handler (prevented double-fault)

**Model profile:** Switched to `quality` (Opus for executors) per user preference

**PHASE 40 COMPLETE**

Phase 40 delivered:
- Zod schemas with `.describe()` for signal and alert public types (Plan 01)
- Whitelist transformers mapping internal indicator data to generic direction/strength categories (Plan 01)
- GET /public/v1/signals/:exchange/:symbol reading multi-timeframe signals from Redis (Plan 02)
- GET /public/v1/alerts with cursor pagination from PostgreSQL alert_history (Plan 02)
- OpenAPI spec with Signals and Alerts tags, all 5 route handlers registered
- Zero proprietary indicator names in any response body or OpenAPI spec

**PHASE 41 PLAN 01 COMPLETE**

Phase 41 Plan 01 delivered:
- `api_keys` database table with Drizzle schema and partial index
- API key validation middleware with 60s in-memory cache
- Rate limiting at 300 req/min per API key via Redis (@fastify/rate-limit)
- tRPC CRUD router for API key management (list/create/regenerate/deactivate)
- Route-scoped CORS (permissive for public API, restrictive for admin)
- OpenAPI X-API-Key security scheme in spec

**PHASE 41 COMPLETE**

Phase 41 Plan 02 delivered:
- API Keys admin page at #/api-keys with navigation link
- ApiKeyTable component with masked previews, status badges, confirmation dialogs
- Create flow shows full key once with copy-to-clipboard
- Regenerate and deactivate with Radix Dialog confirmations
- Toast notifications for all mutation feedback

**PHASE 42 PLAN 01 COMPLETE**

Phase 42 Plan 01 delivered:
- WebSocketBridge class with Redis psubscribe fan-out through IP-protective transformers
- ClientConnection with heartbeat ping/pong (30s) and bufferedAmount backpressure (64KB/256KB)
- WS message types, Zod discriminated union schemas, external channel parser
- Message handlers for subscribe/unsubscribe with channel format validation
- Per-API-key connection counting (max 5) for WS-06 enforcement

**PHASE 42 COMPLETE**

Phase 42 Plan 02 delivered:
- /public/v1/stream WebSocket endpoint with query param API key auth (close codes 4001/4008)
- Bridge lifecycle integrated via plugin onClose hook
- Auth hook skips /stream (WS auth handled in-route)
- AsyncAPI 3.1 spec documenting all message types with concrete JSON examples
- Zero proprietary indicator names in any public-facing code or spec

**PHASE 43 PLAN 01 COMPLETE**

Phase 43 Plan 01 delivered:
- RuntimeMode type ('exchange' | 'pw-host') in @livermore/schemas
- resolveMode() reads LIVERMORE_MODE env var, defaults to 'exchange', throws on invalid
- PwHostEnvConfigSchema derived via Zod .omit() (removes Coinbase, Clerk, Discord fields)
- validateEnv() accepts optional RuntimeMode with TypeScript overloads for type-safe returns
- Full backward compatibility: existing validateEnv() calls unchanged

**PHASE 43 COMPLETE**

Phase 43 Plan 02 delivered:
- Mode-gated server.ts with pw-host early-return path
- pw-host mode: Fastify + CORS + WS + DB + Redis + publicApiPlugin + /health only
- No Clerk, tRPC, Discord, or exchange services in pw-host mode
- Health endpoint reports mode ('pw-host' or 'exchange') with appropriate service status
- WebSocket bridge optionally available in pw-host via LIVERMORE_EXCHANGE_ID/NAME env vars
- Exchange mode completely unchanged except mode field in health response

**Phase 43 (Runtime Modes) complete: v8.0 Perseus Web Public API milestone fully delivered**

---
*State initialized: 2026-01-18*
*Last updated: 2026-02-19 — Phase 43 Plan 02 complete (mode-gated server startup for pw-host vs exchange)*
