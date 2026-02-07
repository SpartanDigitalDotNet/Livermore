# Phase 24: Data Architecture - Research

**Researched:** 2026-02-07
**Domain:** Redis key patterns for exchange-scoped shared data with backward-compatible migration
**Confidence:** HIGH

## Summary

This phase refactors Redis key patterns from user-scoped (`candles:{userId}:{exchangeId}:...`) to exchange-scoped (`candles:{exchange_id}:...`) for shared data like market candles and indicators. The current architecture scopes all cache keys by userId, causing redundant data storage when multiple users subscribe to the same symbols on the same exchange. By introducing exchange-scoped "Tier 1" keys for shared data and user-scoped "Tier 2" keys for overflow/custom data, the system can share candle data across users while maintaining user-specific overrides.

The key challenge is backward compatibility: existing services use user-scoped keys and must continue working during migration. This requires a dual-read pattern (check exchange-scoped first, fall back to user-scoped) and parallel pub/sub channels until migration completes.

**Primary recommendation:** Add new exchange-scoped key functions alongside existing user-scoped functions (marked deprecated). Implement dual-read in cache strategies. Update pub/sub channels to exchange-scoped format. Existing user-scoped keys remain functional throughout migration.

## Standard Stack

This phase uses the existing Redis infrastructure with ioredis Cluster mode.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | 5.x | Redis client | Already configured for Azure Redis Cluster |
| @livermore/cache | - | Key builders, cache strategies | Central location for key patterns |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @livermore/schemas | - | Timeframe type | Type-safe timeframe parameters |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dual-read pattern | Big-bang migration | Dual-read is safer, allows gradual rollout |
| Exchange-scoped only | Keep user-scoped for all | User-scoped wastes storage for shared data |
| Hash tags for slot control | Natural key distribution | Hash tags add complexity, not needed |

## Architecture Patterns

### Current Key Patterns

From `packages/cache/src/keys.ts`:

```typescript
// Data keys - all user-scoped
candles:{userId}:{exchangeId}:{symbol}:{timeframe}
ticker:{userId}:{exchangeId}:{symbol}
orderbook:{userId}:{exchangeId}:{symbol}
indicator:{userId}:{exchangeId}:{symbol}:{timeframe}:{type}

// Pub/sub channels - all user-scoped
channel:candle:{userId}:{exchangeId}:{symbol}:{timeframe}
channel:candle:close:{userId}:{exchangeId}:{symbol}:{timeframe}
channel:ticker:{userId}:{exchangeId}:{symbol}
channel:orderbook:{userId}:{exchangeId}:{symbol}
channel:indicator:{userId}:{exchangeId}:{symbol}:{timeframe}:{type}
channel:alerts:{userId}
```

### Proposed Tiered Key Patterns

**Tier 1: Exchange-Scoped (Shared)**
```typescript
// Shared candle data - same for all users on same exchange
candles:{exchange_id}:{symbol}:{timeframe}

// Shared indicator values - computed from shared candles
indicator:{exchange_id}:{symbol}:{timeframe}:{type}

// Pub/sub for shared data
channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}
channel:exchange:{exchange_id}:indicator:{symbol}:{timeframe}:{type}
```

**Tier 2: User-Scoped (Overflow)**
```typescript
// User-specific candle overrides or custom symbols
usercandles:{userId}:{exchange_id}:{symbol}:{timeframe}

// User-specific indicator overrides
userindicator:{userId}:{exchange_id}:{symbol}:{timeframe}:{type}
```

### Recommended Project Structure

```
packages/cache/src/
├── keys.ts                 # Key builders (add exchange-scoped, deprecate user-scoped)
├── client.ts               # Redis client (unchanged)
└── strategies/
    ├── candle-cache.ts     # Add dual-read logic
    ├── indicator-cache.ts  # Add dual-read logic
    ├── ticker-cache.ts     # Unchanged (user-scoped makes sense for tickers)
    └── orderbook-cache.ts  # Unchanged (user-scoped makes sense for orderbooks)
```

