# Architecture Research: v5.0 Multi-Exchange

**Researched:** 2026-02-06
**Confidence:** HIGH (based on codebase analysis)
**Mode:** Integration research for exchange-scoped data architecture

## Executive Summary

The v5.0 architecture change from user-scoped to exchange-scoped data requires coordinated changes across 4 layers: Redis keys, database schema, cache strategies, and services. The existing architecture cleanly separates these concerns, making the migration straightforward but requiring careful sequencing to maintain backward compatibility during the transition.

The key insight: Redis keys currently embed `userId` and `exchangeId` in every key. The v5.0 model separates "shared data" (exchange-scoped, no userId) from "overflow data" (user-specific symbols not in the shared pool). This is a data access pattern change, not a fundamental architecture change.

## Current Architecture (v4.0)

### Component Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              API Server                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        Startup Sequence                              ││
│  │  1. validateEnv()                                                   ││
│  │  2. getDbClient() + testDatabaseConnection()                        ││
│  │  3. getRedisClient() + testRedisConnection()                        ││
│  │  4. getAccountSymbols() → symbols from Coinbase positions           ││
│  │  5. cleanupExcludedSymbols() → remove old keys                      ││
│  │  6. StartupBackfillService.backfill()                               ││
│  │  7. Register tRPC routers                                           ││
│  │  8. IndicatorCalculationService.start()                             ││
│  │  9. IndicatorCalculationService.forceRecalculate() (warmup)         ││
│  │  10. BoundaryRestService.start()                                    ││
│  │  11. CoinbaseAdapter.connect() + subscribe()                        ││
│  │  12. AlertEvaluationService.start()                                 ││
│  │  13. Build ServiceRegistry                                          ││
│  │  14. ControlChannelService initialized lazily                       ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### Current Redis Key Patterns

All keys are user-scoped (from `packages/cache/src/keys.ts`):

```typescript
// Data keys
candles:${userId}:${exchangeId}:${symbol}:${timeframe}
ticker:${userId}:${exchangeId}:${symbol}
indicator:${userId}:${exchangeId}:${symbol}:${timeframe}:${type}

// Pub/sub channels
channel:candle:${userId}:${exchangeId}:${symbol}:${timeframe}
channel:candle:close:${userId}:${exchangeId}:${symbol}:${timeframe}
channel:ticker:${userId}:${exchangeId}:${symbol}
channel:indicator:${userId}:${exchangeId}:${symbol}:${timeframe}:${type}

// Control channels (user-scoped by identity)
livermore:commands:${identitySub}
livermore:responses:${identitySub}
```

### Current Database Schema

From `packages/database/drizzle/schema.ts`:

```sql
-- user_exchanges: per-user exchange connections
user_exchanges (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  exchange_name VARCHAR(50),           -- 'coinbase', 'binance', etc.
  api_key_env_var VARCHAR(100),        -- 'COINBASE_API_KEY'
  api_secret_env_var VARCHAR(100),     -- 'COINBASE_API_SECRET'
  is_active BOOLEAN,
  is_default BOOLEAN,
  ...
)

-- candles: user-scoped historical data (rarely used, mostly in Redis)
candles (
  user_id INT,
  exchange_id INT REFERENCES user_exchanges(id),
  symbol VARCHAR(20),
  timeframe VARCHAR(5),
  ...
)
```

**Problem:** `user_exchanges` stores exchange NAME (string), not a reference to an exchange metadata table. No centralized exchange configuration exists.

