# Binance Instance Handoff - Kaia

**Date:** 2026-02-13
**Exchange:** Binance (`binance`)
**Status:** Validated and Ready for Deployment

---

## 1. Overview

Livermore is a distributed multi-exchange trading data platform. Each Livermore API instance claims and serves exactly one exchange — you will run the Binance instance (binance.com), while Mike runs the Coinbase instance.

**What "your instance" means:**
- A separate Livermore API process running on your machine
- Connected to your Binance exchange via the `binance` exchange record in the shared database
- Writes candles, indicators, and tickers to shared Azure PostgreSQL and Redis infrastructure
- Uses exchange-scoped cache keys so data from different exchanges doesn't collide
- Managed via the Admin UI Network page

**Architecture:**
- **Shared Database:** Azure PostgreSQL Sandbox (Mike's instance writes Coinbase data, yours writes Binance data)
- **Shared Redis:** Azure Managed Redis with OSS Cluster mode (exchange-scoped keys prevent conflicts)
- **Instance Ownership:** The `user_exchanges` table links your user to the `binance` exchange
- **Admin UI:** The Network page shows all exchange instances across the system

---

## 2. Environment Variables

Set these environment variables on your machine. Livermore uses Windows User-scoped environment variables (not `.env` files).

### Database (Shared Azure PostgreSQL Sandbox)

```
DATABASE_HOST=<Azure PostgreSQL host>
DATABASE_PORT=5432
DATABASE_LIVERMORE_USERNAME=<your database username>
DATABASE_LIVERMORE_PASSWORD=<your database password>
LIVERMORE_DATABASE_NAME=<shared database name>
```

**Note:** You share the same database as Mike, but your instance writes to different exchange-scoped records.

### Redis (Shared Azure Managed Redis)

```
LIVERMORE_REDIS_URL=rediss://:PASSWORD@HOST:PORT
```

Uses TLS (`rediss://`) and OSS Cluster mode. The cache package auto-detects Azure and configures accordingly.

### Clerk Authentication

```
CLERK_PUBLISHABLE_KEY=<Clerk publishable key>
CLERK_SECRET_KEY=<Clerk secret key>
CLERK_WEBHOOK_SIGNING_SECRET=<Clerk webhook signing secret>
```

### Binance API Keys (Optional)

**Not required for market data.** Binance WebSocket streams and REST klines endpoints are public. You only need API keys if you want to execute trades (out of scope for v7.0).

If you later add trading capabilities:
- Set environment variables for API credentials
- Configure `api_key_env_var` and `api_secret_env_var` in the Exchange Setup Modal
- Leave blank for now

---

## 3. Exchange Database Configuration

The `exchanges` table is seeded with a `binance` entry:

```sql
name: 'binance'
display_name: 'Binance'
ws_url: 'wss://stream.binance.com:9443'
rest_url: 'https://api.binance.com'
supported_timeframes: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
is_active: true
```

**Your `user_exchanges` record:**
- Links your user ID to the `binance` exchange
- Created via the Admin UI Exchange Setup Modal (Phase 37)
- Fields to configure:
  - `display_name`: How the exchange appears in your UI (e.g., "My Binance")
  - `api_key_env_var`: Name of environment variable holding API key (can leave blank)
  - `api_secret_env_var`: Name of environment variable holding API secret (can leave blank)
  - `is_active`: Whether this exchange is enabled for your account
  - `is_default`: Whether this is your default exchange (only one per user)

**Flags:**
- `is_active`: Set to `true` to enable the exchange for your account
- `is_default`: Set to `true` to make this your default exchange (all other exchanges for your user will be set to `false` automatically)

---

## 4. First-Run Steps

Step-by-step instructions to get your Binance instance running:

1. **Clone the Livermore repository**
   ```bash
   git clone <repo-url>
   cd Livermore
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set environment variables**
   - Set all variables from Section 2 in Windows User scope
   - Verify with `echo $env:DATABASE_HOST` in PowerShell

4. **Build all packages**
   ```bash
   pnpm build
   ```

5. **Start the Admin UI**
   ```bash
   .\scripts\run-admin-dev.ps1
   ```

6. **Navigate to the Network page**
   - Open the Admin UI in your browser
   - Click "Network" in the sidebar

7. **Your exchange instance should appear**
   - Look for a card labeled "Binance" (or your custom display name)
   - Initial status: `idle` or `offline`

8. **Configure your user_exchange record** (if not already done)
   - Click the Exchange Setup gear icon on the card
   - Fill in display name (required)
   - API key environment variable names (optional - leave blank for market data only)
   - Set `is_active` to `true`
   - Set `is_default` to `true` if this is your primary exchange
   - Click Save

9. **Connect to start the instance**
   - Click the "Connect" button on your Binance card
   - The instance will transition through states:
     - `idle` → `starting` → `warming` → `active`

10. **Monitor warmup progress**
    - Watch the WarmupProgressPanel at the bottom of the instance card
    - Shows real-time progress: symbols scanned, candles cached, completion percentage
    - Warmup typically completes in 30-60 seconds for Binance

11. **Verify active status**
    - Card header should show green "active" status
    - WarmupProgressPanel should show 100% complete
    - Activity feed should show recent network events

---

## 5. Verification Checklist

How to verify your Binance instance is healthy:

### Admin UI Checks

- [ ] Network page shows your Binance exchange card
- [ ] Card status is "active" with green indicator
- [ ] WarmupProgressPanel shows 100% completion
- [ ] Activity feed shows recent candle/ticker updates
- [ ] No error messages in the activity feed

### Redis Checks

Run the debug script to verify candles are cached:

```powershell
.\scripts\debug-redis-keys.ps1
```

Look for keys matching:
- `candles:{exchangeId}:BTCUSDT:1d`
- `candles:{exchangeId}:BTCUSDT:1m`
- `ticker:{exchangeId}:BTCUSDT`

Where `{exchangeId}` is your `binance` exchange ID from the database.

### Test Harness

Run the subscription test harness (see Section 7):

```powershell
.\scripts\test-subscription-harness.ps1 -Exchange binance
```

Both TST-01 (REST) and TST-02 (WebSocket) should PASS.

### Network Activity Logs

- Check `packages/api/logs/` for error-free startup
- Look for "Smart warmup complete" message
- Verify WebSocket connection established
- No 429 (rate limit) or 403 (auth) errors

---

## 6. Troubleshooting

### "Exchange not found in database"

**Cause:** The `exchanges` table doesn't have a `binance` row.

**Fix:**
1. Verify seed data is applied: Check `packages/database/schema.sql` for the `binance` INSERT statement
2. Run Atlas migrations if needed
3. Verify with SQL:
   ```sql
   SELECT id, name, display_name FROM exchanges WHERE name = 'binance';
   ```

### "No wsUrl configured for exchange"

**Cause:** The `exchanges.ws_url` column is NULL or empty.

**Fix:**
1. Update the `binance` row:
   ```sql
   UPDATE exchanges
   SET ws_url = 'wss://stream.binance.com:9443'
   WHERE name = 'binance';
   ```

### "Connection timeout" or "WebSocket connection failed"

**Cause:** Binance may be unreachable from your network (geo-blocking, firewall, ISP issues).

**Diagnosis:**
1. Test direct connection: `curl https://api.binance.com/api/v3/ping`
2. Check WebSocket: Use a WebSocket client to connect to `wss://stream.binance.com:9443/ws`
3. Try from a different network or VPN

**Note:** Binance.com may be geo-restricted for US-based networks. If needed, use a VPN or verify access from your location.

### "Redis connection error: ECONNREFUSED"

**Cause:** `LIVERMORE_REDIS_URL` is incorrect or Azure Redis is unreachable.

**Fix:**
1. Verify `LIVERMORE_REDIS_URL` format: `rediss://:PASSWORD@HOST:PORT`
2. Test Redis connection:
   ```powershell
   .\scripts\debug-redis-keys.ps1
   ```
3. Check Azure Redis status in Azure Portal
4. Verify your IP is allowed in Azure Redis firewall rules

### "No user_exchanges record found"

**Cause:** Your user is not linked to the `binance` exchange.

**Fix:**
1. Use the Exchange Setup Modal in the Admin UI to create the record
2. Verify with SQL:
   ```sql
   SELECT * FROM user_exchanges
   WHERE user_id = <your_user_id> AND exchange_name = 'binance';
   ```

### General Diagnosis

**First step:** Run the test harness. It validates the entire pipeline in isolation.

```powershell
.\scripts\test-subscription-harness.ps1 -Exchange binance
```

If the test harness passes but your instance doesn't connect:
- Check environment variables are set correctly
- Verify `pnpm build` completed without errors
- Check Admin UI logs for startup errors
- Restart the Admin UI dev server

---

## 7. Test Results

**Validation Gate for Handoff**

The subscription test harness was executed against Binance to validate the complete data pipeline end-to-end.

### Test Execution

**Date:** 2026-02-13
**Exchange:** `binance`
**Executor:** User (via PowerShell)

### Results

#### TST-01: REST Warmup Validation

**Status:** ✓ PASS

**Details:**
- REST client connected to Binance API (`https://api.binance.com`)
- Fetched BTC 1-day candles via `getCandles('BTCUSDT', '1d')`
- Candles successfully cached to Redis using exchange-scoped key
- Verification: `ZCARD` confirmed candles present in cache

**Validation:**
- REST API endpoint reachable
- BinanceRestClient correctly configured with exchange `restUrl` from database
- CandleCacheStrategy writes to exchange-scoped key: `candles:{exchangeId}:BTCUSDT:1d`
- Redis caching working correctly

#### TST-02: WebSocket Streaming Validation

**Status:** ✓ PASS

**Details:**
- WebSocket connected to Binance stream (`wss://stream.binance.com:9443/ws`)
- Subscribed to `btcusdt@kline_1m` stream using SUBSCRIBE method frame
- Received kline messages within 2-second test window
- Parsed OHLCV data successfully

**Validation:**
- WebSocket endpoint reachable
- SUBSCRIBE method frame accepted by Binance
- Kline events streaming correctly (event type `e === 'kline'`)
- Data parsing works (extracted `k.o`, `k.h`, `k.l`, `k.c`, `k.v`)

### Summary

Both tests passed successfully. The Binance adapter is fully functional and ready for production use. Kaia can proceed with confidence that:

1. REST candle fetching works (warmup will succeed)
2. WebSocket streaming works (live data will flow)
3. Redis caching works (data persistence verified)
4. Exchange-scoped keys prevent data collisions

**Handoff Status:** ✅ VALIDATED - Ready for Deployment

---

## Next Steps

1. Set environment variables on your machine (Section 2)
2. Follow First-Run Steps (Section 4)
3. Run the test harness to verify your environment:
   ```powershell
   .\scripts\test-subscription-harness.ps1 -Exchange binance
   ```
4. Start the Admin UI and connect to your Binance instance
5. Monitor warmup progress and verify active status
6. Check Redis keys to confirm data is caching correctly

**If you encounter any issues:** Reference Section 6 (Troubleshooting) or reach out to Mike with specific error messages from the test harness or Admin UI logs.

---

*Generated as part of Phase 38 (Binance Test Harness & Handoff) - v7.0 Smart Warmup & Binance Adapter*
