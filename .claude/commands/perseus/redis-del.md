---
name: perseus:redis-del
description: Delete one or more Redis keys from Azure Redis. Use when cleaning up ghost keys, stale instances, orphaned data, or any key that needs removal.
argument-hint: "[key-pattern or exact key]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Grep
---

<objective>
Safely delete Redis keys from the Livermore Azure Managed Redis instance.
Supports exact key names, multiple keys, and pattern-based deletion with confirmation.
Connects via LIVERMORE_REDIS_URL / LIVERMORE_REDIS_PORT / LIVERMORE_REDIS_SECRET environment
variables (Windows User scope). Uses `getRedisClient()` from `@livermore/cache` which
auto-detects Azure and connects in Cluster mode with TLS.
</objective>

<critical_rules>
- ALWAYS show the key value(s) BEFORE deleting so the user can confirm.
- NEVER delete keys matching `candles:*`, `indicator:*`, or `ticker:*` without explicit user confirmation — these are live market data.
- NEVER delete keys matching `channel:*` — these are Pub/Sub channels, not data keys.
- NEVER use FLUSHDB or FLUSHALL under any circumstances.
- NEVER look for .env files. Environment variables are in Windows User scope.
- ALWAYS use `NODE_ENV=development` when running scripts (the env validator rejects `dev`).
- ALWAYS clean up any temporary script files created during execution.
- For pattern-based deletion, list ALL matching keys first and require user approval before deleting.
</critical_rules>

<context>
## Redis Connection

The project uses Azure Managed Redis with OSS Cluster mode.
Connection is handled by `@livermore/cache` package via `getRedisClient()`.

**Required env vars (Windows User scope):**
- `LIVERMORE_REDIS_URL` — Azure Redis hostname
- `LIVERMORE_REDIS_PORT` — Port (typically 10000)
- `LIVERMORE_REDIS_SECRET` — Auth password

**Script execution pattern:**
```bash
NODE_ENV=development npx tsx <script-path>
```

## Redis Key Patterns (for reference)

| Pattern | Description | Safe to delete? |
|---------|-------------|-----------------|
| `exchange:{id}:status` | Instance heartbeat (TTL 45s) | Yes — will auto-recreate on next heartbeat |
| `exchange:{id}:warm-up-schedule` | Warmup schedule | Yes — rebuilt on next startup |
| `exchange:{id}:warm-up-schedule:stats` | Warmup progress stats | Yes — rebuilt on next startup |
| `logs:network:{name}` | Activity stream | Caution — historical data |
| `candles:{id}:{symbol}:{tf}` | Candle sorted sets | Caution — triggers full_refresh warmup (~20 min for 57 symbols) |
| `indicator:{id}:{symbol}:{tf}:{type}` | Indicator sorted sets | Caution — requires re-warmup |
| `ticker:{id}:{symbol}` | Latest ticker | Caution — live data |
| `orderbook:{id}:{symbol}` | Order book snapshot | Caution — live data |

## Exchange IDs
- 0: Invalid/placeholder (ghost key — always safe to delete)
- 1: Coinbase
- 2: Binance
- 3: BinanceUS
- 4: Kraken
</context>

<process>
Parse $ARGUMENTS to determine what to delete.

## Step 1: Write temporary deletion script

Create `tmp/redis-del-tmp.ts` with the appropriate operation:

### For exact key deletion:
```typescript
import { getRedisClient } from '@livermore/cache';

async function main() {
  const redis = getRedisClient();
  const key = 'THE_KEY_HERE';

  const val = await redis.get(key);
  if (val) {
    console.log(`Key: ${key}`);
    console.log(`Value: ${val}`);
    console.log('---');
    await redis.del(key);
    console.log(`DELETED: ${key}`);
  } else {
    console.log(`Key not found: ${key}`);
  }

  // Verify
  const check = await redis.get(key);
  console.log(`Verify: ${check ?? '(null)'}`);
  process.exit(0);
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
```

### For pattern-based deletion (e.g., `exchange:0:*`):
```typescript
import { getRedisClient } from '@livermore/cache';

async function main() {
  const redis = getRedisClient();
  const pattern = 'THE_PATTERN_HERE';

  // Scan for matching keys
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  if (keys.length === 0) {
    console.log(`No keys matching: ${pattern}`);
    process.exit(0);
  }

  console.log(`Found ${keys.length} key(s) matching "${pattern}":`);
  for (const k of keys) {
    const val = await redis.get(k);
    console.log(`  ${k} = ${val ? val.substring(0, 120) + (val.length > 120 ? '...' : '') : '(non-string or empty)'}`);
  }

  // Delete all matching keys
  console.log('---');
  const deleted = await redis.del(...keys);
  console.log(`DELETED: ${deleted} key(s)`);
  process.exit(0);
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
```

### For multiple explicit keys:
```typescript
import { getRedisClient } from '@livermore/cache';

async function main() {
  const redis = getRedisClient();
  const keys = ['key1', 'key2', 'key3'];

  for (const key of keys) {
    const val = await redis.get(key);
    if (val) {
      console.log(`Key: ${key}`);
      console.log(`Value: ${val.substring(0, 120)}${val.length > 120 ? '...' : ''}`);
      await redis.del(key);
      console.log(`DELETED: ${key}`);
    } else {
      console.log(`Not found: ${key}`);
    }
    console.log('---');
  }
  process.exit(0);
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
```

## Step 2: Run the script

```bash
NODE_ENV=development npx tsx tmp/redis-del-tmp.ts
```

## Step 3: Clean up

```bash
rm tmp/redis-del-tmp.ts
```

## Step 4: Report

Summarize:
- Which keys were found and their values (or truncated preview)
- Which keys were deleted
- Which keys were not found
- Verification that deleted keys are now null
</process>

<success_criteria>
- [ ] Target key(s) identified from $ARGUMENTS
- [ ] Key value(s) displayed before deletion
- [ ] Key(s) deleted successfully
- [ ] Deletion verified (key returns null)
- [ ] Temporary script file cleaned up
- [ ] No live data keys deleted without explicit confirmation
</success_criteria>