### Current Service Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      CoinbaseAdapter                            │
│  - Hardcoded userId=1, exchangeId=1                            │
│  - Publishes to: channel:candle:close:1:1:{symbol}:5m          │
│  - Writes to: candles:1:1:{symbol}:5m                          │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                  IndicatorCalculationService                    │
│  - Hardcoded TEST_USER_ID=1, TEST_EXCHANGE_ID=1                │
│  - Subscribes: channel:candle:close:1:1:*:*                    │
│  - Reads from: candles:1:1:{symbol}:{timeframe}                │
│  - Writes to: indicator:1:1:{symbol}:{timeframe}:macd-v        │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                   AlertEvaluationService                        │
│  - Hardcoded TEST_USER_ID=1, TEST_EXCHANGE_ID=1                │
│  - Subscribes: channel:ticker:1:1:{symbol}                     │
│  - Subscribes: channel:indicator:1:1:{symbol}:{tf}:macd-v      │
└────────────────────────────────────────────────────────────────┘
```

**Key observation:** Every service hardcodes `userId=1` and `exchangeId=1`. The multi-user/multi-exchange infrastructure exists in the key patterns but isn't actually used.

## Proposed Architecture (v5.0)

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Server (Idle Startup)                        │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        Startup Sequence (v5.0)                       ││
│  │  1. validateEnv()                                                   ││
│  │  2. getDbClient() + testDatabaseConnection()                        ││
│  │  3. getRedisClient() + testRedisConnection()                        ││
│  │  4. Register tRPC routers                                           ││
│  │  5. Start Fastify (IDLE MODE - no exchange connection)              ││
│  │  6. ControlChannelService.start() (listen for 'start' command)      ││
│  │                                                                      ││
│  │  --- AWAIT 'start' COMMAND ---                                      ││
│  │                                                                      ││
│  │  7. Load exchange config from DB                                    ││
│  │  8. Load symbol sources (Tier 1 + Tier 2)                           ││
│  │  9. StartupBackfillService.backfill()                               ││
│  │  10. IndicatorCalculationService.start()                            ││
│  │  11. BoundaryRestService.start()                                    ││
│  │  12. ExchangeAdapter.connect() + subscribe()                        ││
│  │  13. AlertEvaluationService.start()                                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### New Redis Key Patterns

**Shared data (exchange-scoped):**
```typescript
// Data keys - NO userId, shared by all subscribers
candles:${exchangeId}:${symbol}:${timeframe}
ticker:${exchangeId}:${symbol}
indicator:${exchangeId}:${symbol}:${timeframe}:${type}

// Pub/sub channels - NO userId, any subscriber can receive
channel:candle:close:${exchangeId}:${symbol}:${timeframe}
channel:ticker:${exchangeId}:${symbol}
channel:indicator:${exchangeId}:${symbol}:${timeframe}:${type}
```

**Overflow data (user-specific extras):**
```typescript
// User-specific symbols not in shared pool
usercandles:${exchangeId}:${userId}:${symbol}:${timeframe}
userticker:${exchangeId}:${userId}:${symbol}
userindicator:${exchangeId}:${userId}:${symbol}:${timeframe}:${type}

// User-specific channels
channel:usercandle:close:${exchangeId}:${userId}:${symbol}:${timeframe}
```

**Control channels (unchanged - user-scoped by identity):**
```typescript
livermore:commands:${identitySub}
livermore:responses:${identitySub}
```

### New Database Schema

```sql
-- NEW: exchanges table (exchange metadata)
CREATE TABLE exchanges (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,        -- 'coinbase', 'binance', etc.
  display_name VARCHAR(100) NOT NULL,      -- 'Coinbase Pro', 'Binance US'
  api_base_url VARCHAR(255),               -- 'https://api.coinbase.com'
  ws_url VARCHAR(255),                     -- 'wss://advanced-trade-ws.coinbase.com'
  rate_limit_requests_per_second INT,      -- 10
  supported_timeframes JSONB,              -- ['1m', '5m', '15m', '1h', '4h', '1d']
  geo_restrictions JSONB,                  -- {'blocked': ['US'], 'allowed': [...]}
  fee_tier_url VARCHAR(255),               -- URL to fee tier docs
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- MODIFIED: user_exchanges with FK to exchanges
ALTER TABLE user_exchanges
  ADD COLUMN exchange_id INT REFERENCES exchanges(id),
  -- Keep exchange_name for backward compatibility during migration
  ALTER COLUMN exchange_name DROP NOT NULL;

-- Symbol sourcing tables
CREATE TABLE exchange_symbols (
  id SERIAL PRIMARY KEY,
  exchange_id INT REFERENCES exchanges(id),
  symbol VARCHAR(20) NOT NULL,
  tier SMALLINT NOT NULL,                  -- 1=shared (top N), 2=user-specific
  volume_24h NUMERIC(30, 8),               -- For ranking
  last_updated TIMESTAMP DEFAULT NOW(),
  UNIQUE(exchange_id, symbol)
);

-- User symbol overrides (Tier 2)
CREATE TABLE user_symbol_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  exchange_id INT REFERENCES exchanges(id),
  symbol VARCHAR(20) NOT NULL,
  source VARCHAR(20) NOT NULL,             -- 'position', 'manual', 'alert'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, exchange_id, symbol)
);
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Symbol Sourcing                                   │
│                                                                          │
│  Tier 1 (Shared Pool)                   Tier 2 (User Overflow)          │
│  ┌─────────────────────┐                ┌─────────────────────┐         │
│  │ Top 50 by volume    │                │ User positions      │         │
│  │ - Automatic refresh │                │ Manual additions    │         │
│  │ - Shared cache keys │                │ Alert-based adds    │         │
│  └─────────────────────┘                └─────────────────────┘         │
│            │                                      │                      │
│            ▼                                      ▼                      │
│  candles:1:BTC-USD:5m                   usercandles:1:99:SHIB-USD:5m   │
│  (exchangeId only)                      (exchangeId + userId)           │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         ExchangeAdapter                                  │
│  - Configured with exchangeId from DB                                    │
│  - Publishes to: channel:candle:close:{exchangeId}:{symbol}:5m          │
│  - Writes to: candles:{exchangeId}:{symbol}:5m                          │
│  - OR writes to: usercandles:{exchangeId}:{userId}:{symbol}:5m          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    IndicatorCalculationService                           │
│  - Subscribes: channel:candle:close:{exchangeId}:*:*                    │
│  - Reads from: candles:{exchangeId}:{symbol}:{timeframe}                │
│  - Writes to: indicator:{exchangeId}:{symbol}:{timeframe}:macd-v        │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│         Cross-Exchange Subscribers (PerseusWeb, etc.)                    │
│  - Subscribe to ANY exchange's channels                                  │
│  - Kaia's UI can subscribe to: channel:candle:close:1:*:* (Coinbase)    │
│  - Mike's UI can subscribe to: channel:candle:close:2:*:* (Binance)     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Changes

