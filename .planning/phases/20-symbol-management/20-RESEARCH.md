# Phase 20: Symbol Management - Research

**Researched:** 2026-01-31
**Domain:** Exchange API Integration, Command Handlers, Symbol Validation
**Confidence:** HIGH

## Summary

Phase 20 implements dynamic symbol management allowing users to add/remove symbols from their watchlist with exchange validation. The codebase already has:

1. **Command infrastructure ready** - `CommandTypeSchema` includes `add-symbol` and `remove-symbol` types, `ControlChannelService` has stub handlers
2. **Settings storage ready** - `UserSettingsSchema` has `symbols: z.array(z.string()).optional()` field in JSONB
3. **Coinbase API client ready** - `CoinbaseRestClient.getProducts()` and `CoinbaseRestClient.getProduct()` methods exist for symbol validation
4. **tRPC patterns established** - `settingsRouter` demonstrates JSONB patch operations via `jsonb_set`

**Primary recommendation:** Implement symbol validation in Admin UI (per user constraint), use existing `CoinbaseRestClient` for validation, extend `ControlChannelService` handlers to update `monitoredSymbols` and restart services with new symbol list.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@livermore/coinbase-client` | local | Exchange API client | Already has `getProducts()`, `getProduct()` methods |
| `@livermore/schemas` | local | Zod schemas | Already has `UserSettingsSchema` with `symbols` field |
| `@livermore/trpc-config` | local | tRPC procedures | Already has `protectedProcedure` pattern |
| `drizzle-orm` | existing | Database queries | Already used for `jsonb_set` operations |

### Supporting (Admin UI)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-query` | via tRPC | Data fetching | For symbol search/validation in Admin UI |
| `react-hook-form` | existing | Form handling | For add symbol form |
| `zod` | existing | Validation | Client-side validation before API call |

### No New Dependencies Needed
The codebase has all required infrastructure. No new packages required.

## Architecture Patterns

### Component Responsibilities

```
Admin UI (apps/admin)
  |
  | 1. User enters symbol (e.g., "SOL-USD")
  | 2. Admin calls tRPC endpoint to validate against Coinbase
  | 3. On success, Admin publishes command to Redis
  v
tRPC Router (apps/api/src/routers/symbol.router.ts) [NEW]
  |
  | - symbol.search: Search available symbols from exchange
  | - symbol.validate: Validate symbol exists on exchange + get metrics
  | - symbol.bulkValidate: Validate array of symbols
  v
ControlChannelService (apps/api/src/services/control-channel.service.ts)
  |
  | - handleAddSymbol: Add to settings + restart services
  | - handleRemoveSymbol: Remove from settings + cleanup + restart services
  v
ServiceRegistry
  |
  | - Update monitoredSymbols array
  | - Restart affected services (CoinbaseAdapter, IndicatorService, etc.)
  v
PostgreSQL (users.settings JSONB)
  |
  | - symbols: ["BTC-USD", "ETH-USD", "SOL-USD"]
```

### Pattern 1: Symbol Validation Flow (Admin UI)

**What:** Admin UI validates symbols against exchange before sending command
**When to use:** When user adds a new symbol
**Why in Admin:** User mandated "IT IS MANDATORY THAT WE VERIFY THE SYMBOLS WITH THE EXCHANGE ONLY IN ADMIN (NOT API)"

```typescript
// Admin UI - SymbolManager.tsx
const addSymbol = async (symbol: string) => {
  // 1. Validate against exchange via tRPC (Admin calls API)
  const validation = await trpc.symbol.validate.query({ symbol });

  if (!validation.valid) {
    toast.error(`Invalid symbol: ${validation.error}`);
    return;
  }

  // 2. Show metrics preview (24h volume, price)
  setPreview(validation.metrics);

  // 3. On user confirmation, publish command to Redis
  await publishCommand({
    type: 'add-symbol',
    payload: {
      symbol,
      metrics: validation.metrics // Include validated metrics
    }
  });
};
```

### Pattern 2: Command Handler with Service Restart

**What:** Command handler updates settings and restarts affected services
**When to use:** For add-symbol and remove-symbol commands

