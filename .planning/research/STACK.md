# Stack Research: v8.0 Perseus Web Public API

**Project:** Livermore Trading Platform - Public REST/WebSocket API Layer
**Researched:** 2026-02-18
**Confidence:** HIGH (verified against installed Fastify 5.2.2, Zod 3.25.76, ioredis 5.4.2, @fastify/websocket 11.0.1)

## Executive Summary

v8.0 Perseus Web (PW) adds a public API layer for external clients to access real-time trading signals and market data. The existing Fastify + tRPC + Clerk stack serves the admin UI perfectly, and the public API runs **alongside** it (not replacing it). Key additions:

1. **OpenAPI 3.1 spec generation** from existing Zod schemas (zero schema duplication)
2. **API key authentication** via Bearer tokens (parallel to Clerk JWTs for admin)
3. **WebSocket bridge** to broadcast Redis pub/sub events to external clients (pattern already exists for `/ws/alerts`)
4. **Runtime mode flag** to run Fastify without `listen()` for testing/serverless
5. **Rate limiting** with Redis backing (distributed enforcement across instances)
6. **AsyncAPI 3.1 documentation** for WebSocket event streams

**Critical constraint:** MACD-V indicator details are proprietary IP and MUST NEVER be exposed publicly. Public API returns generic "trade signals" (bullish/bearish, no numeric values).

**Stack decision:** This is a **5-library addition** (all official Fastify ecosystem plugins). Zero custom protocols, zero heavy frameworks. Everything integrates with the existing Fastify instance, Zod schemas, ioredis cluster, and WebSocket setup.

---

## Recommended Stack Additions

### Core Technologies (NEW for v8.0)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **@fastify/swagger** | ^9.7.0 | Generate OpenAPI 3.1 spec from route schemas | Official Fastify plugin, published 3 days ago (Feb 2026). Auto-generates docs from Zod schemas via type providers. Requires Fastify ^5.x (current: 5.2.2, compatible). Supports both OpenAPI v2 and v3.1. |
| **@fastify/swagger-ui** | ^5.2.0 | Serve interactive Swagger UI at `/docs` | Official companion to @fastify/swagger. Provides embeddable API testing interface with "Try it out" functionality. No external tools needed for API exploration. |
| **fastify-type-provider-zod** | ^4.0.2 | Bridge Zod schemas to OpenAPI via @fastify/swagger | Enables reuse of existing Zod validation schemas (`@livermore/schemas`) for OpenAPI generation. Provides `jsonSchemaTransform` and type-safe compilers. Supports Zod ^3.x (current: 3.25.76, compatible). |
| **@fastify/bearer-auth** | ^10.1.1 | API key authentication via Bearer tokens | Official Fastify plugin. Constant-time comparison prevents timing attacks. Runs as `onRequest` hook (before routing, before tRPC). Integrates with OpenAPI security schemes. Supports async key validation (database lookup). |
| **@fastify/rate-limit** | ^10.3.0 | Rate limiting with Redis backing | Official Fastify plugin. Supports ioredis cluster (current: 5.4.2, compatible). Distributed rate limiting across instances. Per-route limits configurable. `skipOnError: true` for fail-open behavior if Redis is down. |

**Total new dependencies:** 5 packages (all official Fastify ecosystem, actively maintained)

### Supporting Libraries (NEW)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@asyncapi/cli** | ^2.21.0 | Generate AsyncAPI documentation for WebSocket events | Dev dependency only. Run as CLI tool during build: `asyncapi generate fromTemplate asyncapi.yaml @asyncapi/html-template`. Latest version (11 days ago) supports AsyncAPI 3.1 spec with WebSocket bindings. |

**Total dev dependencies:** 1 package (CLI tool, not runtime)

### No Additional WebSocket Libraries Needed

**Existing `@fastify/websocket ^11.0.1` is sufficient.** You're already using it for `/ws/alerts` and `/ws/candle-pulse` (see `apps/api/src/server.ts` lines 48-429). The bridge pattern (Set of clients + Redis pub/sub → broadcast) is already implemented.

