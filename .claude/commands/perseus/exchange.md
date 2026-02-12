---
name: perseus:exchange
description: Test exchange connectivity — REST, WebSocket, Pub/Sub
argument-hint: "[coinbase|kraken|pubsub|all]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

<objective>
Test exchange adapter connectivity and data flow. Covers REST API candle fetching,
WebSocket streams, and Redis Pub/Sub messaging.
</objective>

<critical_rules>
- NEVER look for .env files. Inject env vars from Windows User scope via PowerShell.
- Coinbase REST requires: Coinbase_ApiKeyId, Coinbase_EcPrivateKeyPem
- Redis tests require: LIVERMORE_REDIS_URL
- Exchange IDs: 1=Coinbase, 2=Binance, 3=BinanceUS, 4=Kraken
</critical_rules>

<context>
## Available Test Scripts

### Coinbase REST Candles
**Script:** `scripts/test-rest-candles.ts` (or wrapper `scripts/test-rest-candles.ps1`)
**Usage:**
```bash
powershell -File scripts/test-rest-candles.ps1
```
**What it tests:** Fetches BTC-USD 1h candles via CoinbaseRestClient, displays first/last 5, calculates data freshness.
**Expected output:** Candle data with ISO timestamps, OHLC values, age of newest candle in minutes.

### Coinbase WebSocket Candles
**Script:** `scripts/test-candles-channel.ps1`
**Usage:**
```bash
powershell -File scripts/test-candles-channel.ps1 -Symbols @("BTC-USD","ETH-USD") -Duration 30
```
**What it tests:** Connects to `wss://advanced-trade-ws.coinbase.com`, subscribes to candles channel, captures snapshots and updates.
**Expected output:** JSON results file with snapshot counts, update counts, granularity detection, and whether >= 100 candles received (MACD-V requirement).

### Kraken Simulation
**Script:** `scripts/test-v6-kraken.ts`
**Usage:**
```bash
powershell -Command "$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User'); npx tsx scripts/test-v6-kraken.ts"
```
**What it tests:** Simulates Kraken exchange instance with state transitions in Redis.

### Redis Pub/Sub
**Script:** `scripts/test-redis-pubsub.ts` (or wrapper `scripts/test-redis-pubsub.ps1`)
**Usage:**
```bash
powershell -File scripts/test-redis-pubsub.ps1
```
**What it tests:** Creates 2 Redis clients, publishes a message on `test:pubsub:channel`, verifies subscriber receives it within 2 seconds.
**Expected output:** "Pub/Sub Test PASSED" or "Pub/Sub Test FAILED"

## Exchange Adapter Architecture
- Base: `IExchangeAdapter` extends EventEmitter
- Events: `candle:close`, `connected`, `disconnected`, `error`, `reconnecting`
- Reconnection: exponential backoff, base 5s, max 5min, 100 max attempts
- Coinbase adapter: `CoinbaseAdapter` in `packages/exchange-core`
</context>

<process>
Parse $ARGUMENTS to determine which exchange to test.

## Mode: coinbase (default)
Test Coinbase REST API candle fetching:
```bash
powershell -File scripts/test-rest-candles.ps1
```
Verify candles are returned with valid OHLC data and reasonable freshness (<60 min old).

## Mode: kraken
Run the Kraken simulation:
```bash
powershell -Command "$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User'); npx tsx scripts/test-v6-kraken.ts"
```

## Mode: pubsub
Test Redis Pub/Sub:
```bash
powershell -File scripts/test-redis-pubsub.ps1
```
Verify PASSED output.

## Mode: all
Run all exchange tests sequentially:
1. Coinbase REST candles
2. Kraken simulation
3. Redis Pub/Sub

Report results for each.

## Report
For each test:
- PASS/FAIL status
- Key metrics (candle count, data freshness, message latency)
- Any errors with context
</process>

<success_criteria>
- [ ] Requested exchange test(s) executed
- [ ] Results clearly reported with PASS/FAIL
- [ ] Env vars injected via PowerShell (not .env)
</success_criteria>
