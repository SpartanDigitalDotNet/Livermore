# Architecture Research: Public API Integration

**Domain:** Public REST API + OpenAPI + WebSocket bridge for trading platform
**Researched:** 2026-02-18
**Confidence:** HIGH

## Executive Summary

This architecture research addresses how to integrate public REST API routes with OpenAPI specification, WebSocket pub/sub bridge, and runtime mode switching into the existing Livermore trading platform. The platform currently uses Fastify + tRPC for admin-only access with Clerk authentication, Redis pub/sub for internal event distribution, and a single "exchange" runtime mode that connects to exchanges and serves API requests.

v8.0 "Perseus Web" adds public `/public/v1/*` REST routes alongside existing tRPC routes, a WebSocket bridge for external clients to consume Redis pub/sub events, and a "pw-host" (headless) runtime mode where instances serve API requests without connecting to exchanges. The architecture maintains the existing stack (Fastify 5.x, ioredis 5.4.2, tRPC 11.x) with two new libraries: `@trpc/server` with trpc-openapi for OpenAPI generation, and `fastify-zod-openapi` for schema-driven route registration.

**Key architectural decisions:**
- Public REST routes registered via `fastify-zod-openapi` plugin, coexist with tRPC at different path prefixes (`/public/v1/*` vs `/trpc/*`)
- OpenAPI spec generated from Zod schemas using `zod-openapi` library with `.openapi()` metadata decorators
- WebSocket bridge (`/public/ws/market-data`) as separate Fastify WebSocket route that subscribes to Redis pub/sub and fans out to N external clients
- Runtime mode controlled by `RUNTIME_MODE` env var (`exchange` | `pw-host`), determines which services start
- Data transformation layer via DTO pattern: internal schemas → public schemas, strips proprietary fields (indicator formulas, internal IDs)
- All public API code in new `packages/public-api` package with public schemas in `packages/schemas/src/public/`

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Clients                             │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│   │ HTTP Clients │  │ WebSocket    │  │  Admin UI    │             │
│   │ (REST API)   │  │ Subscribers  │  │  (tRPC)      │             │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
└──────────┼──────────────────┼──────────────────┼────────────────────┘
           │                  │                  │
           │                  │                  │
