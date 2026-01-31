# Phase 19: Runtime Commands - Research

**Researched:** 2026-01-31
**Domain:** API runtime control via pub/sub command handlers
**Confidence:** HIGH

## Summary

Phase 19 implements the actual command handlers for the ControlChannelService created in Phase 18. The executeCommand() stub currently returns `{ executed: true }` and needs to dispatch to specific handlers based on command type.

The codebase has all necessary infrastructure already in place:
- **ControlChannelService** handles pub/sub, validation, ACK/result flow, priority queue
- **Existing services** (CoinbaseAdapter, IndicatorCalculationService, AlertEvaluationService, BoundaryRestService) have start/stop methods
- **Cache strategies** (CandleCacheStrategy, IndicatorCacheStrategy) have clear methods
- **Settings** are stored in user.settings JSONB column with established tRPC router

The primary challenge is injecting service references into ControlChannelService so it can call pause/resume methods on them.

**Primary recommendation:** Use a ServiceRegistry pattern to inject service references, then implement a command dispatcher with switch/case routing to handlers.

## Standard Stack

No new libraries needed. This phase uses existing infrastructure:

### Core
| Component | Location | Purpose |
|-----------|----------|---------|
| ControlChannelService | `apps/api/src/services/control-channel.service.ts` | Command dispatch entry point |
| CoinbaseAdapter | `packages/coinbase-client/src/adapter/coinbase-adapter.ts` | WebSocket connection |
| IndicatorCalculationService | `apps/api/src/services/indicator-calculation.service.ts` | Indicator processing |
| AlertEvaluationService | `apps/api/src/services/alert-evaluation.service.ts` | Alert monitoring |
| BoundaryRestService | `packages/coinbase-client/src/reconciliation/boundary-rest-service.ts` | Higher timeframe fetching |
| StartupBackfillService | `packages/coinbase-client/src/backfill/startup-backfill-service.ts` | Backfill pattern to reuse |

### Cache Strategies
| Strategy | Purpose | Key Methods |
|----------|---------|-------------|
| CandleCacheStrategy | Candle storage | `clearCandles(userId, exchangeId, symbol, timeframe)` |
| IndicatorCacheStrategy | Indicator storage | `deleteIndicator(...)` |
| Redis client | Pattern deletion | `keys(pattern)`, `del(keys)` |

### Database
| Table | Purpose |
|-------|---------|
| users.settings | JSONB column for user settings |

## Architecture Patterns

### Service Registry Pattern

ControlChannelService needs access to other services. Since server.ts creates all services, pass them to ControlChannelService:

```typescript
// Type-safe service registry
interface ServiceRegistry {
  coinbaseAdapter: CoinbaseAdapter;
  indicatorService: IndicatorCalculationService;
  alertService: AlertEvaluationService;
  boundaryRestService: BoundaryRestService;
  redis: Redis;
  db: ReturnType<typeof getDbClient>;
  // Optional callbacks for services not directly accessible
  onReloadSettings?: () => Promise<void>;
}

// Modified ControlChannelService constructor
class ControlChannelService {
  private services: ServiceRegistry;

  constructor(identitySub: string, services: ServiceRegistry) {
    // ...existing code
    this.services = services;
  }
}
```

### Command Dispatcher Pattern

Replace the stub executeCommand() with a dispatcher:

```typescript
private async executeCommand(command: Command): Promise<Record<string, unknown>> {
  const { type, payload } = command;

  switch (type) {
    case 'pause':
      return this.handlePause();
    case 'resume':
      return this.handleResume();
    case 'reload-settings':
      return this.handleReloadSettings();
    case 'switch-mode':
      return this.handleSwitchMode(payload);
    case 'force-backfill':
      return this.handleForceBackfill(payload);
    case 'clear-cache':
      return this.handleClearCache(payload);
    default:
      throw new Error(`Unknown command type: ${type}`);
  }
}
```

### Pause/Resume State Machine

Track paused state and handle transitions:

```typescript
private isPaused = false;

private async handlePause(): Promise<Record<string, unknown>> {
  if (this.isPaused) {
    return { status: 'already_paused' };
  }

  // Stop services in dependency order
  this.services.alertService.stop();                    // Stop alerts first
  this.services.coinbaseAdapter.disconnect();           // Stop WebSocket
  await this.services.boundaryRestService.stop();       // Stop boundary fetching
  await this.services.indicatorService.stop();          // Stop indicators

  this.isPaused = true;
  logger.info('Services paused');

  return { status: 'paused', timestamp: Date.now() };
}

private async handleResume(): Promise<Record<string, unknown>> {
  if (!this.isPaused) {
    return { status: 'already_running' };
  }

  // Restart services in startup order
  await this.services.indicatorService.start(indicatorConfigs);
  await this.services.coinbaseAdapter.connect();
  this.services.coinbaseAdapter.subscribe(symbols, '5m');
  await this.services.boundaryRestService.start(symbols);
  await this.services.alertService.start(symbols, timeframes);

  this.isPaused = false;
  logger.info('Services resumed');

  return { status: 'resumed', timestamp: Date.now() };
}
```

### Recommended Project Structure

```
apps/api/src/
├── services/
│   ├── control-channel.service.ts  # Add command handlers here
│   ├── types/
│   │   └── service-registry.ts     # ServiceRegistry interface
│   └── handlers/                   # Optional: separate handler files
│       ├── pause.handler.ts
│       ├── resume.handler.ts
│       ├── reload-settings.handler.ts
│       ├── switch-mode.handler.ts
│       ├── force-backfill.handler.ts
│       └── clear-cache.handler.ts
```

### Anti-Patterns to Avoid

- **Global state for service references**: Don't use module-level variables. Pass via constructor.
- **Hardcoded configs in handlers**: Use config from constructor or passed parameters.
- **Blocking commands**: Commands should complete quickly. For long operations (backfill), consider background execution with progress updates.
- **Missing error handling**: Each handler should catch errors and return meaningful error messages.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cache pattern deletion | Iterate and delete manually | `redis.keys()` + `redis.del()` pipeline | Atomic and efficient |
| Settings fetch | Raw SQL query | Existing settingsRouter patterns | Already handles edge cases |
| Backfill logic | New backfill code | StartupBackfillService | Proven rate-limiting, progress logging |
| Service lifecycle | Custom stop/start | Existing service methods | Services already have proper cleanup |

**Key insight:** All services already have start()/stop() methods with proper resource cleanup. Just call them in the right order.

## Common Pitfalls

### Pitfall 1: Service Dependency Order
**What goes wrong:** Stopping/starting services in wrong order causes errors or data loss
**Why it happens:** Services have implicit dependencies (AlertService subscribes to IndicatorService events)
**How to avoid:** Follow this order:

**Pause order (downstream to upstream):**
1. AlertEvaluationService (consumes events)
2. CoinbaseAdapter (produces events)
3. BoundaryRestService (produces events)
4. IndicatorCalculationService (consumes candle events)

**Resume order (upstream to downstream):**
1. IndicatorCalculationService (needs to be listening)
2. CoinbaseAdapter (starts producing events)
3. BoundaryRestService (listens to candle events)
4. AlertEvaluationService (needs indicators)

**Warning signs:** Alerts firing on stale data, indicators showing NaN after resume

### Pitfall 2: Resume Without Re-subscribing
**What goes wrong:** Services start but aren't subscribed to channels
**Why it happens:** stop() unsubscribes, but resume assumes subscriptions persist
**How to avoid:** Store symbols/configs before pause, resubscribe on resume
**Warning signs:** No data after resume, quiet logs

### Pitfall 3: Clear-Cache Scope Ambiguity
**What goes wrong:** Clearing "all" deletes system data or other users' data
**Why it happens:** Over-broad pattern matching
**How to avoid:** Always scope by userId and exchangeId in key patterns:
```typescript
// Good - scoped to user
const pattern = `*:${userId}:${exchangeId}:*`;

// Bad - matches everything
const pattern = `*`;
```
**Warning signs:** Other users losing data, system keys deleted