### Redis Key Migration

**Old pattern:**
```
candles:${userId}:${exchangeId}:${symbol}:${timeframe}
         ▲         ▲
         │         │
         └─────────┴── Both user and exchange scoped
```

**New pattern:**
```
candles:${exchangeId}:${symbol}:${timeframe}
         ▲
         │
         └── Exchange-scoped only (shared)

usercandles:${exchangeId}:${userId}:${symbol}:${timeframe}
             ▲            ▲
             │            │
             └────────────┴── User overflow with exchange context
```

**Migration strategy:**

1. **Add new key functions** in `packages/cache/src/keys.ts`:
   ```typescript
   // New exchange-scoped keys (v5.0)
   export function sharedCandleKey(exchangeId: number, symbol: string, timeframe: Timeframe) {
     return `candles:${exchangeId}:${symbol}:${timeframe}`;
   }

   export function userCandleKey(exchangeId: number, userId: number, symbol: string, timeframe: Timeframe) {
     return `usercandles:${exchangeId}:${userId}:${symbol}:${timeframe}`;
   }
   ```

2. **Update cache strategies** to use new key functions with tier awareness:
   ```typescript
   class CandleCacheStrategy {
     async addCandle(exchangeId: number, symbol: string, tier: 1 | 2, userId?: number) {
       const key = tier === 1
         ? sharedCandleKey(exchangeId, symbol, timeframe)
         : userCandleKey(exchangeId, userId!, symbol, timeframe);
       // ... rest unchanged
     }
   }
   ```

3. **Delete old keys on startup** (one-time cleanup):
   ```typescript
   // Delete all keys matching old pattern: candles:*:*:*:*
   // This is safe because we backfill on startup anyway
   ```

4. **Feature flag** for gradual rollout:
   ```typescript
   const USE_SHARED_KEYS = process.env.FEATURE_SHARED_KEYS === 'true';
   ```

### Database Schema Changes

**1. Create `exchanges` table:**
```sql
INSERT INTO exchanges (name, display_name, ws_url, supported_timeframes) VALUES
  ('coinbase', 'Coinbase Pro', 'wss://advanced-trade-ws.coinbase.com', '["5m"]'),
  ('binance', 'Binance US', 'wss://stream.binance.us:9443/ws', '["1m","5m","15m","1h","4h","1d"]');
```

**2. Migrate `user_exchanges`:**
```sql
-- Add FK column
ALTER TABLE user_exchanges ADD COLUMN exchange_id INT REFERENCES exchanges(id);

-- Populate from exchange_name
UPDATE user_exchanges ue
SET exchange_id = e.id
FROM exchanges e
WHERE ue.exchange_name = e.name;

-- Make NOT NULL after population
ALTER TABLE user_exchanges ALTER COLUMN exchange_id SET NOT NULL;
```

**3. Create symbol sourcing tables** (new).

### Service Changes

| Service | v4.0 | v5.0 Change |
|---------|------|-------------|
| `CoinbaseAdapter` | Hardcoded userId=1, exchangeId=1 | Receives exchangeId from config, no userId |
| `IndicatorCalculationService` | Hardcoded TEST_USER_ID, TEST_EXCHANGE_ID | Receives exchangeId from config, no userId |
| `AlertEvaluationService` | Hardcoded TEST_USER_ID, TEST_EXCHANGE_ID | Multi-exchange subscription patterns |
| `BoundaryRestService` | Uses DEFAULT_BOUNDARY_CONFIG | Receives exchangeId from config |
| `StartupBackfillService` | Uses hardcoded userId/exchangeId | Receives exchangeId, supports tier-based symbols |
| `ControlChannelService` | Unchanged (user-scoped by identity) | Add `start` command handler |
| `server.ts` | Immediate startup | Idle mode, await `start` command |

