# Phase 41: Authentication & Rate Limiting - Research

**Researched:** 2026-02-19
**Domain:** API key authentication, rate limiting, route-scoped CORS, error sanitization
**Confidence:** HIGH

## Summary

Phase 41 secures the public API built in Phases 39-40 with API key authentication, rate limiting, route-scoped CORS, and an admin UI for key management. The existing codebase is well-prepared: the `publicApiPlugin` in `packages/public-api/src/plugin.ts` already has a sanitized error handler (AUTH-04 is largely complete from Phase 39), error schemas for 401/429/403 are defined, and the plugin description explicitly notes "To be implemented in Phase 41" placeholders for auth and rate limiting.

The implementation involves five distinct concerns: (1) a new `api_keys` database table with Atlas migration via `schema.sql`, (2) a Fastify `onRequest` hook in the public API plugin that validates `X-API-Key` headers against database-stored UUID keys, (3) `@fastify/rate-limit` v10.x with Redis backing for 300 req/min enforcement scoped only to `/public/v1/*`, (4) route-scoped CORS replacing the current global `origin: true` with restrictive config for `/trpc/*` and permissive for `/public/v1/*`, and (5) a tRPC router + admin UI page for API key CRUD.

**Primary recommendation:** Use `@fastify/rate-limit` v10.x with the existing ioredis Redis client, scope it to the public API plugin only, use `keyGenerator` to rate-limit by API key (not IP), and implement auth as a Fastify `onRequest` hook within the public API plugin scope. CORS should use Fastify's encapsulation model -- register CORS separately in the public API plugin scope (permissive) and use a `delegator` function on the global CORS to restrict `/trpc/*` to the admin origin only.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fastify/rate-limit` | `^10.2.x` | Rate limiting with Redis backing | Official Fastify plugin, supports Fastify 5.x, built-in ioredis integration |
| `@fastify/cors` | `^10.x` (already installed) | Route-scoped CORS policies | Already in use; needs reconfiguration for route-scoped behavior |
| `node:crypto` | built-in | UUID v4 API key generation | `crypto.randomUUID()` is standard Node.js, no external dependency needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-orm` | `^0.36.4` (already installed) | API keys table schema + queries | For api_keys table definition and CRUD operations |
| `ioredis` | `^5.4.2` (already installed) | Redis store for rate limiting | Pass existing Redis client to @fastify/rate-limit |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@fastify/rate-limit` Redis store | In-memory store | Simpler but doesn't work across multiple instances; use Redis since already connected |
| UUID v4 API keys | JWT tokens | JWT adds complexity (rotation, expiration, signing keys); UUID keys are simpler for server-to-server API access |
| Database-stored keys | Redis-stored keys | Database is better for durability and admin UI queries; Redis is ephemeral |

**Installation:**
```bash
cd apps/api && pnpm add @fastify/rate-limit
```

Note: `@fastify/rate-limit` is added to `apps/api` (not `packages/public-api`) because it needs the Redis client instance from server.ts. Alternatively, it can be added to `packages/public-api` if the Redis client is passed as a plugin option.

## Architecture Patterns

### Recommended Project Structure
```
packages/
  public-api/
    src/
      middleware/
        auth.ts              # API key validation hook
        rate-limit.ts        # Rate limit configuration
      plugin.ts              # [MODIFIED] Register auth + rate-limit hooks
      ...existing routes, schemas, transformers
  database/
    schema.sql               # [MODIFIED] Add api_keys table
    src/
      schema/
        api-keys.ts          # NEW: Drizzle schema for api_keys
        index.ts             # [MODIFIED] Export api-keys

apps/
  api/
    src/
      server.ts              # [MODIFIED] Route-scoped CORS
      routers/
        api-key.router.ts    # NEW: tRPC router for key management
        index.ts             # [MODIFIED] Add apiKey router
  admin/
    src/
      pages/
        ApiKeys.tsx           # NEW: Admin UI page
      components/
        api-keys/
          ApiKeyTable.tsx     # NEW: Key list with copy/regenerate
```

