# Claude Notes for Livermore

Notes for Claude to avoid repeating mistakes.

## Redis Connection

**DO NOT GUESS. Use these exact details:**

- **Container name:** `Hermes`
- **Host:** `127.0.0.1`
- **Port:** `6400`
- **Password:** From `REDIS_PASSWORD` environment variable (User scope)

**To query Redis, use the existing PowerShell scripts:**

```powershell
# Check candles
powershell -File scripts/debug-redis-candles.ps1 -Symbol "BTC-USD" -Timeframe "1m" -Count 5

# Full Redis debug
powershell -File scripts/debug-redis-full.ps1

# List Redis keys
powershell -File scripts/debug-redis-keys.ps1
```

**Direct Docker command (if needed):**
```bash
docker exec Hermes redis-cli -a $REDIS_PASSWORD --no-auth-warning ZRANGE "candles:1:1:BTC-USD:1m" -5 -1
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
