---
phase: 13-clerk-authentication
plan: 01
subsystem: authentication
tags: [clerk, fastify, trpc, jwt, middleware]

# Dependency graph
requires:
  - phase: 12-iam-schema
    provides: IAM columns in users table, TypeScript role types
provides:
  - "@clerk/fastify plugin registered in server.ts"
  - "tRPC context with Clerk auth object"
  - "protectedProcedure middleware for authenticated routes"
  - "AuthenticatedContext type for type-safe userId access"
affects: [14-user-sync-webhooks, 15-admin-ui]

# Tech tracking
tech-stack:
  added:
    - "@clerk/fastify 2.6.17"
    - "@clerk/backend 2.29.5"
    - "@clerk/types 4.101.13"
  patterns:
    - "dotenv/config as FIRST import for Clerk env var initialization"
    - "clerkPlugin registered before tRPC routes"
    - "getAuth(req) in tRPC context for auth state"
    - "isAuthed middleware narrows userId type from string|null to string"

key-files:
  created: []
  modified:
    - apps/api/src/server.ts
    - apps/api/package.json
    - packages/trpc-config/src/context.ts
    - packages/trpc-config/src/trpc.ts
    - packages/trpc-config/package.json
    - packages/schemas/src/env/config.schema.ts

key-decisions:
  - "Import @clerk types from @clerk/backend/internal (not public API) for SignedInAuthObject/SignedOutAuthObject"
  - "Added @clerk/types as explicit dependency to resolve portable type declaration errors"

patterns-established:
  - "protectedProcedure for routes requiring authentication"
  - "AuthenticatedContext type for narrowed ctx.auth.userId access"

# Metrics
duration: 20min
completed: 2026-01-26
---

# Phase 13 Plan 01: Clerk Authentication Integration Summary

**Integrated Clerk JWT authentication into Fastify + tRPC stack with protectedProcedure middleware that throws UNAUTHORIZED for unauthenticated requests**

## Performance

- **Duration:** 20 min
- **Started:** 2026-01-26
- **Completed:** 2026-01-26
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Installed @clerk/fastify in api package and registered clerkPlugin after websocket, before tRPC
- Added `import 'dotenv/config'` as FIRST import in server.ts (Clerk reads env vars during ES module init)
- Added CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to EnvConfigSchema
- Updated tRPC context to include auth from getAuth(req)
- Created isAuthed middleware that throws TRPCError UNAUTHORIZED when ctx.auth.userId is null
- Exported protectedProcedure and AuthenticatedContext from @livermore/trpc-config

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @clerk/fastify and register plugin** - `a8fe82a` (feat)
2. **Task 2: Add auth to tRPC context** - `56d32bd` (feat)
3. **Task 3: Create protectedProcedure middleware** - `3646ccc` (feat)

## Files Created/Modified

- `apps/api/src/server.ts` - Added dotenv/config first import, clerkPlugin registration
- `apps/api/package.json` - Added @clerk/fastify dependency
- `packages/trpc-config/src/context.ts` - Added ClerkAuth type, auth field, AuthenticatedContext export
- `packages/trpc-config/src/trpc.ts` - Added isAuthed middleware, protectedProcedure export
- `packages/trpc-config/package.json` - Added @clerk/fastify, @clerk/backend, @clerk/types dependencies
- `packages/schemas/src/env/config.schema.ts` - Added CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY validation

## Decisions Made

- **Import from @clerk/backend/internal:** The SignedInAuthObject and SignedOutAuthObject types are not exported from the public @clerk/backend API. They are only available from @clerk/backend/internal.
- **Added @clerk/types dependency:** TypeScript declaration generation failed with "inferred type cannot be named" error until @clerk/types was added as an explicit dependency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Clerk types not exported from @clerk/backend**
- **Found during:** Task 2
- **Issue:** `import type { SignedInAuthObject, SignedOutAuthObject } from '@clerk/backend'` failed - types not exported
- **Fix:** Changed import to `from '@clerk/backend/internal'`
- **Files modified:** packages/trpc-config/src/context.ts
- **Committed in:** `56d32bd`

**2. [Rule 3 - Blocking] protectedProcedure type not portable**
- **Found during:** Task 3
- **Issue:** TypeScript error "inferred type cannot be named without reference to @clerk/types"
- **Fix:** Added @clerk/types as explicit dependency
- **Files modified:** packages/trpc-config/package.json
- **Committed in:** `3646ccc`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Minor import path adjustment and additional dependency. No scope creep.

## Issues Encountered

- Pre-existing TypeScript errors in database package (drizzle-orm types) and api package (implicit any) - not related to this plan, ignored

## User Setup Required

Before the server can start with Clerk authentication, the user must:

1. **Create Clerk application** (if not already done)
   - Go to Clerk Dashboard -> Applications -> Create application

2. **Set environment variables** (User scope):
   - `CLERK_PUBLISHABLE_KEY` - From Clerk Dashboard -> API Keys -> Publishable key
   - `CLERK_SECRET_KEY` - From Clerk Dashboard -> API Keys -> Secret keys

## Next Phase Readiness

- protectedProcedure ready for use in routers requiring authentication
- AuthenticatedContext type available for type-safe userId access
- Clerk plugin registered and ready for webhook verification (Phase 14)
- No existing routers converted to protected - that's optional future work

---
*Phase: 13-clerk-authentication*
*Completed: 2026-01-26*