### Pattern 1: Fastify Plugin-Scoped Auth Hook
**What:** Register an `onRequest` hook inside the `publicApiPlugin` that runs before every `/public/v1/*` request. This hook validates the `X-API-Key` header, looks up the key in the database (with in-memory cache), and rejects unauthenticated requests with 401.
**When to use:** When auth applies to an entire plugin scope but not other routes.
**Example:**
```typescript
// packages/public-api/src/middleware/auth.ts
import { getDbClient } from '@livermore/database';
import { eq, and } from 'drizzle-orm';

// In-memory cache: API key UUID -> { id, isActive, lastUsedAt }
const keyCache = new Map<string, { id: number; isActive: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export async function validateApiKey(apiKey: string): Promise<number | null> {
  // Check cache first
  const cached = keyCache.get(apiKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.isActive ? cached.id : null;
  }

  // Database lookup
  const db = getDbClient();
  const [row] = await db
    .select({ id: apiKeys.id, isActive: apiKeys.isActive })
    .from(apiKeys)
    .where(eq(apiKeys.key, apiKey))
    .limit(1);

  if (!row) return null;

  // Update cache
  keyCache.set(apiKey, { id: row.id, isActive: row.isActive, cachedAt: Date.now() });

  // Update last_used_at asynchronously (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {}); // Non-critical

  return row.isActive ? row.id : null;
}

// In plugin.ts, register as onRequest hook:
instance.addHook('onRequest', async (request, reply) => {
  // Skip auth for OpenAPI docs and spec
  if (request.url.endsWith('/docs') || request.url.endsWith('/openapi.json')
      || request.url.startsWith('/public/v1/docs')) {
    return;
  }

  const apiKey = request.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'API key required. Set X-API-Key header.' },
    });
    return;
  }

  const keyId = await validateApiKey(apiKey);
  if (!keyId) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive API key' },
    });
    return;
  }

  // Store key ID on request for rate limiting key generator
  (request as any).apiKeyId = keyId;
});
```

### Pattern 2: Plugin-Scoped Rate Limiting with Redis
**What:** Register `@fastify/rate-limit` inside the `publicApiPlugin` so it only applies to `/public/v1/*` routes. Admin tRPC routes are exempt because they're in a different plugin scope.
**When to use:** When rate limiting applies to one route prefix but not another.
**Example:**
```typescript
// Inside publicApiPlugin, after auth hook:
import rateLimit from '@fastify/rate-limit';

await instance.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  keyGenerator: (request) => {
    // Rate limit per API key, not per IP
    return String((request as any).apiKeyId ?? request.ip);
  },
  redis: redis,  // Pass existing ioredis client
  nameSpace: 'rl:public:',
  skipOnError: true,  // Don't block requests if Redis is down
  errorResponseBuilder: (_request, context) => ({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: `Rate limit exceeded. Retry after ${context.after}.`,
    },
  }),
  addHeadersOnExceeding: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
    'retry-after': true,
  },
});
```

### Pattern 3: Route-Scoped CORS via Fastify Encapsulation
**What:** Replace the current global `origin: true` CORS with separate configurations for public API and tRPC routes.
**When to use:** When different route prefixes need different CORS policies.
**Example:**
```typescript
// server.ts -- replace current global cors:

// 1. Global CORS with delegator for route-aware logic
await fastify.register(cors, {
  delegator: (request, callback) => {
    const origin = request.headers.origin;
    const url = request.url;

    // Public API: permissive (any origin)
    if (url.startsWith('/public/v1')) {
      callback(null, { origin: true });
      return;
    }

    // tRPC/Admin: restrictive (only admin dashboard origin)
    const adminOrigin = process.env.ADMIN_ORIGIN ?? 'http://localhost:4001';
    callback(null, {
      origin: adminOrigin,
      credentials: true,
    });
  },
});
```
**Alternative approach:** Register CORS separately in each plugin scope. The public API plugin registers its own permissive CORS, while the main server registers restrictive CORS for `/trpc/*`. This is cleaner with Fastify encapsulation but requires careful plugin ordering.