**For public API:** Extend the existing pattern with authentication (`?api_key=xxx` query parameter on handshake) and sanitized payloads (no MACD-V internals).

---

## Installation

```bash
# Core OpenAPI generation and documentation
pnpm add @fastify/swagger@^9.7.0 @fastify/swagger-ui@^5.2.0 fastify-type-provider-zod@^4.0.2

# API key authentication
pnpm add @fastify/bearer-auth@^10.1.1

# Rate limiting with Redis backing
pnpm add @fastify/rate-limit@^10.3.0

# AsyncAPI documentation generator (dev dependency - CLI tool)
pnpm add -D @asyncapi/cli@^2.21.0
```

**Total install time:** < 30 seconds (small packages, minimal dependencies)

---

## Integration with Existing Stack

### 1. OpenAPI Generation from Existing Zod Schemas

**Goal:** Reuse Zod schemas from `@livermore/schemas` for both validation AND OpenAPI documentation (zero duplication).

```typescript
// apps/api/src/server.ts
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform
} from 'fastify-type-provider-zod';

// Set Zod as the type provider for Fastify routes
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

// Register OpenAPI spec generator
await fastify.register(swagger, {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Perseus Web API',
      description: 'Real-time cryptocurrency trading signals and market data',
      version: '8.0.0',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development' },
      { url: 'https://api.livermore.io', description: 'Production' }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API_KEY',
          description: 'API key in Bearer token format (generate in user settings)'
        }
      }
    }
  },
  transform: jsonSchemaTransform, // Converts Zod schemas to OpenAPI JSON Schema
});

// Serve Swagger UI at /docs (publicly accessible for documentation)
await fastify.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true
  },
  staticCSP: true
});
```

**Route definition with Zod schema:**

```typescript
// apps/api/src/routes/public/candles.ts
import { z } from 'zod';

const CandleQuerySchema = z.object({
  symbol: z.string().describe('Trading pair (e.g., BTC-USD)'),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).describe('Candle timeframe'),
  limit: z.number().int().min(1).max(1000).default(100).describe('Number of candles to return')
});

const CandleResponseSchema = z.array(z.object({
  timestamp: z.number().describe('Unix timestamp (milliseconds)'),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number()
}));

// Fastify route with automatic OpenAPI generation
fastify.get('/api/v1/candles', {
  schema: {
    querystring: CandleQuerySchema,
    response: {
      200: CandleResponseSchema
    },
    tags: ['Market Data'],
    security: [{ BearerAuth: [] }]  // Requires API key
  }
}, async (request, reply) => {
  const { symbol, timeframe, limit } = request.query;
  // ... fetch candles from Redis ...
  return candles;
});
```

**Why this works:** `fastify-type-provider-zod` provides:
- `validatorCompiler`: Validates incoming requests against Zod schemas
- `serializerCompiler`: Validates outgoing responses against Zod schemas
- `jsonSchemaTransform`: Converts Zod schemas to OpenAPI-compatible JSON Schema

**Result:** One schema definition → runtime validation + type safety + OpenAPI docs. Zero duplication.

**Confidence:** HIGH — verified against `fastify-type-provider-zod@4.0.2` documentation and `@fastify/swagger@9.7.0` release notes.

### 2. API Key Authentication (Parallel to Clerk)

**Architecture:** Two authentication systems coexist:
- `/trpc/*` → Clerk JWT authentication (admin UI, existing)
- `/api/v1/*` → Bearer token API key authentication (external clients, new)
- `/webhooks/*` → No auth (server-to-server with signature verification, existing)

