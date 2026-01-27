# Phase 13: Clerk Authentication - Research

**Researched:** 2026-01-26
**Domain:** Fastify authentication with Clerk JWT validation + tRPC protected procedures
**Confidence:** HIGH

## Summary

This phase integrates Clerk authentication into Livermore's existing Fastify + tRPC stack. The codebase already has a well-structured architecture with:
- Fastify server in `apps/api/src/server.ts`
- tRPC configuration in `packages/trpc-config/src/` (context.ts, trpc.ts)
- Environment validation via `@livermore/schemas` EnvConfigSchema

The integration requires three key changes:
1. Install `@clerk/fastify` and register `clerkPlugin` in server.ts
2. Add `getAuth(req)` to tRPC context creation
3. Create `protectedProcedure` middleware that checks `ctx.auth.userId`

**Primary recommendation:** Import order is critical - `dotenv/config` must be imported before `@clerk/fastify`. Since Livermore uses `validateEnv()` from `@livermore/utils` which reads `process.env`, ensure environment variables are loaded before any Clerk imports.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @clerk/fastify | 2.6.17 | Fastify plugin for Clerk JWT validation | Official Clerk SDK for Fastify |
| @trpc/server | 11.8.1 | Already installed - tRPC server | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | N/A | Environment variable loading | Already handled by validateEnv() |
| svix | N/A | Webhook signature verification | Only if implementing user sync webhooks (out of scope for Phase 13) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @clerk/fastify | Manual JWT verification | Much more work, no auto-refresh support, error-prone |
| Clerk | Auth0, Passport.js | Clerk chosen in prior decisions - not reconsidering |

**Installation:**
```bash
pnpm add @clerk/fastify --filter @livermore/api
```

## Architecture Patterns

### Current Project Structure (Relevant Files)
```
apps/api/
├── src/
│   ├── server.ts           # Fastify server setup - ADD clerkPlugin here
│   └── routers/
│       ├── index.ts        # appRouter combining sub-routers
│       ├── indicator.router.ts  # Uses publicProcedure
│       ├── alert.router.ts      # Uses publicProcedure
│       └── position.router.ts   # Uses publicProcedure

packages/trpc-config/
├── src/
│   ├── context.ts          # MODIFY: Add auth to context
│   ├── trpc.ts             # MODIFY: Add protectedProcedure
│   └── index.ts            # Re-exports (no changes needed)
```

### Pattern 1: Import Order (CRITICAL)
**What:** Environment variables must be loaded before @clerk/fastify imports
**When to use:** Always - Clerk reads env vars during module initialization
**Current server.ts imports:**
```typescript
// Current imports in server.ts (lines 1-14)
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { logger, validateEnv } from '@livermore/utils';
import { getDbClient } from '@livermore/database';
// ... etc
```

**Required change:**
```typescript
// MUST be first - Clerk reads CLERK_SECRET_KEY during import
import 'dotenv/config';
// All other imports after
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { clerkPlugin, getAuth } from '@clerk/fastify';
// ... rest of imports
```

### Pattern 2: tRPC Context with Clerk Auth
**What:** Pass Clerk auth object to tRPC context for use in procedures
**When to use:** Every tRPC request
**Current context.ts:**
```typescript
// packages/trpc-config/src/context.ts (current)
export interface BaseContext {
  logger: Logger;
  requestId: string;
}

export function createContext({ req }: CreateFastifyContextOptions): BaseContext {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  const logger = createLogger('trpc').child({ requestId });
  return { logger, requestId };
}
```

**Required change:**
```typescript
// packages/trpc-config/src/context.ts (updated)
import { getAuth } from '@clerk/fastify';
import type { SignedInAuthObject, SignedOutAuthObject } from '@clerk/backend';

// Auth can be signed in (has userId) or signed out (no userId)
type ClerkAuth = SignedInAuthObject | SignedOutAuthObject;

export interface BaseContext {
  logger: Logger;
  requestId: string;
  auth: ClerkAuth;
}

export function createContext({ req }: CreateFastifyContextOptions): BaseContext {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  const logger = createLogger('trpc').child({ requestId });
  const auth = getAuth(req);  // Get Clerk auth from request
  return { logger, requestId, auth };
}
```

### Pattern 3: Protected Procedure Middleware
**What:** Middleware that requires authentication and narrows userId type
**When to use:** Any procedure that requires a logged-in user
**Source:** Official tRPC authorization docs
```typescript
// packages/trpc-config/src/trpc.ts
import { TRPCError } from '@trpc/server';

// Auth middleware - checks if user is authenticated
const isAuthed = t.middleware(async function isAuthed(opts) {
  const { ctx } = opts;

  if (!ctx.auth.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be signed in to access this resource',
    });
  }

  // Narrow the type - userId is now guaranteed to be string (not null)
  return opts.next({
    ctx: {
      ...ctx,
      auth: {
        ...ctx.auth,
        userId: ctx.auth.userId,  // TypeScript now knows this is string
      },
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);
```