### New Components

**1. ExchangeConfigService:**
```typescript
class ExchangeConfigService {
  async getExchangeById(id: number): Promise<Exchange>;
  async getActiveExchanges(): Promise<Exchange[]>;
  async getExchangeByName(name: string): Promise<Exchange | null>;
}
```

**2. SymbolSourceService:**
```typescript
class SymbolSourceService {
  async getTier1Symbols(exchangeId: number): Promise<string[]>;
  async getTier2Symbols(exchangeId: number, userId: number): Promise<string[]>;
  async mergeSymbols(tier1: string[], tier2: string[]): Promise<SymbolWithTier[]>;
  async refreshTier1FromVolume(exchangeId: number, topN: number): Promise<void>;
}
```

**3. IdleStartupManager:**
```typescript
class IdleStartupManager {
  private state: 'idle' | 'starting' | 'running' = 'idle';

  async awaitStartCommand(): Promise<StartConfig>;
  async startExchange(config: StartConfig): Promise<void>;
}
```

## Build Order

Based on dependency analysis, the recommended phase structure:

### Phase 1: Database Foundation

**Dependencies:** None
**Creates:** Foundation for all other phases

1. Create `exchanges` table with seed data (Coinbase, Binance)
2. Add `exchange_id` FK to `user_exchanges`
3. Create `exchange_symbols` table
4. Create `user_symbol_subscriptions` table
5. Run Atlas migration
6. Verify with `drizzle-kit pull`

**Verification:** Query `exchanges` table, verify FK relationships work.

### Phase 2: Key Pattern Refactor

**Dependencies:** Phase 1 (needs exchangeId concept)
**Creates:** New key functions used by cache strategies

1. Add new key functions to `packages/cache/src/keys.ts`:
   - `sharedCandleKey()`, `sharedTickerKey()`, `sharedIndicatorKey()`
   - `userCandleKey()`, `userTickerKey()`, `userIndicatorKey()`
   - `sharedCandleCloseChannel()`, etc.
2. Add `KeyMode` enum: `'shared' | 'user'`
3. Keep old functions for backward compatibility (deprecate)
4. Write unit tests for new key patterns

**Verification:** Unit tests pass, old functions still work.

### Phase 3: Cache Strategy Updates

**Dependencies:** Phase 2 (uses new key functions)
**Creates:** Tier-aware cache operations

1. Update `CandleCacheStrategy` constructor to accept mode config
2. Add tier parameter to write operations
3. Add fallback reads (check shared first, then user)
4. Update `IndicatorCacheStrategy` similarly
5. Update `TickerCacheStrategy` similarly

**Verification:** Cache writes to correct keys based on tier.

### Phase 4: Service Refactor

**Dependencies:** Phase 3 (uses updated cache strategies)
**Creates:** Services use exchangeId, not hardcoded userId

1. Remove `TEST_USER_ID` and `TEST_EXCHANGE_ID` from all services
2. Add `exchangeId` parameter to service constructors
3. Update `CoinbaseAdapter` to receive config
4. Update `IndicatorCalculationService` subscription patterns
5. Update `BoundaryRestService` config
6. Update `AlertEvaluationService` subscription patterns

**Verification:** Services work with configurable exchangeId.

### Phase 5: Idle Startup Mode

**Dependencies:** Phase 4 (services can be configured)
**Creates:** API starts idle, awaits command

1. Create `IdleStartupManager` class
2. Add `start` command to `ControlChannelService`
3. Refactor `server.ts` startup sequence to be two-phase
4. Add `--autostart <exchange>` CLI parameter for backward compatibility
5. Update `ServiceRegistry` to support dynamic service creation

**Verification:** Server starts idle, responds to `start` command.

### Phase 6: Symbol Sourcing

**Dependencies:** Phases 1, 4, 5 (DB tables, services, idle mode)
**Creates:** Tier 1/Tier 2 symbol management

1. Create `ExchangeConfigService`
2. Create `SymbolSourceService`
3. Implement Tier 1 refresh from exchange volume endpoint
4. Implement Tier 2 aggregation from user positions/manual
5. Integrate with startup sequence
6. Add tRPC endpoints for symbol management