```typescript
// apps/api/src/middleware/api-key-auth.ts
import bearerAuth from '@fastify/bearer-auth';
import { getDbClient } from '@livermore/database';
import { eq } from 'drizzle-orm';
import { users } from '@livermore/database/schema';

/**
 * Validate API key by looking up in users.api_key column.
 * Constant-time comparison prevents timing attacks.
 *
 * @param key - API key from Authorization: Bearer <key> header
 * @returns Promise<boolean> - true if valid, false otherwise
 */
async function validateApiKey(key: string): Promise<boolean> {
  const db = getDbClient();
  const user = await db.query.users.findFirst({
    where: eq(users.apiKey, key),
    columns: { id: true, apiKey: true }
  });
  return !!user;
}

// Register on public API routes only (scoped to /api/v1)
await fastify.register(bearerAuth, {
  keys: new Set<string>(), // Empty set — will use async validator
  auth: validateApiKey,
  errorResponse(err) {
    return {
      error: 'Invalid or missing API key',
      message: 'Provide a valid API key in Authorization: Bearer <key> header',
      statusCode: 401
    };
  }
}, { prefix: '/api/v1' }); // Scoped to public API routes only
```

**Database schema addition:**

```typescript
// packages/database/src/schema/users.ts
export const users = pgTable('users', {
  // ... existing columns ...
  apiKey: varchar('api_key', { length: 64 }).unique(),  // API key for public API
  apiKeyCreatedAt: timestamp('api_key_created_at'),
});
```

**API key generation:**

```typescript
// apps/api/src/routers/user.ts (tRPC mutation)
import { randomBytes } from 'node:crypto';

// Generate a new API key for the authenticated user
generateApiKey: protectedProcedure.mutation(async ({ ctx }) => {
  const apiKey = randomBytes(32).toString('hex'); // 64 hex characters
  await ctx.db.update(users)
    .set({ apiKey, apiKeyCreatedAt: new Date() })
    .where(eq(users.clerkId, ctx.auth.userId));
  return { apiKey };
})
```

**Why this approach:**
- `@fastify/bearer-auth` runs as `onRequest` hook (before routing, before Clerk)
- Clerk middleware runs separately for tRPC routes (unchanged)
- Both can coexist because they're scoped to different route prefixes
- Constant-time comparison in bearer-auth prevents timing attacks
- Async validator allows database lookup without blocking

**Confidence:** HIGH — standard Fastify pattern, bearer-auth is official plugin.

### 3. Rate Limiting with Redis Backing

**Goal:** Distributed rate limiting across multiple API instances using shared Redis cluster (already running for pub/sub and caching).

```typescript
// apps/api/src/plugins/rate-limit.ts
import rateLimit from '@fastify/rate-limit';
import { getRedisClient } from '@livermore/cache';

await fastify.register(rateLimit, {
  redis: getRedisClient(), // Reuse existing ioredis cluster connection
  timeWindow: '1 minute',
  max: 60, // 60 requests per minute per API key (default)
  skipOnError: true, // Fail open if Redis is down (graceful degradation)
  keyGenerator: (req) => {
    // Use API key as identifier (more accurate than IP address)
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    return apiKey || req.ip; // Fallback to IP if no API key
  },
  errorResponseBuilder: (req, context) => ({
    error: 'Rate limit exceeded',
    message: `You have exceeded the rate limit of ${context.max} requests per ${context.after}ms`,
    limit: context.max,
    remaining: 0,
    resetAt: new Date(Date.now() + context.after).toISOString()
  })
});
```

**Per-route rate limits:**

```typescript
// Stricter limit for expensive endpoints
fastify.get('/api/v1/signals', {
  config: {
    rateLimit: {
      max: 10, // 10 requests per minute (overrides global 60)
      timeWindow: '1 minute'
    }
  },
  schema: { /* ... */ }
}, async (request, reply) => {
  // ... fetch trading signals ...
});

// More lenient for lightweight endpoints
fastify.get('/api/v1/ticker/:symbol', {
  config: {
    rateLimit: {
      max: 120, // 120 requests per minute
      timeWindow: '1 minute'
    }
  },
  schema: { /* ... */ }
}, async (request, reply) => {
  // ... fetch current ticker price ...
});
```