### Pattern 1: Dual-Read Cache Strategy

**What:** Cache strategies read from exchange-scoped key first, fall back to user-scoped key if empty.
**When to use:** During migration period when some data may still be in user-scoped keys.
**Example:**
```typescript
// packages/cache/src/strategies/candle-cache.ts
async getRecentCandles(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  count: number = 100
): Promise<Candle[]> {
  // Tier 1: Try exchange-scoped key first (shared data)
  const sharedKey = exchangeCandleKey(exchangeId, symbol, timeframe);
  let results = await this.redis.zrange(sharedKey, -count, -1);

  // Tier 2: Fall back to user-scoped key (legacy or overflow)
  if (results.length === 0) {
    const userKey = candleKey(userId, exchangeId, symbol, timeframe);
    results = await this.redis.zrange(userKey, -count, -1);
  }

  return results.map((json) => CandleSchema.parse(JSON.parse(json)));
}
```

### Pattern 2: Tiered Write Strategy

**What:** Write to exchange-scoped key by default for shared symbols, user-scoped for overflow.
**When to use:** When writing candles from WebSocket or REST backfill.
**Example:**
```typescript
// Tier parameter: 1 = shared (exchange-scoped), 2 = overflow (user-scoped)
async addCandle(
  userId: number,
  exchangeId: number,
  candle: Candle,
  tier: 1 | 2 = 1  // Default to shared
): Promise<void> {
  const key = tier === 1
    ? exchangeCandleKey(exchangeId, candle.symbol, candle.timeframe)
    : userCandleKey(userId, exchangeId, candle.symbol, candle.timeframe);

  await this.redis.zremrangebyscore(key, candle.timestamp, candle.timestamp);
  await this.redis.zadd(key, candle.timestamp, JSON.stringify(candle));

  // TTL only for user overflow (Tier 2)
  if (tier === 2) {
    const ttlSeconds = HARDCODED_CONFIG.cache.userOverflowTtlHours * 3600;
    await this.redis.expire(key, ttlSeconds);
  }
}
```

### Pattern 3: Exchange-Scoped Pub/Sub Channels

**What:** Candle close events published to exchange-scoped channels (no userId).
**When to use:** For indicator service subscription - same data for all users.
**Example:**
```typescript
// Publisher (coinbase-adapter.ts)
async onCandleClose(candle: UnifiedCandle): Promise<void> {
  // NEW: Exchange-scoped channel (shared)
  const sharedChannel = exchangeCandleCloseChannel(
    this.exchangeIdNum,
    candle.symbol,
    candle.timeframe
  );
  await this.redis.publish(sharedChannel, JSON.stringify(candle));

  // LEGACY: User-scoped channel (for backward compat during migration)
  const userChannel = candleCloseChannel(
    this.userId,
    this.exchangeIdNum,
    candle.symbol,
    candle.timeframe
  );
  await this.redis.publish(userChannel, JSON.stringify(candle));
}

// Subscriber (indicator-calculation.service.ts)
async start(configs: IndicatorConfig[]): Promise<void> {
  // NEW: Subscribe to exchange-scoped pattern
  const pattern = `channel:exchange:${this.exchangeId}:candle:close:*:*`;
  await this.subscriber.psubscribe(pattern);

  this.subscriber.on('pmessage', (_pattern, channel, message) => {
    // Parse: "channel:exchange:1:candle:close:BTC-USD:5m"
    const parts = channel.split(':');
    const symbol = parts[5];
    const timeframe = parts[6] as Timeframe;
    // ...
  });
}
```

### Anti-Patterns to Avoid