**Verification:** Startup uses correct symbol sources.

### Phase 7: Migration Cleanup

**Dependencies:** All previous phases deployed and stable
**Creates:** Clean state, removed legacy code

1. Remove old key functions (or mark truly deprecated)
2. Remove backward compatibility shims
3. Delete legacy keys from Redis (one-time script)
4. Update documentation

**Verification:** System works with only new key patterns.

## Component Boundaries

### What Talks to What

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            tRPC Routers                                  │
│  settings.router ←───────────────────────────────────────────┐          │
│  control.router ←────────────────────────────────┐           │          │
│  symbol.router ←──────────────────┐              │           │          │
│  indicator.router ←───┐           │              │           │          │
│  alert.router ←──┐    │           │              │           │          │
│                  │    │           │              │           │          │
│                  ▼    ▼           ▼              ▼           ▼          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                         Cache Strategies                             ││
│  │  IndicatorCacheStrategy  CandleCacheStrategy  TickerCacheStrategy   ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                  │    │           │              │           │          │
│                  ▼    ▼           ▼              ▼           ▼          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                         Redis (ioredis)                              ││
│  │  Data: ZADD, ZRANGE, GET, SET                                       ││
│  │  Pub/Sub: PUBLISH, SUBSCRIBE, PSUBSCRIBE                            ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                            Services                                      │
│  CoinbaseAdapter ─────────────► CandleCacheStrategy                     │
│        │                               │                                 │
│        │ candle:close event            │ indicator update               │
│        ▼                               ▼                                 │
│  IndicatorCalculationService ──► IndicatorCacheStrategy                 │
│        │                               │                                 │
│        │ indicator update              │ alert trigger                   │
│        ▼                               ▼                                 │
│  AlertEvaluationService ───────► PostgreSQL (alert_history)             │
│        │                                                                 │
│        └─────────────────────────────► Discord WebhookClient            │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         Control Plane                                    │
│  ControlChannelService ←──── Redis Pub/Sub ←──── Admin UI               │
│        │                                                                 │
│        │ commands                                                        │
│        ▼                                                                 │
│  ServiceRegistry (access to all services)                               │
│        │                                                                 │
│        ├──► CoinbaseAdapter.disconnect() / connect()                    │
│        ├──► IndicatorService.stop() / start()                           │
│        ├──► AlertService.stop() / start()                               │
│        └──► StartupBackfillService.backfill()                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Package Dependencies

```
@livermore/api (apps/api)
  └── @livermore/coinbase-client
  └── @livermore/cache
  └── @livermore/database
  └── @livermore/indicators
  └── @livermore/schemas
  └── @livermore/utils
  └── @livermore/trpc-config

@livermore/coinbase-client
  └── @livermore/cache (for Redis writes)
  └── @livermore/schemas (for types)
  └── @livermore/utils (for logger)

@livermore/cache
  └── @livermore/schemas (for types, Zod validation)

@livermore/database
  └── @livermore/schemas (for types)
  └── @livermore/utils (for logger)

@livermore/indicators
  └── (no internal dependencies - pure math)

@livermore/schemas
  └── (no internal dependencies - pure types)
```

## Risk Assessment

### Low Risk

- Database schema additions (new tables, new columns)
- New key functions (additive, not replacing)
- New services (additive)

### Medium Risk

- Cache strategy updates (need backward compatibility during migration)
- Service constructor changes (need to update all call sites)
- Startup sequence refactor (complex orchestration)

### High Risk

- Redis key migration (data loss if done wrong)
- Removing userId from services (breaks if any hardcoded references remain)

### Mitigation Strategies

1. **Feature flags** for key pattern switch
2. **Parallel writes** during migration (write to both old and new keys)
3. **Startup backfill** ensures no data loss (can delete old keys safely)
4. **Comprehensive testing** at each phase boundary
5. **Rollback plan** at each phase

## Sources

- `packages/cache/src/keys.ts` - Current key patterns
- `packages/cache/src/strategies/candle-cache.ts` - Cache strategy implementation
- `packages/database/drizzle/schema.ts` - Current database schema
- `packages/coinbase-client/src/adapter/coinbase-adapter.ts` - Adapter implementation
- `apps/api/src/server.ts` - Startup sequence
- `apps/api/src/services/indicator-calculation.service.ts` - Service patterns
- `apps/api/src/services/control-channel.service.ts` - Control channel patterns
- `.planning/PROJECT.md` - v5.0 goals and requirements
- `.planning/MILESTONES.md` - Historical context
- `.planning/codebase/ARCHITECTURE.md` - Architecture documentation

---

*Architecture research: 2026-02-06*