**Why Redis-backed:**
- Livermore already uses ioredis cluster for pub/sub and caching (no new connection)
- `@fastify/rate-limit` supports ioredis directly (native integration)
- Distributed rate limiting: if you run multiple API instances, limits are enforced across all instances (no per-instance bypass)
- `skipOnError: true` ensures API stays available if Redis is temporarily down (fail open, not fail closed)

**Confidence:** HIGH — @fastify/rate-limit is official plugin with ioredis support verified in v10.3.0 release notes.

### 4. Runtime Mode Flag (Headless Mode)

**Goal:** Run Fastify without calling `listen()` for testing (use `fastify.inject()`) and serverless environments (AWS Lambda, Vercel).

```typescript
// apps/api/src/server.ts
const RUNTIME_MODE = process.env.RUNTIME_MODE || 'http'; // 'http' or 'headless'

async function start() {
  const fastify = Fastify({ logger: false });

  // Register all plugins and routes (same code path for both modes)
  await registerPlugins(fastify);
  await registerPublicApiRoutes(fastify);
  await registerTrpcRouter(fastify);
  await registerWebSocketRoutes(fastify);

  if (RUNTIME_MODE === 'http') {
    // Normal mode: start HTTP server and listen on port
    const port = config.API_PORT;
    const host = config.API_HOST;
    await fastify.listen({ port, host });
    logger.info(`HTTP server listening on ${host}:${port}`);
  } else {
    // Headless mode: don't listen, just return configured Fastify instance
    logger.info('Running in HEADLESS mode (no HTTP server)');
    return fastify; // Can be used for testing or serverless environments
  }
}

// Export for testing
export { start };
```

**Testing with headless mode:**

```typescript
// apps/api/src/__tests__/candles.test.ts
import { start } from '../server';

describe('Candles API', () => {
  let fastify;

  beforeAll(async () => {
    process.env.RUNTIME_MODE = 'headless';
    fastify = await start();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should return candles for a symbol', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/candles?symbol=BTC-USD&timeframe=1h&limit=10',
      headers: {
        authorization: 'Bearer test-api-key-123'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(10);
  });
});
```

**Why this approach:**
- Fastify supports running without `listen()` out of the box (no special configuration)
- `fastify.inject()` feeds mocked requests straight into the router (no sockets, no network latency)
- Same router/middleware for multiple entry points (HTTP, message queue consumers, serverless)
- Environment variable toggle (no code changes between modes)

**Use cases:**
- **Testing:** Use `fastify.inject()` for fast, isolated unit tests
- **Serverless (AWS Lambda):** Export handler function instead of calling `listen()`
- **Shared logic:** Same Fastify app for HTTP API and background workers

**Confidence:** HIGH — Fastify's serverless guide explicitly recommends this pattern.

### 5. WebSocket Bridge (Already Implemented)

**Current implementation:** You already have the bridge pattern in `apps/api/src/server.ts` lines 48-103:

```typescript
// Existing pattern (lines 48-103)
const alertClients = new Set<WebSocket>();
const candlePulseClients = new Set<WebSocket>();

export function broadcastCandlePulse(pulse: { exchangeId, symbol, timeframe, timestamp }) {
  const message = JSON.stringify({ type: 'candle_pulse', data: pulse });
  for (const client of candlePulseClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  }
}

// WebSocket route for candle pulse notifications
fastify.get('/ws/candle-pulse', { websocket: true }, (socket) => {
  candlePulseClients.add(socket);
  logger.info({ clientCount: candlePulseClients.size }, 'Candle pulse WebSocket client connected');

  socket.on('close', () => {
    candlePulseClients.delete(socket);
  });

  socket.on('error', (error) => {
    logger.error({ error }, 'Candle pulse WebSocket error');
    candlePulseClients.delete(socket);
  });
});
```

**Extend this for public API with authentication:**

