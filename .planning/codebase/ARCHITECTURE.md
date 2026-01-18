# Architecture

**Analysis Date:** 2026-01-18

## Pattern Overview

**Overall:** Monorepo with Event-Driven Services

**Key Characteristics:**
- Turborepo monorepo with pnpm workspaces
- Single API server orchestrating multiple services
- Real-time WebSocket data ingestion with event-driven processing
- Redis pub/sub for inter-service communication
- PostgreSQL for persistence, Redis for hot data caching

## Layers

**API Layer (apps/api):**
- Purpose: HTTP server, tRPC router, service orchestration
- Location: `apps/api/src/`
- Contains: Fastify server, tRPC routers, service implementations
- Depends on: All `@livermore/*` packages
- Used by: External clients (planned web/mobile)

**Shared Packages (packages/*):**
- Purpose: Reusable business logic, shared by API and future apps
- Location: `packages/*/src/`
- Contains: Indicators, schemas, database, cache, clients
- Depends on: Each other via workspace dependencies
- Used by: API server, scripts, future frontends

**Database Layer (packages/database):**
- Purpose: PostgreSQL schema and Drizzle ORM client
- Location: `packages/database/src/`
- Contains: Schema definitions, migrations, client singleton
- Depends on: `@livermore/schemas`, `@livermore/utils`
- Used by: API services for persistence

**Cache Layer (packages/cache):**
- Purpose: Redis caching strategies and pub/sub
- Location: `packages/cache/src/`
- Contains: Cache strategies (ticker, candle, indicator, orderbook), Redis client
- Depends on: `@livermore/schemas`
- Used by: API services for real-time data

**Indicators Layer (packages/indicators):**
- Purpose: Technical indicator calculations (MACD-V, ATR, EMA, etc.)
- Location: `packages/indicators/src/`
- Contains: Core functions (sma, ema, rma, atr), composite indicators (macd-v)
- Depends on: None (pure math library)
- Used by: Indicator calculation service

## Data Flow

**Real-Time Market Data Flow:**

1. `CoinbaseWebSocketService` connects to Coinbase WebSocket feed
2. Ticker events update Redis cache via `TickerCacheStrategy`
3. 1m candles aggregated locally from ticker events
4. On candle close, event emitted to `IndicatorCalculationService`
5. Indicator service fetches actual candle from REST API (for accuracy)
6. MACD-V calculated, cached in Redis, published via pub/sub
7. `AlertEvaluationService` subscribes to indicator updates
8. Alerts triggered based on MACD-V level crossings or reversals
9. Discord notifications sent, alerts persisted to PostgreSQL

**tRPC Query Flow:**

1. Client calls tRPC endpoint (e.g., `indicator.getMACDV`)
2. Request routed through Fastify to tRPC router
3. Router queries Redis cache for indicator data
4. If cache miss, calculates from cached candles
5. Response returned with indicator values and metadata

**State Management:**
- Server-side only (no frontend state management yet)
- Redis holds all hot data (tickers, candles, indicators)
- PostgreSQL for alert history and user configuration
- In-memory Maps for service state (previous values, cooldowns)

## Key Abstractions

**Cache Strategies:**
- Purpose: Encapsulate Redis key patterns and serialization
- Examples: `packages/cache/src/strategies/ticker-cache.ts`, `packages/cache/src/strategies/indicator-cache.ts`
- Pattern: Strategy pattern with consistent interface (get, set, publish)

**tRPC Router:**
- Purpose: Type-safe API endpoints with Zod validation
- Examples: `apps/api/src/routers/indicator.router.ts`, `apps/api/src/routers/alert.router.ts`
- Pattern: Procedure composition with shared context

**Zod Schemas:**
- Purpose: Single source of truth for types and runtime validation
- Examples: `packages/schemas/src/market/candle.schema.ts`, `packages/schemas/src/indicators/macdv.schema.ts`
- Pattern: Schema-first design with TypeScript inference

**Indicator Functions:**
- Purpose: Pure functions for technical indicator calculation
- Examples: `packages/indicators/src/indicators/macd-v.ts`, `packages/indicators/src/core/ema.ts`
- Pattern: Functional composition with series-oriented API

## Entry Points

**API Server:**
- Location: `apps/api/src/server.ts`
- Triggers: `pnpm --filter @livermore/api dev` or `npm run dev`
- Responsibilities: Initialize services, register tRPC, start Fastify

**Database Migrations:**
- Location: `packages/database/src/migrate.ts`
- Triggers: `pnpm db:migrate` (via drizzle-kit)
- Responsibilities: Apply schema changes to PostgreSQL

**Database Seed:**
- Location: `packages/database/src/seed.ts`
- Triggers: `pnpm --filter @livermore/database seed`
- Responsibilities: Populate initial test data

**Manual Scripts:**
- Location: `scripts/*.ps1`
- Triggers: Manual execution for debugging/analysis
- Responsibilities: Redis debugging, portfolio analysis, test execution

## Error Handling

**Strategy:** Catch-and-log with graceful degradation

**Patterns:**
- Try/catch in service methods with structured logging
- tRPC error formatter surfaces Zod validation errors
- Services continue operating if individual operations fail
- Cooldown periods prevent alert spam on repeated errors

## Cross-Cutting Concerns

**Logging:**
- Pino-based structured logging via `@livermore/utils`
- Service-specific loggers with file transport
- Request ID tracing in tRPC context

**Validation:**
- Zod schemas for all external input (tRPC, environment)
- `validateEnv()` ensures required env vars present at startup
- Runtime type checking via Zod parse

**Authentication:**
- Not yet implemented (TEST_USER_ID hardcoded)
- Coinbase API authentication via signed requests
- Discord webhook authentication via URL token

---

*Architecture analysis: 2026-01-18*