```typescript
// control-channel.service.ts
private async handleAddSymbol(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!this.services) {
    throw new Error('Services not initialized');
  }

  const symbol = payload?.symbol as string;
  if (!symbol) {
    throw new Error('symbol is required in payload');
  }

  // 1. Get current settings from database
  const [user] = await this.services.db
    .select({ settings: users.settings })
    .from(users)
    .where(/* identity match */);

  const currentSymbols = user.settings?.symbols ?? [];

  // 2. Check if already exists
  if (currentSymbols.includes(symbol)) {
    return { status: 'already_exists', symbol };
  }

  // 3. Update settings in database (atomic JSONB operation)
  const newSymbols = [...currentSymbols, symbol];
  await this.services.db.execute(sql`
    UPDATE users
    SET settings = jsonb_set(COALESCE(settings, '{}'), '{symbols}', ${JSON.stringify(newSymbols)}::jsonb, true)
    WHERE /* identity match */
  `);

  // 4. Update ServiceRegistry
  this.services.monitoredSymbols.push(symbol);

  // 5. Restart services with new symbol (if not paused)
  if (!this.isPaused) {
    // Add new indicator configs
    const newConfigs = this.services.timeframes.map(tf => ({ symbol, timeframe: tf }));
    await this.services.indicatorService.addConfigs(newConfigs);

    // Resubscribe WebSocket with updated list
    this.services.coinbaseAdapter.subscribe(this.services.monitoredSymbols, '5m');

    // Update BoundaryRestService
    await this.services.boundaryRestService.addSymbol(symbol);

    // Update AlertService
    await this.services.alertService.addSymbol(symbol, this.services.timeframes);

    // Trigger backfill for new symbol
    const backfillService = new StartupBackfillService(
      this.services.config.apiKeyId,
      this.services.config.privateKeyPem,
      this.services.redis
    );
    await backfillService.backfill([symbol], this.services.timeframes);
  }

  return {
    added: true,
    symbol,
    totalSymbols: this.services.monitoredSymbols.length,
    timestamp: Date.now(),
  };
}
```

### Pattern 3: Delta-Based Validation (SYM-03)