```typescript
// apps/api/src/routes/websocket/market-data.ts
import { getDbClient } from '@livermore/database';
import { eq } from 'drizzle-orm';
import { users } from '@livermore/database/schema';

const marketDataClients = new Set<WebSocket>();

fastify.get('/ws/market-data', { websocket: true }, async (socket, request) => {
  // Authenticate via query parameter: /ws/market-data?api_key=xxx
  const apiKey = request.query.api_key;
  if (!apiKey) {
    socket.close(1008, 'Missing API key'); // 1008 = Policy Violation
    return;
  }

  const db = getDbClient();
  const user = await db.query.users.findFirst({
    where: eq(users.apiKey, apiKey as string),
    columns: { id: true }
  });

  if (!user) {
    socket.close(1008, 'Invalid API key');
    return;
  }

  // Authenticated — add to client set
  marketDataClients.add(socket);
  logger.info({ clientCount: marketDataClients.size }, 'Market data WebSocket client connected');

  socket.on('close', () => {
    marketDataClients.delete(socket);
  });

  socket.on('error', (error) => {
    logger.error({ error }, 'Market data WebSocket error');
    marketDataClients.delete(socket);
  });
});

// Broadcast sanitized events (no MACD-V details)
export function broadcastMarketData(event: {
  type: 'candle_close' | 'trade_signal';
  data: Record<string, unknown>;
}) {
  const message = JSON.stringify(event);
  for (const client of marketDataClients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}
```

**Why no new libraries:**
- `@fastify/websocket ^11.0.1` already installed and working
- Bridge pattern (Set + Redis pub/sub → broadcast) already implemented for `/ws/alerts`
- Authentication via query parameter is standard WebSocket pattern
- WebSocket close code 1008 (Policy Violation) is appropriate for auth failures

**Confidence:** HIGH — pattern already validated in production for `/ws/alerts` and `/ws/candle-pulse`.

### 6. AsyncAPI Documentation

**Goal:** Document WebSocket event streams in a machine-readable format (like OpenAPI for REST, but for WebSockets).

**Create AsyncAPI spec:**

```yaml
# asyncapi.yaml (root of project)
asyncapi: 3.1.0
info:
  title: Perseus Web WebSocket API
  version: 8.0.0
  description: Real-time cryptocurrency market data and trade signal events

servers:
  development:
    host: ws://localhost:3000
    protocol: ws
    description: Local development server
  production:
    host: wss://api.livermore.io
    protocol: ws
    description: Production WebSocket server (TLS required)

channels:
  market_data:
    address: /ws/market-data?api_key={apiKey}
    messages:
      candle_close:
        summary: Candle closed event
        description: Emitted when a candle completes for a symbol/timeframe pair
        payload:
          type: object
          required: [type, data]
          properties:
            type:
              type: string
              const: candle_close
            data:
              type: object
              required: [exchangeId, symbol, timeframe, timestamp, close, volume]
              properties:
                exchangeId:
                  type: integer
                  description: Exchange ID (1 = Coinbase, 2 = Binance, etc.)
                symbol:
                  type: string
                  description: Trading pair (e.g., BTC-USD)
                  example: BTC-USD
                timeframe:
                  type: string
                  enum: [1m, 5m, 15m, 1h, 4h, 1d]
                  description: Candle timeframe
                timestamp:
                  type: integer
                  description: Candle close time (Unix timestamp in milliseconds)
                close:
                  type: number
                  description: Closing price
                volume:
                  type: number
                  description: Trading volume

      trade_signal:
        summary: Trade signal triggered
        description: Emitted when a trading signal is triggered for a symbol
        payload:
          type: object
          required: [type, data]
          properties:
            type:
              type: string
              const: trade_signal
            data:
              type: object
              required: [symbol, signalType, timeframe, triggeredAt]
              properties:
                symbol:
                  type: string
                  description: Trading pair
                  example: ETH-USD
                signalType:
                  type: string
                  enum: [bullish, bearish]
                  description: Signal direction (MACD-V details are proprietary and not exposed)
                timeframe:
                  type: string
                  enum: [1m, 5m, 15m, 1h, 4h, 1d]
                  description: Timeframe on which signal was triggered
                triggeredAt:
                  type: string
                  format: date-time
                  description: ISO 8601 timestamp of signal trigger
                price:
                  type: number
                  description: Asset price at trigger time
```

