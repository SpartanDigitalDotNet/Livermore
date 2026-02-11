# Technology Stack

**Analysis Date:** 2026-01-18

## Languages

**Primary:**
- TypeScript 5.6.3 - All application code (apps, packages)

**Secondary:**
- SQL (PostgreSQL) - Database schema and queries via Drizzle ORM

## Runtime

**Environment:**
- Node.js >= 20.0.0 (required in `engines`)

**Package Manager:**
- pnpm 9.15.1 (enforced via `packageManager` field)
- Lockfile: `pnpm-lock.yaml` (present)

## Frameworks

**Core:**
- Fastify 5.2.2 - HTTP server framework (`apps/api`)
- tRPC 11.0.2 - Type-safe API layer with Fastify adapter

**Testing:**
- Vitest 2.1.8 - Unit testing (`packages/indicators`)

**Build/Dev:**
- Turborepo 2.3.3 - Monorepo build orchestration
- tsup 8.3.5 - TypeScript library bundling (ESM + CJS)
- tsx 4.19.2 - TypeScript execution and watch mode

## Key Dependencies

**Critical:**
- `drizzle-orm` 0.36.4 - PostgreSQL ORM with type safety
- `postgres` 3.4.5 - PostgreSQL driver (postgres.js)
- `ioredis` 5.4.2 - Redis client for caching and pub/sub
- `zod` 3.24.1 - Runtime schema validation
- `ws` 8.18.0 - WebSocket client for Coinbase

**Infrastructure:**
- `@fastify/cors` 10.0.1 - CORS middleware
- `@fastify/websocket` 11.0.1 - WebSocket support
- `jsonwebtoken` 9.0.3 - JWT generation for Coinbase API auth
- `pino` 9.5.0 / `pino-pretty` 12.0.0 - Structured logging

**Charting:**
- `echarts` 6.0.0 - Chart library
- `canvas` 3.2.1 - Server-side canvas for PNG generation

## Configuration

**Environment:**
- Environment variables validated via Zod schema at startup
- Config schema: `packages/schemas/src/env/config.schema.ts`
- Required vars: DATABASE_*, LIVERMORE_REDIS_URL, Coinbase_*, DISCORD_LIVERMORE_BOT

**Build:**
- `turbo.json` - Turborepo pipeline configuration
- `tsconfig.base.json` - Shared TypeScript config (ES2022 target, ESNext modules)
- `eslint.config.js` - Flat ESLint config with TypeScript rules
- `.prettierrc` - Code formatting (single quotes, 100 char width)

## Monorepo Structure

**Apps:**
- `apps/api` - Main Fastify server (entry: `src/server.ts`)

**Packages:**
- `@livermore/schemas` - Zod schemas and TypeScript types
- `@livermore/utils` - Shared utilities and logging (pino)
- `@livermore/database` - Drizzle ORM schema and client
- `@livermore/cache` - Redis caching strategies
- `@livermore/coinbase-client` - Coinbase REST + WebSocket clients
- `@livermore/indicators` - Technical indicators (MACD-V, ATR, EMA)
- `@livermore/charts` - Server-side ECharts PNG generation
- `@livermore/trpc-config` - Shared tRPC configuration

## Platform Requirements

**Development:**
- Node.js 20+
- pnpm 9+
- Docker (for PostgreSQL and Redis via `docker/docker-compose.yml`)
- Coinbase API credentials (Advanced Trade API)
- Discord webhook URL (for alerts)

**Production:**
- PostgreSQL 16+
- Redis 7+
- Node.js 20+ runtime

---

*Stack analysis: 2026-01-18*
