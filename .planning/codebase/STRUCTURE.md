# Codebase Structure

**Analysis Date:** 2026-01-18

## Directory Layout

```
livermore/
├── apps/                       # Application packages
│   └── api/                    # Fastify API server
│       └── src/
│           ├── routers/        # tRPC route handlers
│           ├── services/       # Business logic services
│           └── server.ts       # Application entry point
├── packages/                   # Shared library packages
│   ├── cache/                  # Redis caching strategies
│   ├── charts/                 # Server-side chart generation (ECharts)
│   ├── coinbase-client/        # Coinbase REST and WebSocket clients
│   ├── database/               # PostgreSQL schema and Drizzle ORM
│   ├── indicators/             # Technical indicator calculations
│   ├── schemas/                # Zod schemas and TypeScript types
│   ├── trpc-config/            # tRPC initialization and context
│   └── utils/                  # Shared utilities (logger, time, math)
├── docker/                     # Docker configuration
│   └── postgres/               # PostgreSQL initialization
├── docs/                       # Documentation
├── logs/                       # Runtime logs (gitignored)
├── scripts/                    # PowerShell utility scripts
├── spikes/                     # Experimental code (gitignored)
├── tests/                      # Manual integration tests
├── .planning/                  # GSD planning documents
├── .specify/                   # Specification documents
├── package.json                # Root workspace configuration
├── pnpm-workspace.yaml         # pnpm workspace definition
├── turbo.json                  # Turborepo task configuration
└── tsconfig.base.json          # Base TypeScript configuration
```

## Directory Purposes

**apps/api/:**
- Purpose: Main backend server for Livermore
- Contains: Fastify server, tRPC routers, service classes
- Key files: `src/server.ts` (entry), `src/routers/index.ts` (router merge)

**packages/cache/:**
- Purpose: Redis caching abstraction layer
- Contains: Cache strategies, Redis client singleton, key generators
- Key files: `src/client.ts` (Redis connection), `src/strategies/*.ts` (caching patterns)

**packages/charts/:**
- Purpose: Server-side PNG chart generation for Discord alerts
- Contains: ECharts generators, themes, type definitions
- Key files: `src/generators/macdv-chart.ts` (MACD-V chart), `src/themes/hermes.ts` (chart theme)

**packages/coinbase-client/:**
- Purpose: Coinbase Advanced Trade API client
- Contains: REST client, WebSocket client, authentication
- Key files: `src/rest/client.ts` (REST API), `src/websocket/client.ts` (WebSocket feed)

**packages/database/:**
- Purpose: PostgreSQL database layer
- Contains: Drizzle schema, migrations, client singleton
- Key files: `src/schema/index.ts` (all tables), `src/client.ts` (Drizzle instance)

**packages/indicators/:**
- Purpose: Technical analysis calculations
- Contains: Core functions (EMA, SMA, ATR), composite indicators (MACD-V)
- Key files: `src/indicators/macd-v.ts` (main indicator), `src/core/*.ts` (building blocks)

**packages/schemas/:**
- Purpose: Single source of truth for types
- Contains: Zod schemas for all domain objects
- Key files: `src/index.ts` (all exports), `src/market/*.ts` (market data schemas)

**packages/trpc-config/:**
- Purpose: tRPC router factory and context
- Contains: tRPC initialization, context creation, middleware
- Key files: `src/trpc.ts` (router/procedure exports), `src/context.ts` (request context)

**packages/utils/:**
- Purpose: Shared utilities
- Contains: Logger, time utils, math helpers, environment validation
- Key files: `src/logger/logger.ts` (Pino wrapper), `src/validation/env-validator.ts` (env check)

## Key File Locations

**Entry Points:**
- `apps/api/src/server.ts`: API server main
- `packages/database/src/migrate.ts`: Database migration runner
- `packages/database/src/seed.ts`: Database seeder

**Configuration:**
- `package.json`: Root workspace with turbo scripts
- `turbo.json`: Task pipeline configuration
- `tsconfig.base.json`: Shared TypeScript settings
- `.prettierrc`: Code formatting rules