- **Breaking existing key functions:** Keep legacy functions with `@deprecated` JSDoc, don't delete
- **Single-step migration:** Use dual-read/dual-write during transition, not big-bang
- **Forgetting pub/sub migration:** Both data keys AND channels need updating
- **Inconsistent tier parameter:** Always default to Tier 1 (shared) for standard operations
- **TTL on shared data:** Only apply TTL to Tier 2 (user overflow) keys

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Key string formatting | Template literals scattered in code | Centralized key builder functions | Single source of truth, easy migration |
| Tier selection logic | Per-call decision making | Default to Tier 1 in cache strategies | Consistency, simpler call sites |
| Dual-read fallback | Manual checks at each call site | Built into cache strategy methods | DRY, encapsulated complexity |
| Channel format parsing | Regex at each subscriber | Centralized channel parser helper | Consistent parsing, easier updates |

## Common Pitfalls

### Pitfall 1: Redis Cluster Cross-Slot Operations

**What goes wrong:** CROSSSLOT error when trying to operate on multiple keys in different hash slots.
**Why it happens:** Cluster mode hashes each key to a slot; multi-key operations require same slot.
**How to avoid:** Use individual key operations (no MGET across different key prefixes).
**Warning signs:** `CROSSSLOT Keys in request don't hash to the same slot` error.

**Already handled in codebase:**
```typescript
// packages/cache/src/strategies/indicator-cache.ts
// Use individual GET calls for Azure Redis Cluster compatibility (avoids CROSSSLOT errors)
const results = await Promise.all(keys.map((key) => this.redis.get(key)));
```

### Pitfall 2: Breaking Channel Parse Assumptions

**What goes wrong:** Indicator service parses wrong indices after channel format change.
**Why it happens:** Hardcoded index parsing: `const symbol = parts[5]`.
**How to avoid:** Update channel parsing logic when adding new key patterns.
**Warning signs:** Indicator recalculation triggered for wrong symbol/timeframe.

**Current code (needs update):**
```typescript
// apps/api/src/services/indicator-calculation.service.ts
// Parse channel: "channel:candle:close:1:1:BTC-USD:5m"
// Indices:        0       1      2     3 4 5        6
const parts = channel.split(':');
const symbol = parts[5];
const timeframe = parts[6] as Timeframe;
```

**New parsing for exchange-scoped:**
```typescript
// Parse channel: "channel:exchange:1:candle:close:BTC-USD:5m"
// Indices:        0        1       2 3      4     5       6
const parts = channel.split(':');
const symbol = parts[5];
const timeframe = parts[6] as Timeframe;
// Note: Same indices! But different meaning for parts[2] (exchange_id vs userId)
```

### Pitfall 3: Dual Pub/Sub During Migration

**What goes wrong:** Services only subscribe to new channel format, miss events.
**Why it happens:** Publishers updated before subscribers.
**How to avoid:**
  1. Update publishers to publish to BOTH old and new channels
  2. Update subscribers to listen to new channel
  3. Remove old channel publishing after migration complete
**Warning signs:** Indicator service stops receiving candle:close events.

### Pitfall 4: TTL on Shared Data

**What goes wrong:** Shared exchange candles expire, all users lose data.
**Why it happens:** Copying TTL logic from user-scoped to exchange-scoped.
**How to avoid:** Only apply TTL to Tier 2 (user overflow) keys.
**Warning signs:** Candle count drops to zero after 24 hours.

### Pitfall 5: Forgetting TEST_USER_ID/TEST_EXCHANGE_ID References

**What goes wrong:** Hardcoded `TEST_USER_ID = 1` still used after migration.
**Why it happens:** Constants scattered across multiple services.
**How to avoid:** Search for all TEST_USER_ID references, refactor to use exchange-scoped.
**Warning signs:** Data still written to user-scoped keys.

**Files with hardcoded TEST_USER_ID:**
- `apps/api/src/services/indicator-calculation.service.ts`
- `apps/api/src/services/coinbase-websocket.service.ts`
- `apps/api/src/services/alert-evaluation.service.ts`
- `apps/api/src/routers/position.router.ts`
- `apps/api/src/routers/indicator.router.ts`
- `apps/api/src/routers/alert.router.ts`

