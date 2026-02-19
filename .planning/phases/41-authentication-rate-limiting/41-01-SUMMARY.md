---
phase: 41-authentication-rate-limiting
plan: 01
subsystem: auth
tags: [api-key, rate-limit, fastify, cors, openapi, redis]

# Dependency graph
requires:
  - phase: 39-public-api-foundation
    provides: Fastify publicApiPlugin, OpenAPI 3.1 spec, route handlers
  - phase: 40-trade-signals
    provides: Signal and alert routes registered in plugin
provides:
  - api_keys database table and Drizzle schema
  - API key validation middleware with in-memory cache (60s TTL)
  - Rate limiting at 300 req/min per API key via Redis
  - tRPC CRUD router for API key management (list/create/regenerate/deactivate)
  - Route-scoped CORS (permissive for public API, restrictive for admin)
  - OpenAPI X-API-Key security scheme
affects: [42-websocket-streaming, 43-runtime-modes]

# Tech tracking
tech-stack:
  added: ["@fastify/rate-limit"]
  patterns: ["onRequest auth hook with cache", "CORS delegator pattern", "Redis-backed distributed rate limiting"]

key-files:
  created:
    - packages/database/src/schema/api-keys.ts
    - packages/public-api/src/middleware/auth.ts
    - packages/public-api/src/middleware/rate-limit.ts
    - apps/api/src/routers/api-key.router.ts
  modified:
    - packages/database/schema.sql
    - packages/database/src/schema/index.ts
    - packages/public-api/src/plugin.ts
    - packages/public-api/src/index.ts
    - packages/public-api/package.json
    - apps/api/src/routers/index.ts
    - apps/api/src/server.ts

key-decisions:
  - "In-memory Map cache with 60s TTL for API key validation (avoids DB hit per request)"
  - "Fire-and-forget last_used_at update (non-blocking, swallows errors)"
  - "Negative cache entries for invalid keys (prevents repeated DB hits)"
  - "Redis hash tag {rl}: prefix for rate limit keys (cluster slot compatibility)"
  - "CORS delegator pattern for route-scoped origins (permissive public, restrictive admin)"
  - "Public API registration moved after Redis init (rate limiting needs Redis client)"

patterns-established:
  - "Auth hook pattern: onRequest hook with skip list for docs/CORS paths"
  - "Cache invalidation via clearKeyCache() exported from public-api to tRPC layer"
  - "Rate limit key generator uses apiKeyId (set by auth hook) falling back to IP"

# Metrics
duration: 8min
completed: 2026-02-19
---

# Phase 41 Plan 01: Authentication & Rate Limiting Summary

**X-API-Key auth with 60s in-memory cache, 300 req/min Redis-backed rate limiting, route-scoped CORS, and tRPC API key management**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-19T13:42:49Z
- **Completed:** 2026-02-19T13:50:43Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- API key authentication protecting all /public/v1/* data endpoints (401 for missing/invalid keys)
- Redis-backed rate limiting at 300 req/min with proper headers and 429 responses
- tRPC CRUD router for API key lifecycle (create returns full key once, list shows masked preview)
- Route-scoped CORS: permissive for public API consumers, restrictive admin origin for tRPC
- OpenAPI spec documents X-API-Key security scheme; Swagger UI accessible without auth

## Task Commits

Each task was committed atomically:

1. **Task 1: Database schema, Drizzle model, and API key tRPC router** - `a30ca75` (feat)
2. **Task 2: Auth middleware, rate limiting, plugin wiring, and route-scoped CORS** - `e3a303f` (feat)

## Files Created/Modified
- `packages/database/schema.sql` - Added api_keys table with partial index on active keys
- `packages/database/src/schema/api-keys.ts` - Drizzle schema with apiKeys table, ApiKey/NewApiKey types
- `packages/database/src/schema/index.ts` - Re-exports api-keys module
- `packages/public-api/src/middleware/auth.ts` - API key validation with in-memory cache, buildAuthHook
- `packages/public-api/src/middleware/rate-limit.ts` - Rate limit config factory (300 req/min, Redis-backed)
- `packages/public-api/src/plugin.ts` - Auth hook + rate-limit registration, OpenAPI security scheme
- `packages/public-api/src/index.ts` - Exports clearKeyCache for tRPC cache invalidation
- `packages/public-api/package.json` - Added @fastify/rate-limit dependency
- `apps/api/src/routers/api-key.router.ts` - tRPC CRUD router (list/create/regenerate/deactivate)
- `apps/api/src/routers/index.ts` - Wired apiKeyRouter into appRouter
- `apps/api/src/server.ts` - Route-scoped CORS delegator, Redis pass-through to publicApiPlugin

## Decisions Made
- **In-memory cache over Redis cache for auth:** 60s TTL Map avoids per-request DB queries while keeping invalidation simple (clearKeyCache on mutations). Single-instance deployment makes distributed cache unnecessary.
- **Negative cache entries:** Invalid keys cached too (as isActive=false) to prevent repeated DB hits from bad actors.
- **Fire-and-forget last_used_at:** Non-blocking update with swallowed errors -- last_used_at is informational, not critical path.
- **CORS delegator over multiple plugin registrations:** Single CORS registration with delegator function is cleaner than registering separate CORS configs per route prefix.
- **Public API moved after Redis init:** Registration order changed so Redis client is available for rate limiting plugin.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created middleware files before Task 1 verification**
- **Found during:** Task 1 (api-key.router.ts imports clearKeyCache from @livermore/public-api)
- **Issue:** Task 1 creates api-key.router.ts which imports `clearKeyCache` from `@livermore/public-api`, but that export doesn't exist until Task 2 creates auth.ts and updates index.ts.
- **Fix:** Created auth.ts and index.ts export as part of the same compilation pass, then committed files in correct task groupings.
- **Files modified:** packages/public-api/src/middleware/auth.ts, packages/public-api/src/index.ts
- **Verification:** `npx tsc --noEmit` passes for both packages
- **Committed in:** e3a303f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking dependency)
**Impact on plan:** Cross-task import dependency required parallel file creation. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in route files (reply.code(400/404) type mismatches with fastify-type-provider-zod) -- not related to this plan, did not fix.

## User Setup Required
- **Database migration:** Run `atlas schema apply` to create the `api_keys` table in production (schema.sql is source of truth).
- **API key creation:** After migration, use tRPC `apiKey.create` mutation to generate the first API key.

## Next Phase Readiness
- Authentication and rate limiting infrastructure complete
- Ready for Phase 41 Plan 02 (if exists) or Phase 42 (WebSocket streaming)
- API keys table needs Atlas migration before production use

## Self-Check: PASSED

- All 4 created files exist on disk
- Both task commits (a30ca75, e3a303f) verified in git log
- TypeScript compilation passes for new/modified files

---
*Phase: 41-authentication-rate-limiting*
*Completed: 2026-02-19*
