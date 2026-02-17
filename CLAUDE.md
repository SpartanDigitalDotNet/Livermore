# Claude Notes for Livermore

Notes for Claude to avoid repeating mistakes.

## MANDATORY: User Approval Required

**NEVER make code changes, run scripts against the database, or modify production data without explicit user approval.** This includes:
- Changing scoring formulas, thresholds, or business logic
- Running refresh jobs or migration scripts
- Any action that writes to the database or modifies live state

When the user is testing or observing behavior, DO NOT assume they want a fix. Ask first. Wait for approval. No exceptions.

## Redis Connection

**Production: Azure Managed Redis**

The codebase uses Azure Managed Redis with OSS Cluster mode. Connection is handled via `LIVERMORE_REDIS_URL` environment variable.

**Required environment variable:**
```
LIVERMORE_REDIS_URL=rediss://:PASSWORD@HOST:PORT
```

**To connect programmatically, use the cache package:**
```typescript
import { getRedisClient } from '@livermore/cache';

const redis = getRedisClient();  // Auto-detects Azure and uses Cluster mode
```

The `createRedisClient()` function in `packages/cache/src/client.ts`:
- Parses `LIVERMORE_REDIS_URL` to extract host, port, password
- Detects Azure Redis by hostname (`*.redis.azure.net` or `*.redis.cache.windows.net`)
- Uses ioredis Cluster mode with TLS for Azure
- Falls back to regular Redis for local development

**Local development (optional):**

If using a local Docker Redis container:
- **Container name:** `Hermes`
- **Host:** `127.0.0.1`
- **Port:** `6400`

**Debug scripts (use LIVERMORE_REDIS_URL):**

```powershell
# Check candles
powershell -File scripts/debug-redis-candles.ps1 -Symbol "BTC-USD" -Timeframe "1m" -Count 5

# Full Redis debug
powershell -File scripts/debug-redis-full.ps1

# List Redis keys
powershell -File scripts/debug-redis-keys.ps1
```

**TypeScript script for fetching data:**
```bash
npx tsx scripts/fetch-btc-candles.ts
```

## Key Patterns

- Candles: `candles:{userId}:{exchangeId}:{symbol}:{timeframe}`
- Indicators: `indicator:{userId}:{exchangeId}:{symbol}:{timeframe}:{type}`
- Tickers: `ticker:{userId}:{exchangeId}:{symbol}`

## Log Levels

High-transaction services (indicators, candles, scheduler) are set to `error` level.

To enable verbose logging:
```bash
LOG_LEVEL=debug  # Everything
LOG_LEVEL_INDICATORS=debug  # Just indicators
```

Config file: `packages/utils/src/logger/log-config.ts`