## Code Examples

### New Key Functions

```typescript
// packages/cache/src/keys.ts

// ============================================
// TIER 1: Exchange-Scoped Keys (Shared Data)
// ============================================

/**
 * Build a cache key for exchange-scoped candles (shared across users)
 * Tier 1: All users on same exchange share this data
 */
export function exchangeCandleKey(
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `candles:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Build a cache key for exchange-scoped indicators (shared across users)
 * Tier 1: Computed from shared candle data
 */
export function exchangeIndicatorKey(
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  type: string,
  params?: Record<string, unknown>
): string {
  const base = `indicator:${exchangeId}:${symbol}:${timeframe}:${type}`;
  if (!params) return base;

  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join(',');

  return `${base}:${sortedParams}`;
}

/**
 * Build a Redis pub/sub channel for exchange-scoped candle close events
 * Used by all users subscribing to same exchange/symbol
 */
export function exchangeCandleCloseChannel(
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:exchange:${exchangeId}:candle:close:${symbol}:${timeframe}`;
}

/**
 * Build a Redis psubscribe pattern for exchange-scoped candle close events
 */
export function exchangeCandleClosePattern(
  exchangeId: number,
  symbol: string, // Can be '*' for wildcard
  timeframe: Timeframe | '*'
): string {
  return `channel:exchange:${exchangeId}:candle:close:${symbol}:${timeframe}`;
}

// ============================================
// TIER 2: User-Scoped Keys (Overflow Data)
// ============================================

/**
 * Build a cache key for user-specific candle overflow
 * Tier 2: User-specific data with TTL
 */
export function userCandleKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `usercandles:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * Build a cache key for user-specific indicator overflow
 * Tier 2: User-specific with TTL
 */
export function userIndicatorKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  type: string
): string {
  return `userindicator:${userId}:${exchangeId}:${symbol}:${timeframe}:${type}`;
}

// ============================================
// LEGACY: User-Scoped Keys (Deprecated)
// ============================================

/**
 * @deprecated Use exchangeCandleKey for shared data or userCandleKey for overflow
 * Kept for backward compatibility during migration
 */