### Pattern 4: Plugin Registration Order
**What:** clerkPlugin must be registered before tRPC routes that use getAuth
**When to use:** Server setup
```typescript
// apps/api/src/server.ts
async function start() {
  const fastify = Fastify({ logger: false });

  // 1. CORS first
  await fastify.register(cors, { origin: true });

  // 2. WebSocket support
  await fastify.register(websocket);

  // 3. Clerk plugin - BEFORE tRPC (so getAuth works in context)
  await fastify.register(clerkPlugin);

  // 4. tRPC router - context.createContext calls getAuth(req)
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      // ...
    },
  });
}
```

### Anti-Patterns to Avoid
- **Importing @clerk/fastify before dotenv/config:** Clerk reads env vars during import, not at runtime
- **Calling getAuth before clerkPlugin runs:** Will return null auth, not throw error
- **Forgetting to narrow userId type:** TypeScript will still see `string | null` without middleware narrowing
- **Hardcoding TEST_USER_ID in protected routes:** Existing routers use TEST_USER_ID = 1, should use ctx.auth.userId

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT validation | Custom JWT verification | @clerk/fastify clerkPlugin | Handles key rotation, expiration, Clerk-specific claims |
| Token refresh | Manual refresh logic | Clerk frontend SDK | Tokens are short-lived, SDK auto-refreshes |
| Auth state parsing | Custom request parsing | getAuth(req) | Handles all edge cases, signed-in vs signed-out |
| Type narrowing | Manual type guards | tRPC middleware with opts.next | Built-in pattern, proper TypeScript support |

**Key insight:** Clerk handles all the complexity of JWT validation, key rotation, and token refresh. The backend just needs to call getAuth(req) and check userId.

## Common Pitfalls

### Pitfall 1: Import Order
**What goes wrong:** Clerk fails to initialize with cryptic "Missing CLERK_SECRET_KEY" error even when env var is set
**Why it happens:** Clerk reads process.env during ES module initialization, before your code runs
**How to avoid:** `import 'dotenv/config'` MUST be the first import statement
**Warning signs:** Server crashes immediately on startup with Clerk-related error

### Pitfall 2: ESM Compatibility
**What goes wrong:** Module resolution errors, "Cannot find module"
**Why it happens:** @clerk/fastify 2.x requires ESM
**How to avoid:** Livermore already has `"type": "module"` in package.json - verified
**Warning signs:** Errors mentioning "require is not defined" or module resolution

### Pitfall 3: Context Dependency on clerkPlugin
**What goes wrong:** getAuth(req) returns null auth even for authenticated requests
**Why it happens:** getAuth reads from request decorations set by clerkPlugin
**How to avoid:** Register clerkPlugin BEFORE tRPC plugin
**Warning signs:** ctx.auth.userId is always null/undefined

### Pitfall 4: Fastify v4 vs v5 Compatibility
**What goes wrong:** Type errors or runtime errors with @clerk/fastify
**Why it happens:** @clerk/fastify v2.x requires Fastify v5+
**How to avoid:** Livermore uses Fastify 5.2.2 - compatible (verified in package.json)
**Warning signs:** TypeScript errors about Fastify types

### Pitfall 5: Mixing Public and Protected Procedures
**What goes wrong:** Protected routes return 401 for valid requests, or public routes leak data
**Why it happens:** Using wrong procedure type (publicProcedure vs protectedProcedure)
**How to avoid:** Be explicit - review each router and decide public vs protected
**Warning signs:** Unexpected 401s, or unauthenticated access to sensitive data

## Code Examples

Verified patterns from official sources:

### Complete server.ts Changes
```typescript
// apps/api/src/server.ts
// Source: Clerk Fastify docs + existing codebase

// CRITICAL: dotenv must be first for Clerk env var reading
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';  // NEW
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { logger, validateEnv } from '@livermore/utils';
// ... rest of existing imports

async function start() {
  logger.info('Starting Livermore API server...');
  const config = validateEnv();

  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  // Register Clerk plugin for JWT validation
  await fastify.register(clerkPlugin);  // NEW - BEFORE tRPC

  // Initialize database and Redis (existing code)
  getDbClient();
  const redis = getRedisClient();

  // ... existing Coinbase/indicator setup ...

  // Register tRPC - context now has auth from Clerk
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,  // Now includes auth
      onError({ path, error }) {
        logger.error({ path, error: error.message }, 'tRPC error');
      },
    },
  });

  // Health check (public, no auth)
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // ... rest of existing code ...
}
```

