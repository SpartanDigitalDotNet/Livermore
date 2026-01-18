# External Integrations

**Analysis Date:** 2026-01-18

## APIs & External Services

**Coinbase Advanced Trade API:**
- Purpose: Cryptocurrency market data and account management
- SDK/Client: Custom client in `packages/coinbase-client`
- REST Client: `packages/coinbase-client/src/rest/client.ts`
- WebSocket Client: `packages/coinbase-client/src/websocket/client.ts`
- Auth: JWT-based, uses `Coinbase_ApiKeyId` + `Coinbase_EcPrivateKeyPem` env vars
- Endpoints Used:
  - `/api/v3/brokerage/accounts` - Get account holdings
  - `/api/v3/brokerage/products/{id}/candles` - Historical OHLCV data
  - `/api/v3/brokerage/best_bid_ask` - Live price quotes
  - `/api/v3/brokerage/orders/historical/batch` - Open orders
  - `wss://advanced-trade-ws.coinbase.com` - Real-time ticker data

**Discord Webhooks:**
- Purpose: Trading alerts and system notifications
- Implementation: `apps/api/src/services/discord-notification.service.ts`
- Auth: `DISCORD_LIVERMORE_BOT` env var (webhook URL)
- Features:
  - Rate limiting with queue
  - Embedded message formatting
  - Image attachments (chart PNGs)
  - Alert types: price_alert, indicator_alert, system, error, info

## Data Storage

**PostgreSQL 16:**
- Connection: `postgresql://{user}:{pass}@{host}:{port}/{db}`
- Environment Variables:
  - `DATABASE_LIVERMORE_USERNAME`
  - `DATABASE_LIVERMORE_PASSWORD`
  - `DATABASE_HOST`
  - `DATABASE_PORT`
  - `LIVERMORE_DATABASE_NAME`
- Client: Drizzle ORM (`packages/database/src/client.ts`)
- Schema Files: `packages/database/src/schema/*.ts`
- Tables:
  - `users` - User accounts
  - `user_exchanges` - Exchange credentials per user
  - `user_settings` - User preferences
  - `positions` - Portfolio positions
  - `candles` - Historical OHLCV data
  - `indicators` - Computed indicator values
  - `alert_history` - Triggered alert log

**Redis 7:**
- Connection: `REDIS_URL` env var (e.g., `redis://127.0.0.1:6379`)
- Client: ioredis (`packages/cache/src/client.ts`)
- Caching Strategies:
  - `CandleCacheStrategy` - OHLCV candle data
  - `TickerCacheStrategy` - Real-time price tickers
  - `OrderbookCacheStrategy` - Order book snapshots
  - `IndicatorCacheStrategy` - Computed indicator values
- Pub/Sub: Used for real-time indicator updates

**File Storage:**
- Local filesystem only (chart images are ephemeral, sent directly to Discord)

**Caching:**
- Redis with configurable TTLs:
  - Candles: 24 hours
  - Tickers: 60 seconds
  - Orderbook: 30 seconds

## Authentication & Identity

**Auth Provider:**
- Custom (no external auth provider)
- Single-user system (userId hardcoded to 1 in current implementation)

**API Authentication:**
- Coinbase: JWT tokens generated per-request using EC private key
- Discord: Webhook URL contains embedded auth token

## Monitoring & Observability

**Error Tracking:**
- None (logs only)

**Logs:**
- Pino logger with structured JSON output
- Log files: `logs/` directory (development only)
- Pretty printing via pino-pretty in development
- Log levels configurable via `LOG_LEVEL` env var

## CI/CD & Deployment

**Hosting:**
- Local development only (no cloud deployment configured)

**CI Pipeline:**
- None configured

**Docker:**
- `docker/docker-compose.yml` for local PostgreSQL and Redis
- PostgreSQL 16-alpine
- Redis 7-alpine with custom config

## Environment Configuration

**Required env vars:**
- `DATABASE_LIVERMORE_USERNAME` - PostgreSQL username
- `DATABASE_LIVERMORE_PASSWORD` - PostgreSQL password
- `DATABASE_HOST` - PostgreSQL host
- `DATABASE_PORT` - PostgreSQL port
- `LIVERMORE_DATABASE_NAME` - Database name
- `REDIS_URL` - Redis connection URL
- `Coinbase_ApiKeyId` - Coinbase Advanced Trade API key ID
- `Coinbase_EcPrivateKeyPem` - Coinbase EC private key (PEM format)
- `DISCORD_LIVERMORE_BOT` - Discord webhook URL

**Optional env vars:**
- `NODE_ENV` - development/production/test (default: development)
- `API_HOST` - Server bind host (default: 0.0.0.0)
- `API_PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging verbosity
- `LOG_FILE_ENABLED` - Enable file logging
- `LOG_PERF_ENABLED` - Enable performance logging

**Secrets location:**
- Environment variables (no .env file committed)
- Coinbase private key is multi-line PEM format

## Webhooks & Callbacks

**Incoming:**
- None (system polls Coinbase, no external webhooks received)

**Outgoing:**
- Discord webhook: POST to `DISCORD_LIVERMORE_BOT` URL
  - Alert notifications with embeds
  - Chart image attachments (multipart/form-data)
  - Rate-limited with exponential backoff

---

*Integration audit: 2026-01-18*