**Core Logic:**
- `apps/api/src/services/coinbase-websocket.service.ts`: Real-time data ingestion
- `apps/api/src/services/indicator-calculation.service.ts`: MACD-V calculation orchestration
- `apps/api/src/services/alert-evaluation.service.ts`: Alert triggering logic
- `apps/api/src/services/discord-notification.service.ts`: Discord webhook integration

**Database Schema:**
- `packages/database/src/schema/users.ts`: User table
- `packages/database/src/schema/positions.ts`: Position tracking
- `packages/database/src/schema/alert-history.ts`: Alert records
- `packages/database/src/schema/candles.ts`: Historical candle data

**Testing:**
- `packages/indicators/src/__tests__/*.test.ts`: Indicator unit tests
- `tests/manual/*.ts`: Manual integration tests
- `test-setup.ts`: Root test configuration

## Naming Conventions

**Files:**
- kebab-case for all TypeScript files: `macd-v.ts`, `alert-evaluation.service.ts`
- `.schema.ts` suffix for Zod schema files: `candle.schema.ts`
- `.service.ts` suffix for service classes: `coinbase-websocket.service.ts`
- `.router.ts` suffix for tRPC routers: `indicator.router.ts`
- `.test.ts` suffix for test files: `sma.test.ts`

**Directories:**
- lowercase with hyphens: `coinbase-client`, `trpc-config`
- `src/` for source code in all packages
- `dist/` for compiled output (gitignored)

**Packages:**
- Scoped to `@livermore/*`: `@livermore/cache`, `@livermore/indicators`
- Package name matches directory: `packages/cache` -> `@livermore/cache`

**Exports:**
- camelCase for functions: `macdV()`, `getRedisClient()`
- PascalCase for classes: `CoinbaseWebSocketClient`, `AlertEvaluationService`
- PascalCase for types/interfaces: `MACDVValue`, `CachedIndicatorValue`
- SCREAMING_SNAKE_CASE for constants: `MACD_V_DEFAULTS`, `SUPPORTED_TIMEFRAMES`

## Where to Add New Code

**New Feature (e.g., new indicator):**
- Primary code: `packages/indicators/src/indicators/[indicator-name].ts`
- Schema: `packages/schemas/src/indicators/[indicator-name].schema.ts`
- Tests: `packages/indicators/src/__tests__/[indicator-name].test.ts`
- Export from: `packages/indicators/src/index.ts`

**New API Endpoint:**
- Router: `apps/api/src/routers/[domain].router.ts`
- Register in: `apps/api/src/routers/index.ts`
- Input schemas: Define in router file or `@livermore/schemas`

**New Service:**
- Service class: `apps/api/src/services/[name].service.ts`
- Initialize in: `apps/api/src/server.ts` start function
- Inject dependencies via constructor

**New Database Table:**
- Schema: `packages/database/src/schema/[table-name].ts`
- Export from: `packages/database/src/schema/index.ts`
- Generate migration: `pnpm db:generate`
- Apply: `pnpm db:migrate`

**New Cache Strategy:**
- Strategy: `packages/cache/src/strategies/[name]-cache.ts`
- Key generator: Add to `packages/cache/src/keys.ts`
- Export from: `packages/cache/src/index.ts`

**Utilities:**
- Shared helpers: `packages/utils/src/[category]/[function].ts`
- Export from: `packages/utils/src/index.ts`

## Special Directories

**node_modules/:**
- Purpose: Package dependencies (pnpm hoisted structure)
- Generated: Yes (pnpm install)
- Committed: No

**dist/:**
- Purpose: Compiled TypeScript output
- Generated: Yes (pnpm build)
- Committed: No

**.turbo/:**
- Purpose: Turborepo cache
- Generated: Yes (turbo run)
- Committed: No

**logs/:**
- Purpose: Runtime log files (by service)
- Generated: Yes (at runtime)
- Committed: No
- Subdirs: `database/`, `indicators/`, `livermore/`, `redis/`, `trpc/`

**drizzle/:**
- Purpose: Database migration files
- Location: `packages/database/drizzle/`
- Generated: Yes (drizzle-kit generate)
- Committed: Yes

**.planning/:**
- Purpose: GSD command planning documents
- Generated: By GSD commands
- Committed: Yes

**.specify/:**
- Purpose: Feature specifications
- Generated: Manually or by specification commands
- Committed: Yes

---

*Structure analysis: 2026-01-18*