### Pitfall 4: Backfill During Active Processing
**What goes wrong:** REST backfill and WebSocket writes conflict
**Why it happens:** Running backfill while adapter is connected
**How to avoid:** Pause services before backfill, or use versioned writes (already implemented in addCandleIfNewer)
**Warning signs:** Duplicate candles, out-of-order data

### Pitfall 5: Stale Service References
**What goes wrong:** Handlers reference old service instances after restart
**Why it happens:** Services recreated but registry not updated
**How to avoid:** Don't recreate services, use existing start/stop methods
**Warning signs:** Commands succeed but have no effect

### Pitfall 6: Blocking the Command Queue
**What goes wrong:** Long-running commands block other commands
**Why it happens:** Backfill or bulk operations in command handler
**How to avoid:** For operations > 5s, run async with status polling or use background jobs
**Warning signs:** Subsequent commands timeout waiting for previous command

## Code Examples

### Command Handler Implementation

```typescript
// Source: Based on existing ControlChannelService patterns

private async handleClearCache(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const scope = (payload?.scope as string) ?? 'all';
  const symbol = payload?.symbol as string | undefined;
  const timeframe = payload?.timeframe as Timeframe | undefined;

  const userId = 1; // TODO: from identity
  const exchangeId = 1;

  let deletedCount = 0;

  switch (scope) {
    case 'all': {
      // Delete all candles and indicators for this user
      const candlePattern = `candles:${userId}:${exchangeId}:*`;
      const indicatorPattern = `indicator:${userId}:${exchangeId}:*`;

      const candleKeys = await this.services.redis.keys(candlePattern);
      const indicatorKeys = await this.services.redis.keys(indicatorPattern);

      if (candleKeys.length > 0) {
        await this.services.redis.del(...candleKeys);
        deletedCount += candleKeys.length;
      }
      if (indicatorKeys.length > 0) {
        await this.services.redis.del(...indicatorKeys);
        deletedCount += indicatorKeys.length;
      }
      break;
    }

    case 'symbol': {
      if (!symbol) throw new Error('symbol required for scope=symbol');

      // Delete all timeframes for this symbol
      const candlePattern = `candles:${userId}:${exchangeId}:${symbol}:*`;
      const indicatorPattern = `indicator:${userId}:${exchangeId}:${symbol}:*`;

      const candleKeys = await this.services.redis.keys(candlePattern);
      const indicatorKeys = await this.services.redis.keys(indicatorPattern);

      if (candleKeys.length > 0) {
        await this.services.redis.del(...candleKeys);
        deletedCount += candleKeys.length;
      }
      if (indicatorKeys.length > 0) {
        await this.services.redis.del(...indicatorKeys);
        deletedCount += indicatorKeys.length;
      }
      break;
    }

    case 'timeframe': {
      if (!timeframe) throw new Error('timeframe required for scope=timeframe');

      // Delete all symbols for this timeframe
      const candlePattern = `candles:${userId}:${exchangeId}:*:${timeframe}`;
      const indicatorPattern = `indicator:${userId}:${exchangeId}:*:${timeframe}:*`;

      const candleKeys = await this.services.redis.keys(candlePattern);
      const indicatorKeys = await this.services.redis.keys(indicatorPattern);

      if (candleKeys.length > 0) {
        await this.services.redis.del(...candleKeys);
        deletedCount += candleKeys.length;
      }
      if (indicatorKeys.length > 0) {
        await this.services.redis.del(...indicatorKeys);
        deletedCount += indicatorKeys.length;
      }
      break;
    }

    default:
      throw new Error(`Unknown scope: ${scope}`);
  }

  logger.info({ scope, symbol, timeframe, deletedCount }, 'Cache cleared');

  return { cleared: true, scope, deletedCount };
}
```

### Force Backfill Handler