**Generate HTML documentation:**

```json
// package.json scripts
{
  "scripts": {
    "docs:asyncapi": "asyncapi generate fromTemplate asyncapi.yaml @asyncapi/html-template --output docs/asyncapi",
    "docs:asyncapi:watch": "asyncapi generate fromTemplate asyncapi.yaml @asyncapi/html-template --output docs/asyncapi --watch"
  }
}
```

**Serve generated docs:**

```bash
pnpm docs:asyncapi  # Generates docs/asyncapi/index.html
# Serve at https://livermore.io/asyncapi/ (static hosting)
```

**Why AsyncAPI:**
- Industry standard for documenting event-driven APIs (like OpenAPI for REST)
- Machine-readable (tools can generate client SDKs, validators, mocks)
- Human-readable (generates interactive HTML documentation)
- Supports WebSocket bindings (query parameters, connection lifecycle)
- Latest version (3.1.0, Feb 2026) adds improved WebSocket support

**Confidence:** HIGH — AsyncAPI 3.1.0 released Jan 2026, WebSocket bindings are well-documented.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **fastify-type-provider-zod** | zod-to-openapi (asteasolutions) | If NOT using Fastify or need framework-agnostic OpenAPI generation. For Fastify apps, type provider has tighter integration (compilers + transform in one package). |
| **@fastify/bearer-auth** | Custom preHandler hook | If you need more complex auth logic (e.g., JWT parsing + claims validation, role-based access control). For simple API key validation, bearer-auth is faster and battle-tested. |
| **@fastify/rate-limit** | rate-limit-redis (standalone) | If NOT using Fastify. Since you're on Fastify, use the official plugin for lifecycle integration and per-route config. |
| **Runtime mode via env var** | Separate entry points (server.ts vs serverless.ts) | If HTTP and serverless have fundamentally different initialization (different plugins, different routes). Here they're identical except `listen()` call, so env var is cleaner. |
| **@asyncapi/generator** | Manual AsyncAPI YAML + Redocly | If you want custom branding/styling beyond the HTML template. Generator is faster for standard docs. AsyncAPI Studio (online editor) can also preview specs. |
| **WebSocket auth via query param** | WebSocket auth via Sec-WebSocket-Protocol header | If you need to hide API key from URL logs (query params are logged by proxies). However, WebSocket protocol headers are complex to implement. Query param is simpler and standard. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **fastify-swagger (deprecated)** | Deprecated in favor of @fastify/swagger. Old package (pre-v8) is no longer maintained. Breaking changes in v8+ require Fastify 5.x. | **@fastify/swagger@^9.7.0** |
| **fastify-rate-limit (deprecated)** | Deprecated in favor of @fastify/rate-limit. Old package (v5.9.0) has security vulnerabilities and no cluster support. | **@fastify/rate-limit@^10.3.0** |
| **Socket.io** | Heavy abstraction over WebSockets with custom protocol (fallback to long-polling, rooms, namespaces). PW client expects standard WebSocket protocol. Already using `ws` library via @fastify/websocket. Adds ~60KB min bundle size. | **@fastify/websocket (already installed)** |
| **fastify-openapi-glue** | Design-first approach (OpenAPI spec → code generation). Livermore is code-first (Zod schemas → OpenAPI spec). Incompatible workflow. Requires maintaining separate YAML files. | **fastify-type-provider-zod** |
| **@fastify/jwt** | For issuing/verifying JWTs (JSON Web Tokens). You need API key validation (simple string lookup), not JWT generation. Clerk already handles JWTs for admin UI. | **@fastify/bearer-auth** |
| **Swagger Codegen** | Generates server stubs from OpenAPI spec (design-first). You're doing code-first (routes → spec). Generates bloated code with unused abstractions. | **Write routes manually, use fastify-type-provider-zod for spec generation** |
| **Redis pub/sub for rate limiting** | Custom implementation using pub/sub to share rate limit counters. Reinventing the wheel — @fastify/rate-limit already does this with ioredis support. | **@fastify/rate-limit with redis option** |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| **@fastify/swagger@^9.7.0** | Fastify ^5.x | Breaking change: v9.x REQUIRES Fastify 5.x. You're on 5.2.2 — compatible. v8.x supported Fastify 4.x (migration guide available). |
| **fastify-type-provider-zod@^4.0.2** | Zod ^3.x, Fastify ^4.x / ^5.x | You're on Zod 3.25.76 and Fastify 5.2.2 — both compatible. v4.x added support for @fastify/swagger v9.x. |
| **@fastify/rate-limit@^10.3.0** | Fastify ^5.x, ioredis ^5.x | You're on Fastify 5.2.2 and ioredis 5.4.2 — compatible. Cluster mode supported (no special config needed, ioredis handles it). |
| **@fastify/bearer-auth@^10.1.1** | Fastify ^5.x | Requires Fastify 5.x. You're on 5.2.2 — compatible. v10.x adds TypeScript improvements and async validator support. |
| **@fastify/websocket@^11.0.1** | Fastify ^5.x, ws ^8.x | Already installed. You're on Fastify 5.2.2 — compatible. Wraps `ws` library with Fastify lifecycle integration. |