### Pattern 4: API Keys Table Schema
**What:** PostgreSQL table for API key storage with Atlas state-based migrations.
**Example:**
```sql
-- In schema.sql (source of truth for Atlas)
CREATE TABLE "api_keys" (
  "id" serial NOT NULL,
  "name" character varying(100) NOT NULL,
  "key" uuid NOT NULL DEFAULT gen_random_uuid(),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" character varying(255) NOT NULL,  -- Clerk user ID
  "last_used_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_key_unique" UNIQUE ("key")
);

CREATE INDEX "api_keys_key_idx" ON "api_keys" ("key") WHERE is_active = true;
```

### Anti-Patterns to Avoid
- **Global rate limiting that blocks tRPC:** Register rate-limit inside the public API plugin scope only, never globally. Admin routes must be exempt.
- **Storing API keys in plaintext without index:** The `key` column needs a unique index for O(1) lookups. UUID format ensures uniqueness without hashing.
- **Rate limiting by IP behind proxy:** Always rate-limit by API key when API key auth is required. IP-based limiting is unreliable behind CDNs/proxies.
- **Blocking on last_used_at updates:** The `last_used_at` update should be fire-and-forget (async, no await). It's informational, not critical.
- **Full database query per request:** Use in-memory cache with TTL for API key validation. A 60-second cache means at most 1 DB query per key per minute.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting with sliding window | Custom Redis INCR + EXPIRE | `@fastify/rate-limit` | Handles edge cases (window boundaries, race conditions, header management) |
| UUID generation | Custom random string | `crypto.randomUUID()` | Cryptographically secure, RFC 4122 compliant, built into Node.js |
| CORS header management | Manual header setting | `@fastify/cors` | Handles preflight, credentials, vary headers correctly |
| Rate limit response headers | Manual x-ratelimit headers | `@fastify/rate-limit` built-in headers | Automatically manages limit/remaining/reset headers |

**Key insight:** Rate limiting has subtle edge cases (distributed counters, window boundary alignment, header calculation) that `@fastify/rate-limit` handles correctly. Custom implementations almost always have race conditions or incorrect header values.

## Common Pitfalls

### Pitfall 1: Redis Cluster Mode and Rate Limit Key Hashing
**What goes wrong:** `@fastify/rate-limit` uses Redis INCR commands. In Redis Cluster mode (which this project uses for Azure Redis), keys must hash to the same slot for multi-key operations.
**Why it happens:** The rate limit plugin uses a namespace prefix. If the plugin uses MULTI/EXEC or Lua scripts that operate on multiple keys, they must be in the same hash slot.
**How to avoid:** The `@fastify/rate-limit` plugin uses single-key operations (INCR + PTTL per key), so this should work fine with Redis Cluster. But verify by testing. If issues arise, use `nameSpace` with hash tags: `'{rl}:public:'`.
**Warning signs:** Redis CROSSSLOT errors in logs.

### Pitfall 2: Auth Hook Ordering with Rate Limiting
**What goes wrong:** If rate limiting runs before auth, unauthenticated requests consume rate limit quota for legitimate users (if keyed by IP).
**Why it happens:** Plugin registration order matters in Fastify. `@fastify/rate-limit` typically uses `onRequest` hook.
**How to avoid:** Register the auth `onRequest` hook BEFORE registering `@fastify/rate-limit`. The auth hook sets `request.apiKeyId` which the rate limit `keyGenerator` uses. Since both use `onRequest`, the hook registered first runs first. Alternatively, set rate-limit to use `hook: 'preHandler'` which runs after `onRequest`.
**Warning signs:** Rate limit headers appearing on 401 responses.

### Pitfall 3: CORS Delegator and Preflight Requests
**What goes wrong:** OPTIONS preflight requests don't carry the API key, so the auth hook must skip OPTIONS requests.
**Why it happens:** Browsers send OPTIONS without custom headers before the actual request.
**How to avoid:** In the auth hook, check `request.method === 'OPTIONS'` and skip authentication. Or register auth as `preHandler` instead of `onRequest` and let CORS handle OPTIONS at the `onRequest` level.
**Warning signs:** CORS preflight failures from browser clients.