```typescript
// Source: Based on StartupBackfillService pattern

private async handleForceBackfill(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const symbol = payload?.symbol as string;

  if (!symbol) {
    throw new Error('symbol required for force-backfill');
  }

  // Use existing backfill service pattern
  const backfillService = new StartupBackfillService(
    config.Coinbase_ApiKeyId,
    config.Coinbase_EcPrivateKeyPem,
    this.services.redis
  );

  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

  await backfillService.backfill([symbol], timeframes);

  // Trigger indicator recalculation
  for (const timeframe of timeframes) {
    await this.services.indicatorService.forceRecalculate(symbol, timeframe);
  }

  return { backfilled: true, symbol, timeframes };
}
```

### Reload Settings Handler

```typescript
// Source: Based on settings.router.ts patterns

private async handleReloadSettings(): Promise<Record<string, unknown>> {
  const db = this.services.db;

  // Fetch settings from database
  const [user] = await db
    .select({ settings: users.settings })
    .from(users)
    .where(
      and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, this.identitySub)
      )
    )
    .limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  const settings = user.settings;

  // Apply settings to runtime
  // (Implementation depends on what settings affect runtime)
  if (this.services.onReloadSettings) {
    await this.services.onReloadSettings();
  }

  logger.info({ identitySub: this.identitySub }, 'Settings reloaded');

  return { reloaded: true, timestamp: Date.now() };
}
```

### Switch Mode Handler (Stub)

```typescript
// Source: Stub implementation per RUN-07 requirement

private async handleSwitchMode(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const mode = payload?.mode as string;

  const validModes = ['position-monitor', 'scalper-macdv', 'scalper-orderbook'];

  if (!mode || !validModes.includes(mode)) {
    throw new Error(`Invalid mode. Must be one of: ${validModes.join(', ')}`);
  }

  // RUN-07 specifies this is a stub for now
  // Future implementation will switch strategy runners
  logger.info({ mode }, 'Mode switch requested (stub - no actual change)');

  return {
    switched: false,
    mode,
    message: 'Mode switching not yet implemented - stub response'
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Restart server for config changes | Runtime commands via pub/sub | Phase 18/19 | Zero-downtime configuration |
| Manual backfill scripts | Command-triggered backfill | Phase 19 | Operator-friendly |
| All-or-nothing cache clear | Scoped cache clearing | Phase 19 | Surgical data management |

## Open Questions

Things that couldn't be fully resolved:

1. **Config Access in Handlers**
   - What we know: Handlers need Coinbase credentials for backfill
   - What's unclear: Should config be passed via ServiceRegistry or re-read from env?
   - Recommendation: Pass validated config object to ServiceRegistry for consistency

2. **Resume Symbol List**
   - What we know: Resume needs to know which symbols to subscribe
   - What's unclear: Should this come from pause state, database, or command payload?
   - Recommendation: Store symbol list before pause, reuse on resume. Allow override via payload.

3. **Multi-User Isolation**
   - What we know: Keys are scoped by userId/exchangeId
   - What's unclear: How does identitySub map to userId?
   - Recommendation: For now, use hardcoded TEST_USER_ID=1. User mapping is Phase 20+ concern.

4. **Switch-Mode Implementation**
   - What we know: RUN-07 says stub for now
   - What's unclear: What strategies will exist?
   - Recommendation: Return success with stub message, don't implement actual switching

## Sources

### Primary (HIGH confidence)
- `apps/api/src/services/control-channel.service.ts` - Existing infrastructure
- `apps/api/src/server.ts` - Service instantiation and lifecycle
- `packages/cache/src/keys.ts` - Cache key patterns
- `packages/schemas/src/control/command.schema.ts` - Command types

### Secondary (MEDIUM confidence)
- Existing service start/stop patterns (verified in codebase)
- Cache strategy clear methods (verified in codebase)

### Tertiary (LOW confidence)
- None - all patterns verified in existing code

## Metadata

**Confidence breakdown:**
- Service registry pattern: HIGH - Standard dependency injection pattern
- Command handlers: HIGH - Clear requirements, existing patterns to follow
- Cache clearing: HIGH - Existing methods in cache strategies
- Switch-mode: LOW - Stub implementation, future work undefined

**Research date:** 2026-01-31
**Valid until:** 60 days (stable domain, existing patterns)