**No version conflicts.** All new packages are compatible with current stack (Fastify 5.2.2, Zod 3.25.76, ioredis 5.4.2).

---

## Configuration Checklist

**Before deploying public API to production:**

- [ ] **Database:** Add `users.api_key` column (varchar(64), unique, indexed) + migration
- [ ] **API key generation:** Add tRPC mutation `generateApiKey()` in user settings
- [ ] **API key display:** Add UI in admin panel to show/copy/regenerate API key
- [ ] **Rate limits:** Configure per-route limits (e.g., `/candles` = 60/min, `/signals` = 10/min)
- [ ] **CORS:** Replace `origin: true` with whitelist of allowed domains (or keep `true` for public API)
- [ ] **OpenAPI spec:** Verify generated spec at `/docs/json` (or `/docs/yaml`) before release
- [ ] **Swagger UI:** Test "Try it out" functionality with real API key
- [ ] **AsyncAPI:** Generate and host HTML docs at public URL (e.g., `https://livermore.io/asyncapi/`)
- [ ] **WebSocket auth:** Test connection with valid/invalid API keys
- [ ] **Runtime mode:** Add `RUNTIME_MODE` to `.env.example` with default `http`
- [ ] **Sanitization:** Verify MACD-V internals are NOT exposed in public endpoints (audit payloads)
- [ ] **Logging:** Ensure API key is NOT logged in plaintext (mask in logs: `xxx...xxx`)
- [ ] **Security headers:** Add `@fastify/helmet` for production (HSTS, CSP, etc.)
- [ ] **TLS:** Enforce HTTPS in production (redirect HTTP → HTTPS, WebSocket → WSS)

---

## Security Boundaries

**Public API MUST NOT expose:**

| Proprietary IP / PII | Why | Enforcement |
|---------------------|-----|-------------|
| **MACD-V formula or parameters** | Proprietary indicator logic is trade secret. Exposing EMA periods, multipliers, or formula allows competitors to replicate. | Return generic "trade signals" (bullish/bearish enum) with NO numeric indicator values. |
| **Indicator calculation internals** | Redis key patterns, calculation sequence, warmup logic reveal system architecture. | Public API routes fetch from Redis but never expose keys or implementation details. |
| **Admin-only endpoints** | User management, system stats, instance registry, control channels are internal tooling. | Admin endpoints stay on `/trpc` prefix (Clerk auth). Public API is `/api/v1` prefix (API key auth). |
| **Clerk user IDs or emails** | PII must not leak to external clients. API keys are user-scoped but don't reveal user identity. | Public API responses contain NO user-identifying fields. |
| **Raw alert trigger values** | signalDelta, triggerValue reveal MACD-V thresholds. | Transform alerts: `{ signalType: 'bullish', price: 50000 }` instead of `{ signalDelta: 0.0045, triggerValue: 0.003 }`. |