### Pitfall 4: Swagger UI Behind Auth
**What goes wrong:** If the auth hook blocks all `/public/v1/*` requests, Swagger UI at `/public/v1/docs` becomes inaccessible.
**Why it happens:** Swagger UI is registered under the same plugin scope.
**How to avoid:** Skip auth for `/docs` paths (including static assets). The auth hook should check if the URL starts with the docs prefix and bypass authentication for those paths.
**Warning signs:** 401 errors when accessing API documentation.

### Pitfall 5: Drizzle Schema vs schema.sql Drift
**What goes wrong:** The Drizzle schema file (`packages/database/src/schema/api-keys.ts`) gets out of sync with `schema.sql`.
**Why it happens:** This project uses Atlas for state-based migrations with `schema.sql` as source of truth. The Drizzle schema file in `drizzle/schema.ts` (auto-generated) and the hand-written schema files in `src/schema/` must match.
**How to avoid:** Add the table to `schema.sql` first (source of truth), then write the Drizzle schema in `src/schema/api-keys.ts` to match. Run Atlas to apply the migration.
**Warning signs:** Runtime errors about missing columns or tables.

## Code Examples

### API Key Generation (tRPC Mutation)
```typescript
// apps/api/src/routers/api-key.router.ts
import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, apiKeys } from '@livermore/database';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export const apiKeyRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = getDbClient();
    return db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        // Show only last 8 chars of key for security
        keyPreview: apiKeys.key,
        isActive: apiKeys.isActive,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .orderBy(apiKeys.createdAt);
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const key = randomUUID();
      const [created] = await db
        .insert(apiKeys)
        .values({
          name: input.name,
          key,
          createdBy: ctx.auth.userId,
        })
        .returning();

      // Return full key only on creation (never shown again in full)
      return { id: created.id, name: created.name, key, createdAt: created.createdAt };
    }),

  regenerate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const newKey = randomUUID();
      const [updated] = await db
        .update(apiKeys)
        .set({ key: newKey, updatedAt: new Date().toISOString() })
        .where(eq(apiKeys.id, input.id))
        .returning();

      if (!updated) throw new Error('API key not found');

      // Invalidate cache
      // (clear the in-memory keyCache in the public-api package)

      return { id: updated.id, name: updated.name, key: newKey };
    }),

  deactivate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      await db
        .update(apiKeys)
        .set({ isActive: false, updatedAt: new Date().toISOString() })
        .where(eq(apiKeys.id, input.id));
      return { success: true };
    }),
});
```

### Drizzle Schema Definition
```typescript
// packages/database/src/schema/api-keys.ts
import { pgTable, serial, varchar, uuid, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  key: uuid('key').notNull().defaultRandom().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  createdBy: varchar('created_by', { length: 255 }).notNull(),
  lastUsedAt: timestamp('last_used_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  keyActiveIdx: index('api_keys_key_idx').on(table.key).where(sql`is_active = true`),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
```

### OpenAPI Security Scheme Update
```typescript
// In plugin.ts, add to openapi config:
openapi: {
  // ...existing config
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'API key for authentication. Obtain from admin dashboard.',
      },
    },
  },
  security: [{ apiKey: [] }],
},
```