### Complete context.ts
```typescript
// packages/trpc-config/src/context.ts
// Source: tRPC Fastify adapter docs + Clerk Fastify docs

import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { getAuth } from '@clerk/fastify';
import type { SignedInAuthObject, SignedOutAuthObject } from '@clerk/backend';
import { createLogger, type Logger } from '@livermore/utils';

// Clerk auth can be signed in or signed out
type ClerkAuth = SignedInAuthObject | SignedOutAuthObject;

/**
 * Base context interface with Clerk auth
 */
export interface BaseContext {
  logger: Logger;
  requestId: string;
  auth: ClerkAuth;
}

/**
 * Context with authenticated user (after isAuthed middleware)
 */
export interface AuthenticatedContext extends BaseContext {
  auth: SignedInAuthObject & { userId: string };
}

/**
 * Create tRPC context for each request
 */
export function createContext({ req }: CreateFastifyContextOptions): BaseContext {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  const logger = createLogger('trpc').child({ requestId });
  const auth = getAuth(req);

  return {
    logger,
    requestId,
    auth,
  };
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export type Context = BaseContext;
```

### Complete trpc.ts
```typescript
// packages/trpc-config/src/trpc.ts
// Source: tRPC authorization docs

import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import type { Context, AuthenticatedContext } from './context';

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Auth middleware - checks if user is authenticated
 * Narrows ctx.auth.userId from string | null to string
 */
const isAuthed = t.middleware(async function isAuthed(opts) {
  const { ctx } = opts;

  if (!ctx.auth.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be signed in to access this resource',
    });
  }

  // Return narrowed context with guaranteed userId
  return opts.next({
    ctx: {
      ...ctx,
      auth: {
        ...ctx.auth,
        userId: ctx.auth.userId,
      },
    } as AuthenticatedContext,
  });
});

/**
 * Logging middleware (existing)
 */
export const loggingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const start = Date.now();
  ctx.logger.debug({ path, type }, 'tRPC procedure started');
  const result = await next();
  const duration = Date.now() - start;
  ctx.logger.debug({ path, type, duration }, 'tRPC procedure completed');
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);
export const loggedProcedure = publicProcedure.use(loggingMiddleware);
export const middleware = t.middleware;
```

### Usage in Routers
```typescript
// Example: apps/api/src/routers/indicator.router.ts
import { router, publicProcedure, protectedProcedure } from '@livermore/trpc-config';

export const indicatorRouter = router({
  // Public - no auth required (existing behavior for read-only)
  getMetadata: publicProcedure.query(async () => {
    return { ... };
  }),

  // Protected - requires authentication
  getPortfolioAnalysis: protectedProcedure
    .input(GetPortfolioAnalysisInput)
    .query(async ({ ctx, input }) => {
      // ctx.auth.userId is guaranteed to be string here
      const userId = ctx.auth.userId;
      // ... use userId instead of TEST_USER_ID
    }),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @clerk/fastify v1 | @clerk/fastify v2 | 2024-10 | Fastify v5 support required |
| tRPC v10 middleware | tRPC v11 middleware | 2024 | Same pattern, better types |
| Manual JWT parsing | getAuth(req) | N/A | Always use SDK |

**Deprecated/outdated:**
- @clerk/fastify v1.x: Does not support Fastify v5
- Manual JWT verification: Use getAuth() instead

## Open Questions

Things that couldn't be fully resolved:

1. **Which procedures should be protected vs public?**
   - What we know: Currently all use publicProcedure with hardcoded TEST_USER_ID = 1
   - What's unclear: Business requirement for which endpoints need auth
   - Recommendation: For Phase 13, focus on creating protectedProcedure. Converting existing routers is a follow-up task. Keep existing public for backward compatibility during transition.

2. **Environment variable source**
   - What we know: Clerk needs CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY
   - What's unclear: Where these will be stored (User scope env vars? .env file?)
   - Recommendation: Add to EnvConfigSchema in packages/schemas, follow existing pattern (User scope)

3. **CORS configuration for frontend**
   - What we know: Current CORS is `origin: true` (allow all)
   - What's unclear: What the admin UI origin will be
   - Recommendation: Phase 13 focuses on backend auth. CORS config for specific frontend origins is out of scope.

## Sources

### Primary (HIGH confidence)
- [Clerk Fastify Quickstart](https://clerk.com/docs/quickstarts/fastify) - Plugin registration, getAuth usage
- [tRPC Authorization Docs](https://trpc.io/docs/server/authorization) - Protected procedure pattern
- [@clerk/fastify npm](https://www.npmjs.com/package/@clerk/fastify) - Version 2.6.17

### Secondary (MEDIUM confidence)
- [Clerk tRPC Guide](https://clerk.com/docs/guides/development/trpc) - Next.js focused but pattern applies
- Prior research: .planning/research/CLERK-INTEGRATION.md - Comprehensive Clerk research

### Tertiary (LOW confidence)
- None - all critical patterns verified with official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Clerk SDK, already using Fastify 5.2.2
- Architecture: HIGH - Patterns verified against official tRPC and Clerk docs
- Pitfalls: HIGH - Well-documented import order issue, Fastify v5 compatibility confirmed

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - Clerk SDK is stable)
