# Livermore

A professional crypto trading monitoring system that connects to Coinbase for real-time market data, calculates technical indicators, provides interactive charting with drawing tools, and sends Discord alerts when user-defined criteria are met.

## Architecture

**Monorepo** structure with shared packages and applications:

```
livermore/
├── apps/
│   ├── api/          # Backend Node.js server (Coming in Phase 2)
│   └── web/          # React frontend (Coming in Phase 4)
├── packages/
│   ├── schemas/      # Zod schemas (single source of truth)
│   ├── database/     # Drizzle ORM models and migrations
│   ├── cache/        # Redis caching strategies
│   ├── indicators/   # Technical analysis library (Coming in Phase 3)
│   ├── coinbase-client/  # Coinbase API client (Coming in Phase 2)
│   ├── discord-client/   # Discord notifications (Coming in Phase 3)
│   ├── trpc-config/  # Shared tRPC configuration
│   └── utils/        # Logger, time/math utilities
└── docker/           # Docker Compose for local dev
```

## Technology Stack

- **Frontend**: React + TypeScript, Vite, shadcn/ui, Lightweight Charts, Zustand, TanStack Query
- **Backend**: Node.js 20+, Fastify, tRPC, WebSockets
- **Database**: PostgreSQL 16 with Drizzle ORM
- **Cache**: Redis 7 with ioredis
- **Validation**: Zod schemas (single source of truth for types)
- **Monorepo**: pnpm workspaces + Turborepo
- **External APIs**: Coinbase (WebSocket + REST), Discord webhooks

## Core Principles

1. **Spec-Driven Development**: Zod schemas define all data contracts
2. **DRY**: Zero code duplication through shared packages
3. **Type Safety**: End-to-end type safety from database to UI
4. **No .env files**: All secrets from environment variables with Zod validation
5. **Professional UI**: shadcn/ui components with custom trading theme

## Getting Started

### Prerequisites

- **Node.js**: 20.0.0 or higher
- **pnpm**: 9.0.0 or higher
- **Docker**: For local PostgreSQL and Redis

### Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd livermore
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Start Docker services**

```bash
cd docker
docker-compose up -d
cd ..
```

4. **Set environment variables**

Set these environment variables in your shell or system:

```bash
# Node environment
export NODE_ENV=development

# API Server
export DATABASE_PORT=3000
export DATABASE_HOST=0.0.0.0

# Database
export DB_CONNECTION_STRING="postgresql://livermore:livermore_dev_password@localhost:5432"
export LIVERMORE_DATABASE_NAME="livermore"

# Redis
export LIVERMORE_REDIS_URL="redis://localhost:6379"

# Coinbase API (replace with your credentials)
export Coinbase_ApiKeyId="your-coinbase-api-key-id"
export Coinbase_EcPrivateKeyPem="your-coinbase-ec-private-key-pem"

# Discord (replace with your webhook URL)
export DISCORD_LIVERMORE_BOT="https://discord.com/api/webhooks/your-webhook-url"
```

5. **Run database migrations**

```bash
pnpm db:migrate
```

6. **Build all packages**

```bash
pnpm build
```

### Development

Start all services in watch mode:

```bash
pnpm dev
```

Or start services individually:

```bash
# API server (when implemented)
pnpm --filter @livermore/api dev

# Frontend (when implemented)
pnpm --filter @livermore/web dev
```

### Other Commands

```bash
# Type checking
pnpm type-check

# Linting
pnpm lint

# Format code
pnpm format

# Run tests
pnpm test

# Clean build artifacts
pnpm clean

# Database management
pnpm db:generate   # Generate migration files
pnpm db:migrate    # Run migrations
pnpm db:studio     # Open Drizzle Studio
```

## Environment Configuration

### Secrets (Environment Variables)

All sensitive data must be in environment variables:

- `NODE_ENV`: development | production | test
- `DATABASE_PORT`, `DATABASE_HOST`: API server configuration
- `DB_CONNECTION_STRING`: PostgreSQL connection string
- `LIVERMORE_DATABASE_NAME`: Database name
- `LIVERMORE_REDIS_URL`: Redis connection string
- `Coinbase_ApiKeyId`: Coinbase API key ID
- `Coinbase_EcPrivateKeyPem`: Coinbase EC private key (PEM format)
- `DISCORD_LIVERMORE_BOT`: Discord webhook URL

### Feature Flags (environment.json)

Non-sensitive configuration in `environment.json`:

```json
{
  "features": {
    "discordAlerts": true,
    "indicatorCache": true,
    "orderbookWalls": true,
    "realTimeUpdates": true,
    "historicalDataBackfill": true
  },
  "symbols": ["BTC-USD", "ETH-USD", "SOL-USD"],
  "defaultTimeframe": "1h",
  "defaultTheme": "dark"
}
```

**CRITICAL**: Never put secrets in `environment.json`!

## Project Status

### Phase 1: Foundation & Infrastructure ✅ COMPLETED

- [x] Monorepo setup with pnpm + Turborepo
- [x] TypeScript configuration and tooling
- [x] @livermore/schemas package (all Zod schemas)
- [x] @livermore/utils package (logger, time, math utilities)
- [x] @livermore/trpc-config package
- [x] @livermore/database package (Drizzle ORM)
- [x] @livermore/cache package (Redis strategies)
- [x] Docker Compose setup (PostgreSQL + Redis)

### Phase 2: Coinbase Integration ✅ COMPLETED

- [x] Coinbase client package (REST + WebSocket)
- [x] Backend API server (Fastify + tRPC)
- [x] Data ingestion services
- [x] Real-time data flow (Coinbase → Redis → Storage)

### Phase 3: Indicators & Alerts (Pending)

- [ ] Technical indicators library (EMA, MACD, RSI, etc.)
- [ ] Indicator calculation service
- [ ] Alert evaluation system
- [ ] Discord notification integration
- [ ] tRPC API routers

### Phase 4: Frontend - Core UI (Pending)

- [ ] React + TypeScript setup
- [ ] shadcn/ui design system
- [ ] Lightweight Charts integration
- [ ] Real-time WebSocket updates
- [ ] Core trading interface

### Phase 5: Frontend - Advanced Features (Pending)

- [ ] Indicator visualization
- [ ] Drawing tools (support/resistance lines)
- [ ] Orderbook visualization
- [ ] Alerts UI
- [ ] Chart state persistence

### Phase 6: Polish & Production Readiness (Pending)

- [ ] Performance optimization
- [ ] Error handling & resilience
- [ ] Monitoring & observability
- [ ] Testing (unit, integration, E2E)
- [ ] Documentation
- [ ] Security hardening

## Package Documentation

Each package has its own README with detailed usage information:

- [schemas](./packages/schemas/README.md) - Zod schemas and types
- [database](./packages/database/README.md) - Database models and migrations
- [cache](./packages/cache/README.md) - Redis caching strategies
- [utils](./packages/utils/README.md) - Shared utilities
- [trpc-config](./packages/trpc-config/README.md) - tRPC configuration
- [docker](./docker/README.md) - Docker setup guide

## Key Design Decisions

1. **Zod as Single Source of Truth**: All schemas in Zod, TypeScript types inferred
2. **Monorepo with pnpm + Turborepo**: Efficient package management and caching
3. **Drizzle ORM over Prisma**: Better TypeScript inference, lighter runtime
4. **Zustand over Redux**: Minimal boilerplate for real-time data
5. **shadcn/ui**: Customizable, professional components (not a dependency)
6. **Lightweight Charts**: Official TradingView library for financial charts
7. **tRPC**: End-to-end type safety without code generation
8. **No .env files**: Environment variables only, validated with Zod

## License

[Your License Here]

## Contributing

[Contributing Guidelines Here]

## Contact

[Contact Information Here]