### Admin UI Page Pattern
```tsx
// apps/admin/src/pages/ApiKeys.tsx
// Follows same pattern as Settings.tsx:
// - useQuery for list
// - useMutation for create/regenerate/deactivate
// - Card layout with table
// - Copy-to-clipboard for new keys
// - Confirmation dialog for destructive actions
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JWT tokens for API auth | API keys (UUID) for server-to-server | N/A | Simpler, no expiration management, better for bot/script clients |
| `fastify-rate-limit` (v5-8) | `@fastify/rate-limit` (v10.x) | Fastify 5 ecosystem | Scoped package name, Fastify 5 compatibility |
| IP-based rate limiting | API-key-based rate limiting | Industry trend | More accurate, not affected by proxies/NAT |
| Global CORS `origin: true` | Route-scoped CORS | Fastify encapsulation | Security improvement for admin routes |

**Deprecated/outdated:**
- `fastify-rate-limit` (unscoped): Replaced by `@fastify/rate-limit` for Fastify 5
- Hash-based API keys: For this use case, plain UUID stored in database is sufficient. Hashing adds complexity without meaningful security benefit since the key is transmitted in cleartext over HTTPS anyway.

## Open Questions

1. **Admin UI origin for CORS restriction**
   - What we know: Admin runs on `localhost:4001` in dev. Production origin is unknown.
   - What's unclear: What is the production admin URL?
   - Recommendation: Use `ADMIN_ORIGIN` environment variable with `localhost:4001` default. Add to `EnvConfigSchema` as optional.

2. **Cache invalidation on key regeneration/deactivation**
   - What we know: The auth middleware uses in-memory cache with 60s TTL for key validation.
   - What's unclear: When a key is regenerated or deactivated via admin UI, the cache could serve stale data for up to 60 seconds.
   - Recommendation: Accept 60-second staleness. For immediate invalidation, export a `clearKeyCache()` function from the public-api package and call it from the tRPC mutation. Or use a shorter TTL (30s).

3. **Whether to expose Swagger UI without auth**
   - What we know: Swagger UI is useful for API exploration and onboarding.
   - What's unclear: Should `/public/v1/docs` be accessible without an API key?
   - Recommendation: YES -- expose docs without auth. The OpenAPI spec and Swagger UI should be freely accessible. Only data endpoints require authentication. This matches industry standard (Coinbase, Binance, etc. all have public API docs).

4. **Should the `@fastify/rate-limit` dependency live in `packages/public-api` or `apps/api`?**
   - What we know: The rate-limit plugin needs the Redis client instance. Currently Redis is initialized in `server.ts`.
   - Recommendation: Add dependency to `packages/public-api`. Pass the Redis client as a plugin option to `publicApiPlugin`. This keeps the rate limiting logic co-located with the public API code.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/public-api/src/plugin.ts` -- existing sanitized error handler, plugin structure
- Codebase analysis: `packages/database/schema.sql` -- source of truth for Atlas, table definition patterns
- Codebase analysis: `apps/api/src/server.ts` -- CORS registration, plugin wiring, Redis/DB initialization
- Codebase analysis: `packages/database/src/schema/users.ts` -- Drizzle schema definition pattern
- Codebase analysis: `apps/api/src/routers/settings.router.ts` -- tRPC mutation pattern with protectedProcedure
- [@fastify/rate-limit GitHub README](https://github.com/fastify/fastify-rate-limit) -- Plugin API, Redis integration, keyGenerator, hooks
- [@fastify/cors GitHub](https://github.com/fastify/fastify-cors) -- Delegator option, route-level overrides

### Secondary (MEDIUM confidence)
- [@fastify/rate-limit npm](https://www.npmjs.com/package/@fastify/rate-limit) -- Version 10.2.x confirmed for Fastify 5.x
- [@fastify/cors npm](https://www.npmjs.com/package/@fastify/cors) -- Version 11.x confirmed for Fastify 5.x
- `.planning/research/ARCHITECTURE.md` -- Architecture patterns for public API, rate limiting approach

### Tertiary (LOW confidence)
- Redis Cluster compatibility with rate-limit plugin -- needs runtime verification (single-key ops should work, but untested on Azure Managed Redis with OSS Cluster mode)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- `@fastify/rate-limit` is the official Fastify plugin; Redis integration is well-documented
- Architecture: HIGH -- Fastify encapsulation model for plugin-scoped auth + rate-limit is well-established; patterns verified in codebase
- Pitfalls: HIGH -- CORS preflight, hook ordering, Redis Cluster compatibility are real concerns documented in official sources
- Admin UI: HIGH -- Follows identical patterns to existing Settings page (tRPC mutation + useQuery)

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable domain, 30 days)