**What:** Only validate symbols that are new (not already in user's list)
**When to use:** For bulk import to avoid redundant API calls

```typescript
// symbol.router.ts
bulkValidate: protectedProcedure
  .input(z.object({
    symbols: z.array(z.string()),
    skipExisting: z.boolean().default(true)
  }))
  .query(async ({ ctx, input }) => {
    // Get user's current symbols
    const [user] = await db.select(/* ... */);
    const existing = new Set(user.settings?.symbols ?? []);

    // Filter to only new symbols (delta)
    const toValidate = input.skipExisting
      ? input.symbols.filter(s => !existing.has(s))
      : input.symbols;

    // Validate new symbols against exchange
    const results = await Promise.all(
      toValidate.map(async (symbol) => {
        try {
          const product = await coinbaseClient.getProduct(symbol);
          return {
            symbol,
            valid: product.status === 'online' && !product.trading_disabled,
            metrics: {
              price: parseFloat(product.price),
              volume24h: parseFloat(product.volume_24h),
              change24h: parseFloat(product.price_percentage_change_24h),
            }
          };
        } catch {
          return { symbol, valid: false, error: 'Not found' };
        }
      })
    );

    return { results, skipped: existing.size };
  });
```

### Anti-Patterns to Avoid

- **Validating in API command handler:** User explicitly mandated validation in Admin UI only
- **Restarting all services:** Only restart/update services that need the new symbol
- **Storing validation results:** Don't cache validation - always validate fresh against exchange
- **Modifying monitoredSymbols without db sync:** Always update database first, then memory

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exchange API auth | Custom JWT signing | `CoinbaseRestClient` | Already handles JWT, rate limiting |
| JSONB updates | String concatenation | `drizzle-orm/sql` with `jsonb_set` | Atomic, handles nulls |
| Symbol search | Custom fuzzy search | `getProducts()` + filter | API returns all products |
| Service restart | Custom orchestration | Extend existing pause/resume | Already has dependency order |

**Key insight:** The codebase already has 90% of the infrastructure. This phase is primarily about wiring existing pieces together.

## Common Pitfalls

### Pitfall 1: Race Condition on Symbol List Updates

**What goes wrong:** Multiple add-symbol commands arrive simultaneously, one overwrites the other
**Why it happens:** Reading symbols, adding one, writing back is not atomic
**How to avoid:** Use PostgreSQL `jsonb_set` with array append, not read-modify-write

```sql
-- WRONG: Read, modify in JS, write back
-- RIGHT: Atomic append
UPDATE users
SET settings = jsonb_set(
  COALESCE(settings, '{}'),
  '{symbols}',
  COALESCE(settings->'symbols', '[]'::jsonb) || '"SOL-USD"'::jsonb
)
WHERE id = $1;
```

**Warning signs:** Symbols disappearing after concurrent adds

### Pitfall 2: Service Restart Without Backfill

**What goes wrong:** New symbol added but has no historical data, indicators show N/A
**Why it happens:** Adding symbol to WebSocket subscription without backfilling cache first
**How to avoid:** Always backfill before adding to live services

```typescript
// Correct order:
// 1. Backfill historical data
await backfillService.backfill([symbol], timeframes);
// 2. Force indicator calculation from backfilled data
for (const tf of timeframes) {
  await indicatorService.forceRecalculate(symbol, tf);
}
// 3. Then add to live subscriptions
coinbaseAdapter.subscribe(monitoredSymbols, '5m');
```

**Warning signs:** New symbol shows "N/A" for all indicators

### Pitfall 3: Binance vs Coinbase Symbol Format

**What goes wrong:** User types "SOLUSD" (Binance format) but Coinbase expects "SOL-USD"
**Why it happens:** Different exchanges use different symbol formats
**How to avoid:** Normalize symbol format before validation

```typescript
// Symbol normalization
function normalizeSymbol(input: string, exchange: 'coinbase' | 'binance'): string {
  // Remove whitespace
  const clean = input.trim().toUpperCase();

  if (exchange === 'coinbase') {
    // Coinbase uses BASE-QUOTE format (e.g., "BTC-USD")
    if (!clean.includes('-')) {
      // Try to split at common quote currencies
      const quotes = ['USD', 'USDC', 'USDT', 'EUR', 'GBP'];
      for (const quote of quotes) {
        if (clean.endsWith(quote)) {
          const base = clean.slice(0, -quote.length);
          return `${base}-${quote}`;
        }
      }
    }
    return clean;
  }

  // Binance uses BASQUOTE format (e.g., "BTCUSDT")
  return clean.replace('-', '');
}
```

**Warning signs:** "Symbol not found" errors when user expects it to work

### Pitfall 4: Not Cleaning Up Removed Symbols

**What goes wrong:** Removed symbols still have stale data in Redis cache
**Why it happens:** Removing from settings doesn't clean up cached data
**How to avoid:** Use existing `cleanupExcludedSymbols` pattern from server.ts

```typescript
// From server.ts - reuse this pattern
async function cleanupSymbolCache(
  redis: Redis,
  symbol: string,
  timeframes: Timeframe[]
): Promise<void> {
  const userId = 1;
  const exchangeId = 1;
  const keysToDelete: string[] = [];

  keysToDelete.push(`ticker:${userId}:${exchangeId}:${symbol}`);

  for (const timeframe of timeframes) {
    keysToDelete.push(`candles:${userId}:${exchangeId}:${symbol}:${timeframe}`);
    keysToDelete.push(`indicator:${userId}:${exchangeId}:${symbol}:${timeframe}:macd-v`);
  }

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
}
```

**Warning signs:** Old data showing up after re-adding previously removed symbol

## Code Examples

### Example 1: Symbol Search Endpoint (tRPC)

```typescript
// apps/api/src/routers/symbol.router.ts
import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { CoinbaseRestClient } from '@livermore/coinbase-client';

export const symbolRouter = router({
  /**
   * Search available symbols from exchange
   * SYM-04: Symbol search endpoint fetches available symbols from user's exchange
   */
  search: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(20),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      // Get user's exchange from settings
      const exchange = await getUserExchange(ctx.auth.userId);

      if (exchange === 'coinbase') {
        const client = getCoinbaseClient();
        const products = await client.getProducts();

        // Filter by query (case-insensitive)
        const query = input.query.toUpperCase();
        const matches = products
          .filter(p =>
            p.product_id.includes(query) ||
            p.base_display_symbol?.includes(query)
          )
          .filter(p => p.status === 'online' && !p.trading_disabled)
          .slice(0, input.limit)
          .map(p => ({
            symbol: p.product_id,
            baseName: p.base_name,
            quoteName: p.quote_name,
          }));

        return { results: matches, exchange: 'coinbase' };
      }

      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported exchange' });
    }),

  /**
   * Validate a symbol and get metrics preview
   * SYM-03: Admin verifies symbols against exchange API
   * SYM-06: Symbol metrics preview (24h volume, price) before adding
   */
  validate: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
    }))
    .query(async ({ ctx, input }) => {
      const exchange = await getUserExchange(ctx.auth.userId);
      const symbol = normalizeSymbol(input.symbol, exchange);

      if (exchange === 'coinbase') {
        try {
          const client = getCoinbaseClient();
          const product = await client.getProduct(symbol);

          if (product.trading_disabled || product.status !== 'online') {
            return {
              valid: false,
              symbol,
              error: 'Symbol is not available for trading',
            };
          }

          return {
            valid: true,
            symbol,
            metrics: {
              price: product.price,
              priceChange24h: product.price_percentage_change_24h,
              volume24h: product.volume_24h,
              baseName: product.base_name,
              quoteName: product.quote_name,
            },
          };
        } catch (error) {
          return {
            valid: false,
            symbol,
            error: 'Symbol not found on exchange',
          };
        }
      }

      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported exchange' });
    }),
});
```

### Example 2: Add Symbol Command Handler

```typescript
// apps/api/src/services/control-channel.service.ts (extend existing)

/**
 * Handle add-symbol command (SYM-01)
 * Adds symbol to user's watchlist and starts monitoring
 */
private async handleAddSymbol(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!this.services) {
    throw new Error('Services not initialized');
  }

  const symbol = payload?.symbol as string;
  if (!symbol) {
    throw new Error('symbol is required in payload');
  }

  // Normalize symbol format
  const normalizedSymbol = symbol.toUpperCase().trim();

  logger.info({ symbol: normalizedSymbol }, 'Adding symbol to watchlist');

  // 1. Get current symbols from database
  const result = await this.services.db
    .select({ settings: users.settings })
    .from(users)
    .where(
      and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, this.identitySub)
      )
    )
    .limit(1);

  if (result.length === 0) {
    throw new Error(`User not found: ${this.identitySub}`);
  }

  const currentSymbols: string[] = result[0].settings?.symbols ?? [];

  // 2. Check if already exists
  if (currentSymbols.includes(normalizedSymbol)) {
    logger.info({ symbol: normalizedSymbol }, 'Symbol already in watchlist');
    return {
      status: 'already_exists',
      symbol: normalizedSymbol,
      message: 'Symbol is already in your watchlist',
    };
  }

  // 3. Update database (atomic JSONB operation)
  const newSymbols = [...currentSymbols, normalizedSymbol];
  await this.services.db.execute(sql`
    UPDATE users
    SET settings = jsonb_set(
      COALESCE(settings, '{}'),
      '{symbols}',
      ${JSON.stringify(newSymbols)}::jsonb,
      true
    ),
    updated_at = NOW()
    WHERE identity_provider = 'clerk' AND identity_sub = ${this.identitySub}
  `);

  // 4. Update in-memory list
  this.services.monitoredSymbols.push(normalizedSymbol);

  // 5. If not paused, start monitoring the new symbol
  if (!this.isPaused) {
    // 5a. Backfill historical data first
    const backfillService = new StartupBackfillService(
      this.services.config.apiKeyId,
      this.services.config.privateKeyPem,
      this.services.redis
    );
    await backfillService.backfill([normalizedSymbol], this.services.timeframes);

    // 5b. Add indicator configs and force calculation
    const newConfigs = this.services.timeframes.map(tf => ({
      symbol: normalizedSymbol,
      timeframe: tf
    }));
    this.services.indicatorConfigs.push(...newConfigs);

    // Force indicator warmup
    for (const tf of this.services.timeframes) {
      await this.services.indicatorService.forceRecalculate(normalizedSymbol, tf);
    }

    // 5c. Resubscribe WebSocket with updated symbol list
    this.services.coinbaseAdapter.subscribe(this.services.monitoredSymbols, '5m');

    // 5d. Update BoundaryRestService
    await this.services.boundaryRestService.addSymbol(normalizedSymbol);

    // 5e. Update AlertService
    await this.services.alertService.addSymbol(normalizedSymbol, this.services.timeframes);
  }

  logger.info(
    { symbol: normalizedSymbol, totalSymbols: this.services.monitoredSymbols.length },
    'Symbol added to watchlist'
  );

  return {
    added: true,
    symbol: normalizedSymbol,
    totalSymbols: this.services.monitoredSymbols.length,
    backfilled: !this.isPaused,
    timestamp: Date.now(),
  };
}
```

### Example 3: Remove Symbol Command Handler

```typescript
/**
 * Handle remove-symbol command (SYM-02)
 * Removes symbol from watchlist and cleans up
 */
private async handleRemoveSymbol(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!this.services) {
    throw new Error('Services not initialized');
  }

  const symbol = payload?.symbol as string;
  if (!symbol) {
    throw new Error('symbol is required in payload');
  }

  const normalizedSymbol = symbol.toUpperCase().trim();

  logger.info({ symbol: normalizedSymbol }, 'Removing symbol from watchlist');

  // 1. Get current symbols
  const result = await this.services.db
    .select({ settings: users.settings })
    .from(users)
    .where(
      and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, this.identitySub)
      )
    )
    .limit(1);

  if (result.length === 0) {
    throw new Error(`User not found: ${this.identitySub}`);
  }

  const currentSymbols: string[] = result[0].settings?.symbols ?? [];

  // 2. Check if exists
  if (!currentSymbols.includes(normalizedSymbol)) {
    return {
      status: 'not_found',
      symbol: normalizedSymbol,
      message: 'Symbol not in watchlist',
    };
  }

  // 3. Update database
  const newSymbols = currentSymbols.filter(s => s !== normalizedSymbol);
  await this.services.db.execute(sql`
    UPDATE users
    SET settings = jsonb_set(
      COALESCE(settings, '{}'),
      '{symbols}',
      ${JSON.stringify(newSymbols)}::jsonb,
      true
    ),
    updated_at = NOW()
    WHERE identity_provider = 'clerk' AND identity_sub = ${this.identitySub}
  `);

  // 4. Update in-memory list
  const idx = this.services.monitoredSymbols.indexOf(normalizedSymbol);
  if (idx > -1) {
    this.services.monitoredSymbols.splice(idx, 1);
  }

  // 5. Clean up Redis cache for removed symbol
  await this.cleanupSymbolCache(normalizedSymbol);

  // 6. If not paused, update running services
  if (!this.isPaused) {
    // Remove from indicator configs
    this.services.indicatorConfigs = this.services.indicatorConfigs.filter(
      c => c.symbol !== normalizedSymbol
    );

    // Resubscribe WebSocket without removed symbol
    this.services.coinbaseAdapter.unsubscribe([normalizedSymbol], '5m');
    this.services.coinbaseAdapter.subscribe(this.services.monitoredSymbols, '5m');

    // Update other services
    await this.services.boundaryRestService.removeSymbol(normalizedSymbol);
    await this.services.alertService.removeSymbol(normalizedSymbol);
  }

  logger.info(
    { symbol: normalizedSymbol, totalSymbols: this.services.monitoredSymbols.length },
    'Symbol removed from watchlist'
  );

  return {
    removed: true,
    symbol: normalizedSymbol,
    totalSymbols: this.services.monitoredSymbols.length,
    timestamp: Date.now(),
  };
}

/**
 * Clean up Redis cache for a removed symbol
 */
private async cleanupSymbolCache(symbol: string): Promise<void> {
  const userId = 1; // Hardcoded for now
  const exchangeId = 1;
  const keysToDelete: string[] = [];

  keysToDelete.push(`ticker:${userId}:${exchangeId}:${symbol}`);

  for (const tf of this.services!.timeframes) {
    keysToDelete.push(`candles:${userId}:${exchangeId}:${symbol}:${tf}`);
    keysToDelete.push(`indicator:${userId}:${exchangeId}:${symbol}:${tf}:macd-v`);
  }

  if (keysToDelete.length > 0) {
    const deleted = await this.services!.redis.del(...keysToDelete);
    logger.debug({ symbol, keysDeleted: deleted }, 'Cleaned up symbol cache');
  }
}
```

### Example 4: Bulk Import Validation (SYM-05)

```typescript
// symbol.router.ts
bulkValidate: protectedProcedure
  .input(z.object({
    symbols: z.array(z.string()).min(1).max(50),
  }))
  .query(async ({ ctx, input }) => {
    const exchange = await getUserExchange(ctx.auth.userId);

    // Get user's current symbols for delta calculation
    const [user] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(/* identity match */);

    const existing = new Set<string>(user.settings?.symbols ?? []);

    // Categorize input
    const results: Array<{
      symbol: string;
      status: 'valid' | 'invalid' | 'duplicate';
      metrics?: { price: string; volume24h: string; change24h: string };
      error?: string;
    }> = [];

    for (const rawSymbol of input.symbols) {
      const symbol = normalizeSymbol(rawSymbol, exchange);

      // Check duplicates first (no API call needed)
      if (existing.has(symbol)) {
        results.push({ symbol, status: 'duplicate' });
        continue;
      }

      // Validate against exchange
      try {
        const client = getCoinbaseClient();
        const product = await client.getProduct(symbol);

        if (product.trading_disabled || product.status !== 'online') {
          results.push({ symbol, status: 'invalid', error: 'Not tradeable' });
        } else {
          results.push({
            symbol,
            status: 'valid',
            metrics: {
              price: product.price,
              volume24h: product.volume_24h,
              change24h: product.price_percentage_change_24h,
            },
          });
        }
      } catch {
        results.push({ symbol, status: 'invalid', error: 'Not found' });
      }

      // Rate limit: small delay between API calls
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      results,
      summary: {
        valid: results.filter(r => r.status === 'valid').length,
        invalid: results.filter(r => r.status === 'invalid').length,
        duplicate: results.filter(r => r.status === 'duplicate').length,
      },
    };
  }),
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded symbols in server.ts | Dynamic from user settings | Phase 20 | User control over watchlist |
| Full service restart | Incremental add/remove | Phase 20 | Faster, no downtime |
| Manual validation | Admin UI validation | Phase 20 | Better UX |

**Deprecated/outdated:**
- `getAccountSymbols()` in server.ts - Will remain for initial load but symbols from settings take precedence

## Integration Points

### Services That Need Updates

| Service | Method to Add | Method to Remove | Notes |
|---------|---------------|------------------|-------|
| `CoinbaseAdapter` | `subscribe()` with full list | `unsubscribe()` + `subscribe()` | Already supports |
| `IndicatorCalculationService` | Need `addConfigs()` | Need `removeConfigs()` | Extend interface |
| `BoundaryRestService` | Need `addSymbol()` | Need `removeSymbol()` | Extend interface |
| `AlertEvaluationService` | Need `addSymbol()` | Need `removeSymbol()` | Extend interface |
| `ServiceRegistry` | Update `monitoredSymbols` | Update `monitoredSymbols` | In-memory array |

### Router Integration

Add to `apps/api/src/routers/index.ts`:
```typescript
import { symbolRouter } from './symbol.router';

export const appRouter = router({
  // ... existing routers
  symbol: symbolRouter,
});
```

## Open Questions

Things that couldn't be fully resolved:

1. **Multi-exchange support (Binance.com for Kaia)**
   - What we know: Binance uses different symbol format (BTCUSDT vs BTC-USD)
   - What's unclear: How to determine which exchange to validate against per user
   - Recommendation: Check `user.settings.perseus_profile.primary_exchange` field

2. **Rate limiting for bulk validation**
   - What we know: Coinbase has 10 req/sec limit
   - What's unclear: Best delay between calls for 50-symbol bulk import
   - Recommendation: 100ms delay between calls (10 req/sec safe)

3. **Service hot-reload vs restart**
   - What we know: Current services have start/stop methods
   - What's unclear: Whether to extend with addSymbol/removeSymbol methods or restart
   - Recommendation: Extend interfaces for cleaner hot-reload (less disruption)

## Sources

### Primary (HIGH confidence)
- `apps/api/src/services/control-channel.service.ts` - Existing stub handlers, patterns
- `apps/api/src/routers/settings.router.ts` - JSONB patch patterns
- `packages/coinbase-client/src/rest/client.ts` - Existing `getProducts()`, `getProduct()` methods
- `packages/schemas/src/settings/user-settings.schema.ts` - Existing `symbols` field

### Secondary (MEDIUM confidence)
- [Coinbase Get Product API](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product) - Response fields verified
- [Binance exchangeInfo API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api) - For future Binance support

### Tertiary (LOW confidence)
- Rate limiting specifics - Based on general Coinbase docs (10 req/sec)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in codebase
- Architecture: HIGH - Following existing patterns exactly
- Command handlers: HIGH - Existing stub handlers to implement
- Admin UI validation: MEDIUM - New component but pattern is clear
- Multi-exchange: LOW - Binance integration not yet researched deeply

**Research date:** 2026-01-31
**Valid until:** 2026-02-28 (30 days - stable domain)