**Public API SHOULD expose:**

| Safe to Expose | Why | Implementation |
|---------------|-----|----------------|
| **Generic trade signals** | High-level directional signals (bullish/bearish) have value without revealing IP. | Alert service emits sanitized events to public WebSocket channel. |
| **Candle data (OHLCV)** | Public market data, available from exchange APIs. | Fetch from Redis cache (`candles:{exchangeId}:{symbol}:{timeframe}`). |
| **Ticker data** | Current price, 24h volume, 24h change are public market data. | Fetch from Redis cache (`ticker:{exchangeId}:{symbol}`). |
| **Exchange status** | Online/offline, connection state are operational metadata. | Expose via `/api/v1/status` endpoint (from instance registry). |
| **Supported symbols** | List of monitored trading pairs is useful for API discovery. | Expose via `/api/v1/symbols` endpoint (from runtime state). |

**Implementation:** Create separate route handlers in `apps/api/src/routes/public/` that explicitly sanitize data before returning. Never reuse internal tRPC procedures directly (they may leak sensitive fields).

---

## Sources

### Official Documentation (HIGH Confidence)

- [@fastify/swagger npm](https://www.npmjs.com/package/@fastify/swagger) — Version 9.7.0 published Feb 15, 2026
- [GitHub: fastify/fastify-swagger](https://github.com/fastify/fastify-swagger) — Official Fastify ecosystem plugin, 300+ contributors
- [@fastify/rate-limit GitHub](https://github.com/fastify/fastify-rate-limit) — Redis integration verified in v10.3.0 release notes (Jan 2026)
- [fastify-type-provider-zod GitHub](https://github.com/turkerdev/fastify-type-provider-zod) — Zod to OpenAPI transformation, supports @fastify/swagger v9.x
- [@fastify/bearer-auth GitHub](https://github.com/fastify/fastify-bearer-auth) — API key authentication with constant-time comparison, v10.1.1 (Dec 2025)
- [AsyncAPI Specification 3.1.0](https://www.asyncapi.com/docs/reference/specification/v3.1.0) — WebSocket bindings, query parameter auth (Jan 2026)
- [Fastify Serverless Guide](https://fastify.dev/docs/latest/Guides/Serverless/) — Runtime mode without `listen()`, Lambda integration

### Integration Guides (MEDIUM Confidence)

- [How To Generate an OpenAPI Spec With Fastify | Speakeasy](https://www.speakeasy.com/openapi/frameworks/fastify) — Fastify + OpenAPI workflow, last updated Jan 22, 2026
- [Build Well-Documented and Authenticated APIs in Node.js with Fastify | Heroku](https://www.heroku.com/blog/build-openapi-apis-nodejs-fastify/) — Bearer auth + OpenAPI security schemes integration
- [Creating AsyncAPI for WebSocket API | AsyncAPI Initiative](https://www.asyncapi.com/blog/websocket-part2) — WebSocket documentation patterns, query param auth
- [fastify-zod-openapi vs zod-to-openapi comparison](https://github.com/samchungy/fastify-zod-openapi) — When to use framework-specific vs agnostic libraries

### Verified Against Installed Packages

- **Fastify:** 5.2.2 (apps/api/package.json line 30) — v9.x plugins require ^5.x ✓
- **Zod:** 3.25.76 (apps/api/package.json line 32) — fastify-type-provider-zod requires ^3.x ✓
- **ioredis:** 5.4.2 (root package.json line 42, pinned override) — @fastify/rate-limit requires ^5.x ✓
- **@fastify/websocket:** 11.0.1 (apps/api/package.json line 17) — Already using ws library bridge ✓

---

**Stack Research for:** Perseus Web Public API
**Researched:** 2026-02-18
**Next Steps:** Create `.planning/research/FEATURES.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/SUMMARY.md`