export function candleKey(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `candles:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}

/**
 * @deprecated Use exchangeCandleCloseChannel for shared events
 * Kept for backward compatibility during migration
 */
export function candleCloseChannel(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe
): string {
  return `channel:candle:close:${userId}:${exchangeId}:${symbol}:${timeframe}`;
}
```

### Cache Strategy with Dual-Read

```typescript
// packages/cache/src/strategies/candle-cache.ts

/**
 * Get recent candles using dual-read pattern
 * Tries exchange-scoped (Tier 1) first, falls back to user-scoped (legacy)
 */
async getRecentCandles(
  userId: number,
  exchangeId: number,
  symbol: string,
  timeframe: Timeframe,
  count: number = 100
): Promise<Candle[]> {
  // Tier 1: Try exchange-scoped key first (shared data)
  const exchangeKey = exchangeCandleKey(exchangeId, symbol, timeframe);
  let results = await this.redis.zrange(exchangeKey, -count, -1);

  // Fall back to legacy user-scoped key during migration
  if (results.length === 0) {
    const legacyKey = candleKey(userId, exchangeId, symbol, timeframe);
    results = await this.redis.zrange(legacyKey, -count, -1);
  }

  // Tier 2: Check user overflow if still empty (future feature)
  if (results.length === 0) {
    const overflowKey = userCandleKey(userId, exchangeId, symbol, timeframe);
    results = await this.redis.zrange(overflowKey, -count, -1);
  }

  return results.map((json) => CandleSchema.parse(JSON.parse(json)));
}
```

### Indicator Service Subscription Update

```typescript
// apps/api/src/services/indicator-calculation.service.ts

async start(configs: IndicatorConfig[]): Promise<void> {
  // ...existing setup...

  // Subscribe to exchange-scoped candle:close events (Phase 24 pattern)
  const pattern = exchangeCandleClosePattern(
    this.exchangeId,  // Now uses exchangeId instead of TEST_USER_ID
    '*',              // All symbols
    '*'               // All timeframes
  );
  await this.subscriber.psubscribe(pattern);

  this.subscriber.on('pmessage', (_pattern, channel, message) => {
    // Parse: "channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}"
    const parts = channel.split(':');
    const exchangeId = parseInt(parts[2], 10);
    const symbol = parts[5];
    const timeframe = parts[6] as Timeframe;

    // Process with exchange context
    this.handleCandleCloseEvent(exchangeId, symbol, timeframe, message);
  });
}
```

## Services Requiring Updates

| Service | File | Change Required |
|---------|------|-----------------|
| CandleCacheStrategy | `packages/cache/src/strategies/candle-cache.ts` | Dual-read, tier parameter |
| IndicatorCacheStrategy | `packages/cache/src/strategies/indicator-cache.ts` | Dual-read, tier parameter |
| IndicatorCalculationService | `apps/api/src/services/indicator-calculation.service.ts` | Exchange-scoped subscription |
| CoinbaseAdapter | `packages/coinbase-client/src/adapter/coinbase-adapter.ts` | Dual-publish, exchange-scoped writes |
| BoundaryRestService | `packages/coinbase-client/src/reconciliation/boundary-rest-service.ts` | Exchange-scoped subscription |
| StartupBackfillService | `packages/coinbase-client/src/backfill/startup-backfill-service.ts` | Exchange-scoped writes |
| AlertEvaluationService | `apps/api/src/services/alert-evaluation.service.ts` | Remove TEST_USER_ID dependency |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| User-scoped candle keys | Exchange-scoped (Tier 1) + User overflow (Tier 2) | This phase | Shared data reduces storage, enables multi-user |
| User-scoped pub/sub channels | Exchange-scoped channels | This phase | Single event stream per exchange/symbol |
| Hardcoded TEST_USER_ID | Exchange ID from database | This phase | Proper multi-exchange support |

## Open Questions

1. **When should Tier 2 (user overflow) be used?**
   - What we know: Tier 1 handles shared exchange data
   - What's unclear: Specific use cases for user-specific candles
   - Recommendation: Implement infrastructure now, define use cases in future phase

2. **Should ticker/orderbook migrate to exchange-scoped?**
   - What we know: Tickers have user-scoped TTL (60s), orderbooks similar
   - What's unclear: Whether sharing makes sense for real-time price data
   - Recommendation: Keep user-scoped for now, revisit if storage becomes issue

3. **How to handle exchange_id lookup?**
   - What we know: Phase 23 created `exchanges` table with id
   - What's unclear: Whether to pass exchange_id everywhere or derive from context
   - Recommendation: Inject exchange_id at service initialization, not per-call

## Sources

### Primary (HIGH confidence)
- `packages/cache/src/keys.ts` - Current key patterns verified
- `packages/cache/src/strategies/*.ts` - Cache strategy implementations verified
- `packages/coinbase-client/src/adapter/coinbase-adapter.ts` - Pub/sub publishing verified
- `apps/api/src/services/indicator-calculation.service.ts` - Subscription pattern verified

### Secondary (MEDIUM confidence)
- Phase 23 RESEARCH.md - exchanges table structure
- `packages/database/drizzle/schema.ts` - Database schema with exchange_id

### Tertiary (LOW confidence)
- ioredis Cluster documentation for pub/sub behavior (training data, not verified)

## Metadata

**Confidence breakdown:**
- Current key patterns: HIGH - Directly verified from codebase
- Dual-read pattern: HIGH - Standard migration pattern
- Pub/sub channel migration: HIGH - Clear implementation path
- ioredis Cluster pub/sub: MEDIUM - Standard behavior but not explicitly tested

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (internal architecture, stable)