┌──────────┼──────────────────┼──────────────────┼────────────────────┐
│          │  Fastify Server (apps/api)          │                    │
│          │                  │                  │                    │
│   ┌──────▼──────┐  ┌────────▼────────┐  ┌──────▼──────┐            │
│   │  Public API │  │  WebSocket      │  │   tRPC      │            │
│   │  Routes     │  │  Bridge         │  │   Router    │            │
│   │ /public/v1/*│  │ /public/ws/*    │  │  /trpc/*    │            │
│   └──────┬──────┘  └────────┬────────┘  └──────┬──────┘            │
│          │                  │                  │                    │
│   ┌──────▼──────────────────▼──────────────────▼──────┐            │
│   │          Data Transformation Layer                 │            │
│   │  (DTOs: Internal Schemas → Public Schemas)         │            │
│   └──────┬──────────────────┬──────────────────┬──────┘            │
│          │                  │                  │                    │
├──────────┼──────────────────┼──────────────────┼────────────────────┤
│          │  Service Layer (Runtime Mode Switch)         │           │
│          │                  │                  │                    │
│   ┏━━━━━━▼━━━━━━━━━━━━━━━━━▼━━━━━━━━━━━━━━━━━▼━━━━━━┓            │
│   ┃  IF RUNTIME_MODE=exchange:                        ┃            │
│   ┃  ┌────────────────┐  ┌─────────────────┐          ┃            │
│   ┃  │  Exchange      │  │  Indicator      │          ┃            │
│   ┃  │  Adapters      │  │  Calculation    │          ┃            │
│   ┃  │  (WS Ingest)   │  │  Service        │          ┃            │
│   ┃  └────────┬───────┘  └────────┬────────┘          ┃            │
│   ┗━━━━━━━━━━━┼━━━━━━━━━━━━━━━━━━┼━━━━━━━━━━━━━━━━━━━┛            │
│               │                   │                                 │
│   ┏━━━━━━━━━━━▼━━━━━━━━━━━━━━━━━▼━━━━━━━━━━━━━━━━━━━┓            │
│   ┃  IF RUNTIME_MODE=pw-host:                         ┃            │
│   ┃  (Exchange adapters NOT started)                  ┃            │
│   ┃  (Read-only access to cached data)                ┃            │
│   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛            │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                      Data Layer                                      │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│   │  PostgreSQL  │  │  Redis       │  │  Redis       │             │
│   │  (Drizzle)   │  │  (Cache)     │  │  (Pub/Sub)   │             │
│   └──────────────┘  └──────────────┘  └──────────────┘             │
└──────────────────────────────────────────────────────────────────────┘

Data Flow:
  Exchange Mode:    Exchange WS → Redis Cache → Pub/Sub → WS Bridge → External Clients
  PW-Host Mode:     (No exchange ingest) → Redis Cache (read-only) → Public API → Clients
```

## Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Public API Routes** | Expose REST endpoints for market data, candles, indicators | `packages/public-api/src/routes/` with Fastify route handlers, registered via `fastify-zod-openapi` |
| **OpenAPI Generator** | Generate OpenAPI v3 spec from Zod schemas | `zod-openapi` library with `.openapi()` metadata on schemas, spec served at `/public/v1/openapi.json` |
| **WebSocket Bridge** | Subscribe to Redis pub/sub, fan out to N external clients | Fastify WebSocket route at `/public/ws/market-data`, manages client Set, handles backpressure |
| **Data Transformation Layer** | Transform internal schemas to public schemas, strip proprietary data | DTO functions in `packages/public-api/src/transformers/`, map internal → public |
| **Runtime Mode Manager** | Control which services start based on env var | Conditional service initialization in `apps/api/src/server.ts`, checks `RUNTIME_MODE` |
| **Public Schema Package** | Define public-facing Zod schemas for API contracts | `packages/schemas/src/public/` with OpenAPI metadata, separate from internal schemas |
| **Rate Limiting Middleware** | Protect public endpoints from abuse | Fastify rate-limit plugin, applied selectively to `/public/*` routes |

## Recommended Project Structure

```
apps/
├── api/
│   ├── src/
│   │   ├── server.ts                  # [MODIFIED] Add runtime mode switch
│   │   ├── routers/                   # Existing tRPC routers (unchanged)
│   │   └── services/                  # Existing services (unchanged)

packages/
├── public-api/                         # [NEW] Public API package
│   ├── src/
│   │   ├── routes/
│   │   │   ├── candles.route.ts       # GET /public/v1/candles/:symbol
│   │   │   ├── indicators.route.ts    # GET /public/v1/indicators/:symbol
│   │   │   ├── symbols.route.ts       # GET /public/v1/symbols
│   │   │   └── index.ts               # Route registration function
│   │   ├── websocket/
│   │   │   ├── market-data-bridge.ts  # WebSocket bridge for Redis pub/sub
│   │   │   └── backpressure.ts        # Backpressure handling utilities
│   │   ├── transformers/
│   │   │   ├── candle.transformer.ts  # Internal Candle → Public Candle
│   │   │   ├── indicator.transformer.ts # Strip proprietary fields
│   │   │   └── index.ts
│   │   ├── middleware/
│   │   │   ├── rate-limit.ts          # Rate limiting config
│   │   │   └── error-handler.ts       # Public error responses
│   │   └── index.ts                   # Package exports
│   └── package.json

├── schemas/
│   ├── src/
│   │   ├── public/                     # [NEW] Public API schemas
│   │   │   ├── candle.schema.ts       # Public candle schema with .openapi()
│   │   │   ├── indicator.schema.ts    # Public indicator schema (no formulas)
│   │   │   ├── symbol.schema.ts       # Public symbol metadata
│   │   │   ├── websocket.schema.ts    # WebSocket message schemas
│   │   │   └── index.ts
│   │   ├── market/                     # Existing internal schemas
│   │   ├── indicators/                 # Existing internal schemas
│   │   └── index.ts                   # [MODIFIED] Export public schemas

├── cache/                              # Existing (unchanged)
├── database/                           # Existing (unchanged)
├── utils/                              # [MODIFIED] Add runtime mode utilities
│   ├── src/
│   │   ├── runtime-mode.ts            # Runtime mode detection, validation
│   │   └── index.ts
```

### Structure Rationale

- **`packages/public-api/`**: Isolates all public-facing API code from internal admin tRPC routes. Follows monorepo best practice: public API is a separate bounded context with its own entry point. Prevents accidental import of internal schemas into public routes.

- **`packages/schemas/src/public/`**: Public schemas live alongside internal schemas but in separate directory. Allows shared base types (e.g., `Timeframe`) while preventing leakage of proprietary fields. OpenAPI metadata (`.openapi()`) only added to public schemas.

- **`apps/api/src/server.ts` modifications**: Runtime mode switch implemented in single location at startup. Clean separation: `if (mode === 'exchange')` starts exchange adapters, `if (mode === 'pw-host')` skips them. Public API routes registered unconditionally (work in both modes).

## Architectural Patterns

### Pattern 1: Coexisting REST + tRPC Routes

**What:** Register both tRPC plugin and REST routes on the same Fastify instance at different path prefixes.

**When to use:** When adding public REST API to existing tRPC-based admin application.

**Trade-offs:**
- **Pro:** No separate server process, shared Fastify plugins (CORS, WebSocket, rate limiting)
- **Pro:** tRPC and REST share same database/Redis connections, service instances
- **Con:** Single process means public load can impact admin UI performance (mitigate with separate pw-host instances)

**Example:**
```typescript
// apps/api/src/server.ts
import { registerPublicRoutes } from '@livermore/public-api';

const fastify = Fastify();

// Register tRPC for admin (existing)
await fastify.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: { router: appRouter, createContext },
});

// Register public REST routes (new)
await fastify.register(async (instance) => {
  await instance.register(fastifyZodOpenApi, {
    openapi: {
      info: { title: 'Livermore Public API', version: '1.0.0' },
      servers: [{ url: 'https://api.livermore.trade' }],
    },
  });

  // Register all public routes
  await registerPublicRoutes(instance, { redis, db });
});

// Serve OpenAPI spec
fastify.get('/public/v1/openapi.json', async () => {
  return fastify.openapiDocument;
});
```

### Pattern 2: OpenAPI Generation from Zod Schemas

**What:** Use `zod-openapi` to add OpenAPI metadata to Zod schemas, generate spec automatically.

**When to use:** When you want single source of truth for validation AND documentation.

**Trade-offs:**
- **Pro:** Runtime validation and API docs stay in sync automatically
- **Pro:** TypeScript types inferred from same schema (validation + types + docs from one definition)
- **Con:** OpenAPI metadata decorators add verbosity to schema definitions
- **Con:** Not all Zod features map cleanly to OpenAPI (e.g., `.transform()`, `.refine()`)

**Example:**
```typescript
// packages/schemas/src/public/candle.schema.ts
import { z } from 'zod';
import { extendZodWithOpenApi } from 'zod-openapi';

extendZodWithOpenApi(z);

export const PublicCandleSchema = z.object({
  symbol: z.string().openapi({
    example: 'BTC-USD',
    description: 'Trading pair symbol'
  }),
  timestamp: z.number().int().positive().openapi({
    example: 1708291200000,
    description: 'Candle open time (Unix milliseconds)'
  }),
  open: z.number().positive().openapi({ example: 50123.45 }),
  high: z.number().positive().openapi({ example: 50250.00 }),
  low: z.number().positive().openapi({ example: 50050.00 }),
  close: z.number().positive().openapi({ example: 50200.00 }),
  volume: z.number().nonnegative().openapi({ example: 123.456 }),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).openapi({
    description: 'Candle duration'
  }),
}).openapi('Candle');

// Route definition with OpenAPI metadata
export const getCandlesRoute = {
  method: 'GET' as const,
  url: '/public/v1/candles/:symbol',
  schema: {
    params: z.object({
      symbol: z.string().openapi({ example: 'BTC-USD' }),
    }),
    querystring: z.object({
      timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    response: {
      200: z.array(PublicCandleSchema),
    },
  },
};
```

### Pattern 3: Redis Pub/Sub to WebSocket Fan-Out with Backpressure

**What:** Subscribe to Redis pub/sub channels, broadcast to N WebSocket clients, handle backpressure when clients can't keep up.

**When to use:** When external clients need real-time updates from internal pub/sub events.

**Trade-offs:**
- **Pro:** Decouples external clients from internal architecture (they don't need Redis access)
- **Pro:** WebSocket bridge can run on multiple pw-host instances behind load balancer
- **Con:** Memory pressure from buffering messages for slow clients
- **Con:** Requires backpressure handling (pause client, drop messages, or disconnect)

**Example:**
```typescript
// packages/public-api/src/websocket/market-data-bridge.ts
import type { RedisClient } from '@livermore/cache';
import type { WebSocket } from 'ws';

interface BridgeClient {
  socket: WebSocket;
  subscribedChannels: Set<string>;
  isPaused: boolean;
  bufferSize: number;
}

const MAX_BUFFER_SIZE = 100; // Max queued messages per client

export class MarketDataBridge {
  private clients = new Map<WebSocket, BridgeClient>();
  private subscriberRedis: RedisClient;

  constructor(subscriberRedis: RedisClient) {
    this.subscriberRedis = subscriberRedis;

    // Subscribe to all candle close events (pattern subscription)
    this.subscriberRedis.psubscribe('channel:candle:close:*', (err) => {
      if (err) throw err;
    });

    // Handle incoming pub/sub messages
    this.subscriberRedis.on('pmessage', (pattern, channel, message) => {
      this.fanOutMessage(channel, message);
    });
  }

  addClient(socket: WebSocket, subscriptions: string[]): void {
    const client: BridgeClient = {
      socket,
      subscribedChannels: new Set(subscriptions),
      isPaused: false,
      bufferSize: 0,
    };

    this.clients.set(socket, client);

    // Handle backpressure: pause when buffer fills
    socket.on('drain', () => {
      client.isPaused = false;
      client.bufferSize = 0;
    });

    socket.on('close', () => {
      this.clients.delete(socket);
    });
  }

  private fanOutMessage(channel: string, message: string): void {
    // Transform internal event to public format
    const publicMessage = this.transformToPublicFormat(channel, message);

    for (const [socket, client] of this.clients) {
      // Check if client subscribed to this channel
      if (!this.matchesSubscription(channel, client.subscribedChannels)) {
        continue;
      }

      // Skip if socket not ready
      if (socket.readyState !== 1) continue; // WebSocket.OPEN

      // Backpressure handling
      if (client.isPaused || client.bufferSize >= MAX_BUFFER_SIZE) {
        // Option 1: Drop message (for high-frequency data)
        continue;

        // Option 2: Disconnect slow client (uncomment to enable)
        // socket.close(1008, 'Client too slow');
        // continue;
      }

      // Send message
      const success = socket.send(publicMessage);

      // Track buffer if send returned false (TCP buffer full)
      if (success === false) {
        client.isPaused = true;
        client.bufferSize++;
      }
    }
  }

  private transformToPublicFormat(channel: string, message: string): string {
    // Parse internal event, transform to public schema
    const event = JSON.parse(message);

    // Example: strip internal fields
    const publicEvent = {
      type: 'candle_close',
      data: {
        symbol: event.symbol,
        timestamp: event.timestamp,
        // ... public fields only
      },
    };

    return JSON.stringify(publicEvent);
  }

  private matchesSubscription(channel: string, subscriptions: Set<string>): boolean {
    // Example: client subscribes to "BTC-USD:1h", channel is "channel:candle:close:BTC-USD:1h"
    for (const sub of subscriptions) {
      if (channel.includes(sub)) return true;
    }
    return false;
  }
}
```

### Pattern 4: Runtime Mode Switching

**What:** Control which services start at runtime based on environment variable, without separate codebases.

**When to use:** When you need different startup behavior (exchange ingest vs API-only) from same binary.

**Trade-offs:**
- **Pro:** Single codebase, easier deployments, shared bug fixes
- **Pro:** Can test both modes locally without separate builds
- **Con:** Conditional logic in startup sequence increases complexity
- **Con:** Easy to accidentally start wrong services if mode detection breaks

**Example:**
```typescript
// packages/utils/src/runtime-mode.ts
export type RuntimeMode = 'exchange' | 'pw-host';

export function getRuntimeMode(): RuntimeMode {
  const mode = process.env.RUNTIME_MODE?.toLowerCase();

  if (mode === 'pw-host') return 'pw-host';
  if (mode === 'exchange') return 'exchange';

  // Default to exchange for backward compatibility
  return 'exchange';
}

export function validateRuntimeMode(mode: RuntimeMode, config: EnvConfig): void {
  if (mode === 'exchange') {
    // Exchange mode requires API credentials
    if (!config.Coinbase_ApiKeyId || !config.Coinbase_EcPrivateKeyPem) {
      throw new Error('RUNTIME_MODE=exchange requires Coinbase API credentials');
    }
  }

  if (mode === 'pw-host') {
    // PW-Host mode requires Redis but NOT exchange credentials
    if (!config.LIVERMORE_REDIS_URL) {
      throw new Error('RUNTIME_MODE=pw-host requires Redis connection');
    }
  }
}

// apps/api/src/server.ts
import { getRuntimeMode, validateRuntimeMode } from '@livermore/utils';

async function start() {
  const config = validateEnv();
  const runtimeMode = getRuntimeMode();

  validateRuntimeMode(runtimeMode, config);

  logger.info({ runtimeMode }, 'Starting Livermore API server');

  // ... Fastify setup, Redis connection, database connection ...

  // ============================================
  // RUNTIME MODE SWITCH
  // ============================================

  if (runtimeMode === 'exchange') {
    // Start exchange adapters, indicator service, alert service
    logger.info('Starting EXCHANGE mode: ingesting live data');

    const exchangeAdapter = await adapterFactory.create(1); // Coinbase
    await exchangeAdapter.connect();
    exchangeAdapter.subscribe(monitoredSymbols, '5m');

    await indicatorService.start(indicatorConfigs);
    await alertService.start(monitoredSymbols, SUPPORTED_TIMEFRAMES);

  } else if (runtimeMode === 'pw-host') {
    // Skip exchange adapters, read-only cached data
    logger.info('Starting PW-HOST mode: serving cached data only');

    // Exchange adapters NOT started
    // Indicator service NOT started (no new calculations)
    // Alert service NOT started

    // Services still available:
    // - Public API routes (read from Redis cache)
    // - WebSocket bridge (relay existing pub/sub)
    // - Database queries (symbols, positions)
  }

  // Public API routes registered regardless of mode
  await registerPublicRoutes(fastify, { redis, db, mode: runtimeMode });

  // Start server
  await fastify.listen({ port, host });
}
```

### Pattern 5: Data Transformation Layer (DTO Pattern)

**What:** Transform internal database/cache schemas to public API schemas, stripping proprietary fields.

**When to use:** When internal data model contains sensitive information that shouldn't be exposed publicly.

**Trade-offs:**
- **Pro:** Prevents accidental leakage of internal IDs, formulas, user data
- **Pro:** Decouples public API from internal schema changes
- **Con:** Extra mapping code to maintain
- **Con:** Performance overhead from copying/transforming objects (mitigate with Object.assign for simple cases)

**Example:**
```typescript
// packages/schemas/src/indicators/macdv.schema.ts (INTERNAL)
export const MacdVAnalysisSchema = z.object({
  symbol: z.string(),
  timestamp: z.number(),
  macdV: z.number(),
  signal: z.number(),
  histogram: z.number(),
  stage: MacdVStageSchema,
  zone: MacdVZoneSchema,

  // PROPRIETARY FIELDS (internal only)
  fastEMA: z.number(),        // Don't expose formula internals
  slowEMA: z.number(),        // Don't expose formula internals
  atr: z.number(),            // Don't expose normalization factor
  fastPeriod: z.number(),     // Don't expose config
  slowPeriod: z.number(),     // Don't expose config
  signalPeriod: z.number(),   // Don't expose config
  userId: z.number(),         // Don't expose internal user ID
});

// packages/schemas/src/public/indicator.schema.ts (PUBLIC)
export const PublicMacdVSchema = z.object({
  symbol: z.string().openapi({ example: 'BTC-USD' }),
  timestamp: z.number().int().openapi({ example: 1708291200000 }),
  macdV: z.number().openapi({ example: 45.2 }),
  signal: z.number().openapi({ example: 42.1 }),
  histogram: z.number().openapi({ example: 3.1 }),
  stage: z.enum(['oversold', 'rebounding', 'rallying', 'overbought', 'retracing', 'reversing', 'ranging']).openapi({
    description: 'Momentum phase classification'
  }),
  zone: z.enum(['deep_negative', 'negative', 'neutral', 'positive', 'elevated', 'overbought']).openapi({
    description: 'Value zone for context'
  }),
  // Proprietary fields OMITTED
}).openapi('MacdVIndicator');

// packages/public-api/src/transformers/indicator.transformer.ts
import type { MacdVAnalysis } from '@livermore/schemas';
import type { PublicMacdV } from '@livermore/schemas/public';

export function transformMacdVToPublic(internal: MacdVAnalysis): PublicMacdV {
  // Explicitly pick only public fields (whitelist approach)
  return {
    symbol: internal.symbol,
    timestamp: internal.timestamp,
    macdV: internal.macdV,
    signal: internal.signal,
    histogram: internal.histogram,
    stage: internal.stage,
    zone: internal.zone,
    // fastEMA, slowEMA, atr, userId, etc. NOT included
  };
}

// Validation: ensure no internal fields leak
const result = transformMacdVToPublic(internalData);
PublicMacdVSchema.parse(result); // Throws if internal fields present
```

## Data Flow

### Public API Request Flow (pw-host mode)

```
HTTP GET /public/v1/candles/BTC-USD?timeframe=1h&limit=100
    ↓
Fastify Route Handler
    ↓
Zod Schema Validation (query params)
    ↓
Redis Cache Read (exchangeCandleKey)
    ↓
Data Transformation Layer (Internal Candle → Public Candle)
    ↓
Response (200 OK, JSON array of candles)
```

### WebSocket Bridge Data Flow

```
Exchange Adapter (EXCHANGE mode only)
    ↓ (publishes)
Redis Pub/Sub: channel:candle:close:BTC-USD:1h
    ↓ (psubscribe)
MarketDataBridge.fanOutMessage()
    ↓ (filters by subscription)
Transform to Public Format (strip internal fields)
    ↓ (check backpressure)
WebSocket.send() to N clients
    ↓
External WebSocket Clients
```

### Runtime Mode Decision Flow

```
Server Startup
    ↓
Read RUNTIME_MODE env var
    ↓
┌─────────────────────────────────┐
│ RUNTIME_MODE=exchange?          │
├─────────────────────────────────┤
│ YES → Start Exchange Adapters   │
│       Start Indicator Service   │
│       Start Alert Service       │
│       Connect to Exchange WS    │
├─────────────────────────────────┤
│ NO (pw-host) → Skip all above   │
│                Read from cache  │
└─────────────────────────────────┘
    ↓
Register Public API Routes (both modes)
    ↓
Register tRPC Routes (both modes)
    ↓
Start Fastify Server
```

## Integration Points

### New Components in Existing Architecture

| Component | Type | Where | Integration Point |
|-----------|------|-------|------------------|
| **Public API Routes** | New package | `packages/public-api/` | Registered in `apps/api/src/server.ts` after tRPC |
| **OpenAPI Spec Generator** | Library | `fastify-zod-openapi` | Fastify plugin, generates `/public/v1/openapi.json` |
| **WebSocket Bridge** | New service | `packages/public-api/src/websocket/` | Registered as Fastify WebSocket route |
| **Public Schemas** | New directory | `packages/schemas/src/public/` | Imported by public-api package |
| **Runtime Mode Utilities** | New file | `packages/utils/src/runtime-mode.ts` | Called in `server.ts` startup |
| **DTO Transformers** | New directory | `packages/public-api/src/transformers/` | Called in route handlers before response |

### Modified Components

| Component | File | Change |
|-----------|------|--------|
| **Server Startup** | `apps/api/src/server.ts` | Add runtime mode switch, conditionally start services |
| **Schema Package** | `packages/schemas/src/index.ts` | Export public schemas from `src/public/` |
| **Environment Config** | `packages/schemas/src/env/config.schema.ts` | Add `RUNTIME_MODE` validation |
| **Package Dependencies** | `apps/api/package.json` | Add `fastify-zod-openapi`, `zod-openapi`, `@fastify/rate-limit` |

### External Service Integration

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Redis (Cache)** | Read-only in pw-host mode, read-write in exchange mode | Existing ioredis Cluster connection, no changes |
| **Redis (Pub/Sub)** | WebSocket bridge subscribes via `psubscribe` | Requires dedicated subscriber connection (existing pattern) |
| **PostgreSQL** | Read-only queries for symbols, exchange metadata | Existing Drizzle ORM connection, no changes |
| **External HTTP Clients** | REST API consumers | Load balancer routes to multiple pw-host instances |
| **External WebSocket Clients** | WebSocket bridge subscribers | Sticky sessions recommended (same instance per client) |

### Internal Module Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Public API ↔ Internal Schemas** | Via DTO transformers (one-way) | Public API NEVER imports internal schemas directly |
| **Public API ↔ Redis Cache** | Via `@livermore/cache` package | Uses existing `CandleCacheStrategy`, `IndicatorCacheStrategy` |
| **Public API ↔ Database** | Via `@livermore/database` package | Read-only queries, uses existing Drizzle schemas |
| **WebSocket Bridge ↔ Redis Pub/Sub** | Via dedicated subscriber connection | Reuses existing pub/sub patterns from `IndicatorCalculationService` |
| **tRPC Routes ↔ Public API Routes** | No direct communication | Coexist on same Fastify instance, separate path prefixes |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **0-1K users** | Single instance in exchange mode handles both ingest and public API. WebSocket bridge supports ~100 concurrent connections per instance. No load balancer needed. |
| **1K-10K users** | Add 2-3 pw-host instances behind load balancer for public API. Exchange instance focuses on data ingestion. WebSocket bridge needs sticky sessions (client stays on same instance). Redis pub/sub broadcasts to all instances. |
| **10K-100K users** | Horizontally scale pw-host instances (10-20 instances). Consider Redis Cluster sharding for cache distribution. WebSocket connections limited to ~1K per instance (monitor `ulimit -n`). Rate limiting becomes critical. |
| **100K+ users** | Separate WebSocket bridge into dedicated service (not same process as HTTP API). Consider Redis Streams instead of pub/sub for better replay/fan-out. CDN for OpenAPI spec. Consider GraphQL over REST for complex queries. |

### Scaling Priorities

1. **First bottleneck: WebSocket connections per instance**
   - Each WebSocket holds a file descriptor and memory for buffers
   - Fix: Horizontal scaling with load balancer (round-robin for HTTP, sticky sessions for WS)
   - Monitor: `netstat -an | grep ESTABLISHED | wc -l`, memory usage per client

2. **Second bottleneck: Redis pub/sub fan-out**
   - Each pw-host instance subscribes to same channels, Redis broadcasts to all
   - Fix: Redis Cluster replication, consider Redis Streams for better multi-consumer patterns
   - Monitor: Redis `CLIENT LIST`, pub/sub message rate

3. **Third bottleneck: Rate limiting enforcement**
   - Public API needs per-IP or per-API-key rate limits
   - Fix: Distributed rate limiting via Redis (shared counters across instances)
   - Monitor: 429 response rate, Redis rate-limit key TTL

## Anti-Patterns

### Anti-Pattern 1: Importing Internal Schemas in Public Routes

**What people do:** Import `MacdVAnalysisSchema` directly from `@livermore/schemas` in public API route, accidentally expose all fields.

**Why it's wrong:** Internal schemas contain proprietary fields (formulas, config, internal IDs). Zod's `.pick()` or `.omit()` can miss fields if schema changes. Easy to leak sensitive data.

**Do this instead:**
- Define separate public schemas in `packages/schemas/src/public/` with explicit field whitelisting
- Use DTO transformer functions that ONLY copy allowed fields
- Add unit test: `PublicSchema.parse(transformed)` must pass (validates no extra fields)

### Anti-Pattern 2: Starting Exchange Services in PW-Host Mode

**What people do:** Forget to check `RUNTIME_MODE` before calling `exchangeAdapter.connect()`, start exchange WebSocket in pw-host instance.

**Why it's wrong:** PW-host instances should be stateless read-only servers. Connecting to exchanges wastes connections, risks duplicate data processing, creates split-brain if two instances process same feed.

**Do this instead:**
- Wrap ALL exchange-related service starts in `if (runtimeMode === 'exchange')` guard
- Add startup validation: throw error if exchange credentials present in pw-host mode
- Log clear startup message: "PW-HOST mode: exchange adapters disabled"

### Anti-Pattern 3: No Backpressure Handling in WebSocket Bridge

**What people do:** Call `socket.send(message)` in tight loop without checking return value or `drain` event. Buffer grows unbounded.

**Why it's wrong:** Slow clients (mobile on bad network) can't consume messages fast enough. TCP buffer fills, `socket.send()` returns `false`, but code ignores it. Process memory grows until OOM crash.

**Do this instead:**
- Check `socket.send()` return value (false = buffer full)
- Track per-client buffer size, pause client when limit reached
- Listen for `drain` event to resume sending
- Optionally disconnect clients that stay slow too long

### Anti-Pattern 4: Shared Rate Limit Across All Endpoints

**What people do:** Apply same rate limit (e.g., 100 req/min) to both lightweight `/symbols` endpoint and heavy `/candles` endpoint.

**Why it's wrong:** Different endpoints have different costs. Fetching 500 candles is 100x heavier than listing symbols. Attackers can exhaust server by spamming heavy endpoints within rate limit.

**Do this instead:**
- Apply tiered rate limits: strict for expensive endpoints, relaxed for cheap ones
- Use different rate limit keys: per-endpoint or per-cost
- Consider token bucket pattern: deduct more tokens for heavy operations

### Anti-Pattern 5: Exposing AsyncAPI Without Rate Limits

**What people do:** Document WebSocket endpoints in AsyncAPI spec, deploy without connection limits or message rate limits.

**Why it's wrong:** WebSocket connections are cheap to open but expensive to maintain (file descriptors, memory). Attackers can open 10K connections, exhaust `ulimit -n`, crash server.

**Do this instead:**
- Limit total WebSocket connections per IP (e.g., 10 max)
- Limit subscription count per connection (e.g., 50 channels max)
- Disconnect clients that send invalid messages or exceed rate limits
- Monitor active connections, alert on spikes

## Build Order Recommendations

Given dependencies between components, recommended build order:

### Phase 1: Public Schemas & DTO Layer
**Why first:** Foundation for all public-facing code. No dependencies on routes or WebSocket.

- Create `packages/schemas/src/public/` directory
- Define `PublicCandleSchema`, `PublicMacdVSchema`, `PublicSymbolSchema` with `.openapi()` metadata
- Create `packages/public-api/src/transformers/` with DTO functions
- Write unit tests: internal → public transformation, validate no extra fields

**Deliverable:** Schemas + transformers tested in isolation

### Phase 2: Runtime Mode Infrastructure
**Why second:** Needed before modifying server startup. No dependencies on public API routes.

- Add `RUNTIME_MODE` to `EnvConfigSchema`
- Create `packages/utils/src/runtime-mode.ts` with `getRuntimeMode()`, `validateRuntimeMode()`
- Modify `apps/api/src/server.ts` to read mode, log startup message
- Add conditional guards around exchange adapter startup
- Test: start in both modes, verify correct services start

**Deliverable:** Server starts in exchange/pw-host mode, exchange services only run in exchange mode

### Phase 3: Public REST API Routes
**Why third:** Depends on Phase 1 (schemas). Can be built/tested independently of WebSocket.

- Create `packages/public-api/` package
- Install `fastify-zod-openapi`, `zod-openapi`
- Implement routes: `GET /public/v1/candles/:symbol`, `GET /public/v1/symbols`
- Register routes in `server.ts` (both modes)
- Add rate limiting middleware
- Test: HTTP requests return public schemas, OpenAPI spec generated

**Deliverable:** Public REST endpoints working, OpenAPI spec at `/public/v1/openapi.json`

### Phase 4: WebSocket Bridge
**Why fourth:** Depends on Phase 1 (schemas for messages). Most complex component, build last.

- Create `packages/public-api/src/websocket/market-data-bridge.ts`
- Implement `psubscribe` to Redis pub/sub
- Implement fan-out logic with backpressure handling
- Register WebSocket route at `/public/ws/market-data`
- Add connection limits, subscription limits
- Test: multiple clients, slow client handling, reconnection

**Deliverable:** WebSocket bridge relays candle close events to external clients

### Phase 5: AsyncAPI Specification
**Why fifth:** Documents WebSocket API from Phase 4. Optional, can defer.

- Create AsyncAPI spec file describing WebSocket messages
- Document subscription protocol, event schemas
- Serve spec at `/public/v1/asyncapi.json`

**Deliverable:** AsyncAPI documentation for WebSocket API

## Sources

### Primary (HIGH confidence)
- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [tRPC Fastify Adapter](https://trpc.io/docs/server/adapters/fastify)
- [GitHub: fastify-zod-openapi](https://github.com/samchungy/fastify-zod-openapi)
- [GitHub: zod-openapi](https://github.com/samchungy/zod-openapi)
- [GitHub: trpc-openapi](https://github.com/trpc/trpc-openapi)
- [AsyncAPI WebSocket Tutorial](https://www.asyncapi.com/docs/tutorials/websocket)
- [Node.js Process Documentation](https://nodejs.org/api/process.html)
- [Redis Pub/Sub Documentation](https://redis.io/docs/latest/develop/pubsub/)

### Secondary (MEDIUM confidence)
- [Scaling Pub/Sub with WebSockets and Redis](https://ably.com/blog/scaling-pub-sub-with-websockets-and-redis)
- [How to Use Redis with WebSockets for Pub/Sub](https://oneuptime.com/blog/post/2026-02-02-redis-websockets-pubsub/view)
- [Backpressure in WebSocket Streams](https://skylinecodes.substack.com/p/backpressure-in-websocket-streams)
- [DTO Pattern in TypeScript](https://codewithstyle.info/typescript-dto/)
- [API Security Best Practices](https://www.securitycompass.com/blog/best-api-security-practices/)
- [Monorepo Internal Packages](https://konradreiche.com/blog/use-internal-packages-for-monorepos/)

### Codebase Analysis (HIGH confidence)
- `apps/api/src/server.ts` - Existing Fastify + tRPC setup, runtime state
- `packages/cache/src/client.ts` - Redis Cluster connection pattern
- `packages/schemas/src/indicators/macdv.schema.ts` - Internal schema example
- `apps/api/src/services/indicator-calculation.service.ts` - Redis pub/sub subscriber pattern
- `apps/api/src/services/runtime-state.ts` - Existing runtime state management

---
*Architecture research for: Perseus Web Public API*
*Researched: 2026-02-18*
