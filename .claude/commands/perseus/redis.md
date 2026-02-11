---
name: perseus:redis
description: Inspect Redis state — instances, activity streams, candles, indicators
argument-hint: "[keys|instances|activity|candles]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

<objective>
Inspect the current Redis state for the Livermore system. Supports checking instance status,
activity streams, candle data, indicator data, and raw key listings.
Connects via LIVERMORE_REDIS_URL (Azure Managed Redis with OSS Cluster mode).
</objective>

<critical_rules>
- NEVER look for .env files. Use LIVERMORE_REDIS_URL from Windows User scope.
- To run TypeScript scripts that need Redis, inject the env var first:
  `powershell -Command "$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User'); npx tsx SCRIPT.ts"`
- The programmatic Redis client is in `packages/cache/src/client.ts` — use `getRedisClient()`.
- Azure Redis uses Cluster mode with TLS. Local dev uses plain Redis on port 6400 (container: Hermes).
</critical_rules>

<context>
## Redis Key Patterns

### Instance Registry (Phase 30)
- `exchange:{exchangeId}:status` — InstanceStatus JSON, TTL 45s (heartbeat)
- `logs:network:{exchangeName}` — Redis Stream (activity feed)

### Exchange-Scoped Data (Tier 1 - Shared)
- `candles:{exchangeId}:{symbol}:{timeframe}` — Sorted set of candle JSON
- `indicator:{exchangeId}:{symbol}:{timeframe}:{type}` — Sorted set of indicator values
- `ticker:{exchangeId}:{symbol}` — Latest ticker data
- `orderbook:{exchangeId}:{symbol}` — Order book snapshot

### User-Scoped Data (Tier 2 - Overflow)
- `usercandles:{userId}:{exchangeId}:{symbol}:{timeframe}`
- `userindicator:{userId}:{exchangeId}:{symbol}:{timeframe}:{type}`

### Pub/Sub Channels
- `channel:exchange:{exchangeId}:candle:close:{symbol}:{timeframe}`
- `channel:alerts:exchange:{exchangeId}`

### Exchange IDs
- 1: Coinbase
- 2: Binance
- 3: BinanceUS
- 4: Kraken

## Existing Debug Scripts

| Script | Usage |
|--------|-------|
| `scripts/debug-redis-keys.ps1` | List all keys by pattern |
| `scripts/debug-redis-candles.ps1 -Symbol "BTC-USD" -Timeframe "1m" -Count 5` | Fetch candle data |
| `scripts/debug-redis-full.ps1` | Full Redis state analysis |
| `scripts/test-v6-redis.ts` | Check v6 instance status + activity streams |
</context>

<process>
Parse $ARGUMENTS to determine what to inspect. Default to a general overview if no argument.

## Mode: keys (or no argument)
List all Redis keys by category:
```bash
powershell -File scripts/debug-redis-keys.ps1
```

## Mode: instances
Check instance status for all exchanges:
```bash
powershell -Command "$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User'); npx tsx scripts/test-v6-redis.ts"
```

## Mode: activity
Check network activity streams for all exchanges. Use test-v6-redis.ts which reads
`logs:network:{exchangeName}` streams for coinbase, binance, binanceus.

## Mode: candles
Fetch candle data. If a symbol is provided (e.g., `candles BTC-USD`), use it:
```bash
powershell -File scripts/debug-redis-candles.ps1 -Symbol "BTC-USD" -Timeframe "1m" -Count 5
```

## Report
Summarize what was found: key counts by pattern, instance states, data freshness, stream lengths.
</process>

<success_criteria>
- [ ] Connected to Redis via LIVERMORE_REDIS_URL (not .env)
- [ ] Requested data retrieved and summarized
- [ ] Key patterns match documented formats
</success_criteria>
