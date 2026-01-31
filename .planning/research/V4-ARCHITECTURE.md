# Architecture Patterns: User Settings + Admin->API Control (v4.0)

**Domain:** User settings storage, runtime control, multi-mode operation
**Researched:** 2026-01-31
**Confidence:** HIGH (builds on verified existing architecture)

## Executive Summary

This document defines the architecture for integrating user settings (PostgreSQL JSONB) and Admin->API runtime control (Redis pub/sub) into the existing Livermore platform. The design extends proven patterns already in the codebase while introducing a command handler service for runtime mode switching.

**Key insight:** The existing codebase already has mature Redis pub/sub patterns (`candle:close`, `ticker`, `indicator` channels). The control channel follows the same conventions, requiring minimal new infrastructure.

## Current Architecture (Baseline)

```
                           WebSocket Layer (CoinbaseAdapter)
                                       |
                                       | Native 5m candles + ticker
                                       v
                           +-------------------+
                           |   Redis Cache     |<-- Backfill Service (startup)
                           +-------------------+<-- BoundaryRestService (boundaries)
                                       |
                                       | candle:close events + ticker pub/sub
                                       v
                           Indicator Service (cache-only reads)
                                       |
                                       v
                           Alert Evaluation (receives ticker prices)
```

**Existing pub/sub channels (from `packages/cache/src/keys.ts`):**
- `channel:candle:close:{userId}:{exchangeId}:{symbol}:{timeframe}` - Candle close events
- `channel:ticker:{userId}:{exchangeId}:{symbol}` - Ticker updates
- `channel:indicator:{userId}:{exchangeId}:{symbol}:{timeframe}:{type}` - Indicator updates

## Target Architecture (v4.0)

```
+------------------+                              +-------------------+
|   Admin UI       |                              |   PostgreSQL      |
|   (React)        |                              |   (users.settings)|
+------------------+                              +-------------------+
         |                                                 ^
         | tRPC (settings CRUD)                            |
         v                                                 |
+------------------+                                       |
|   API Server     |---------------------------------------+
|   (Fastify)      |
+------------------+
         |
         | PUBLISH channel:control:{userId}
         v
+------------------+
|   Redis          |
|   Pub/Sub        |
+------------------+
         |
         | SUBSCRIBE channel:control:{userId}
         v
+------------------+       +-----------------------+
| Command Handler  |------>| Runtime Mode Manager  |
| Service          |       | (pause/resume/switch) |
+------------------+       +-----------------------+
         |                            |
         | Controls                   | Controls
         v                            v
+------------------+       +-----------------------+
| CoinbaseAdapter  |       | Indicator Service     |
| (WebSocket)      |       | (calculations)        |
+------------------+       +-----------------------+
         |                            |
         +------------+---------------+
                      |
                      v
            +-----------------------+
            | Alert Evaluation      |
            | Service               |
            +-----------------------+
```

## Component Architecture

### 1. User Settings (PostgreSQL JSONB)

**Schema change:** Add `settings` JSONB column to existing `users` table.

```sql
-- Add to users table (via Atlas migration in schema.sql)
ALTER TABLE users
ADD COLUMN settings JSONB DEFAULT '{}'::jsonb;
```

**Settings structure (TypeScript type):**

```typescript
interface UserSettings {
  // Trading mode
  mode: 'position-monitor' | 'scalper-macdv' | 'scalper-orderbook';

  // Symbol configuration
  symbols: {
    monitored: string[];           // Active symbols (e.g., ['BTC-USD', 'ETH-USD'])
    minPositionValueUsd: number;   // Minimum position value to monitor (default: 2)
  };

  // Exchange configuration
  exchanges: {
    coinbase: {
      enabled: boolean;
      apiKeyEnvVar: string;        // Env var name, NOT the key itself
      privateKeyEnvVar: string;    // Env var name for private key
    };
    binanceUs?: {
      enabled: boolean;
      apiKeyEnvVar: string;
      secretKeyEnvVar: string;
    };
  };

  // Alert configuration
  alerts: {
    discord: {
      enabled: boolean;
      webhookEnvVar: string;       // Env var name for webhook URL
    };
    levels: number[];              // MACD-V levels to alert on (e.g., [150, 200, 250])
  };

  // Timeframes to monitor
  timeframes: Timeframe[];         // e.g., ['1m', '5m', '15m', '1h', '4h', '1d']
}
```

**Why JSONB (not separate columns):**

| Approach | Pros | Cons |
|----------|------|------|
| JSONB column | Flexible schema, no migrations for new settings, Kaia can extend independently | Slightly slower queries on individual fields |
| Separate columns | Type-safe, indexed by default | Requires migration for every new setting |

**Decision:** JSONB. User settings are read once at startup and on `reload-settings` command. Query performance is not critical. Flexibility for Kaia's PerseusWeb to add Binance.com settings without Livermore schema changes.

**Indexing strategy:** None initially. If specific settings need to be queried frequently, add generated columns:

```sql
-- Example: If we need to query by mode
ALTER TABLE users
ADD COLUMN mode text GENERATED ALWAYS AS ((settings->>'mode')) STORED;
CREATE INDEX users_mode_idx ON users(mode);
```

### 2. Settings tRPC Router

**Location:** `apps/api/src/routers/settings.router.ts`

```typescript
// Endpoints
settingsRouter = router({
  // Get current settings for authenticated user
  get: protectedProcedure.query(async ({ ctx }) => {
    return await getSettings(ctx.userId);
  }),

  // Update settings (partial update)
  update: protectedProcedure
    .input(UserSettingsPartialSchema)
    .mutation(async ({ ctx, input }) => {
      return await updateSettings(ctx.userId, input);
    }),

  // Reset to defaults
  reset: protectedProcedure.mutation(async ({ ctx }) => {
    return await resetSettings(ctx.userId);
  }),

  // Scan exchange for available symbols
  scanSymbols: protectedProcedure
    .input(z.object({ exchange: z.enum(['coinbase', 'binanceUs']) }))
    .mutation(async ({ ctx, input }) => {
      return await scanExchangeSymbols(ctx.userId, input.exchange);
    }),
});
```

### 3. Control Channel (Redis Pub/Sub)

**Channel naming convention (follows existing pattern in `packages/cache/src/keys.ts`):**

```typescript
// Add to packages/cache/src/keys.ts
export function controlChannel(userId: number): string {
  return `channel:control:${userId}`;
}
```

**Command message format:**

```typescript
interface ControlCommand {
  type: 'pause' | 'resume' | 'reload-settings' | 'switch-mode' |
        'add-symbol' | 'remove-symbol' | 'force-backfill' | 'clear-cache';
  payload?: Record<string, unknown>;
  timestamp: number;
  requestId: string;  // For tracking/debugging
}

// Examples
{ type: 'pause', timestamp: 1706745600000, requestId: 'abc123' }
{ type: 'switch-mode', payload: { mode: 'scalper-macdv' }, timestamp: 1706745600000, requestId: 'abc124' }
{ type: 'add-symbol', payload: { symbol: 'SOL-USD' }, timestamp: 1706745600000, requestId: 'abc125' }
{ type: 'force-backfill', payload: { symbols: ['BTC-USD'], timeframes: ['5m', '15m'] }, timestamp: 1706745600000, requestId: 'abc126' }
```

**Publisher (Admin tRPC endpoint):**

```typescript
// In control.router.ts
controlRouter = router({
  sendCommand: protectedProcedure
    .input(ControlCommandSchema)
    .mutation(async ({ ctx, input }) => {
      const channel = controlChannel(ctx.userId);
      const message = JSON.stringify({
        ...input,
        timestamp: Date.now(),
        requestId: crypto.randomUUID(),
      });
      await redis.publish(channel, message);
      return { success: true, requestId };
    }),
});
```

**Subscriber (Command Handler Service):**

```typescript
// In services/command-handler.service.ts
class CommandHandlerService {
  private subscriber: Redis;

  async start(userId: number): Promise<void> {
    this.subscriber = redis.duplicate();
    const channel = controlChannel(userId);
    await this.subscriber.subscribe(channel);

    this.subscriber.on('message', (ch, message) => {
      this.handleCommand(JSON.parse(message));
    });
  }

  private async handleCommand(cmd: ControlCommand): Promise<void> {
    switch (cmd.type) {
      case 'pause':
        await this.runtimeManager.pause();
        break;
      case 'resume':
        await this.runtimeManager.resume();
        break;
      case 'reload-settings':
        await this.settingsLoader.reload();
        break;
      // ... etc
    }
  }
}
```

### 4. Runtime Mode Manager

**State machine pattern for mode management:**

```
                   +------------------------------------------+
                   |                                          |
                   v                                          |
+---------+  resume  +---------------------+  switch-mode  +------------------+
| PAUSED  |--------->| position-monitor    |<------------->| scalper-macdv    |
|         |<---------| (default)           |               |                  |
+---------+  pause   +---------------------+               +------------------+
     ^                        |                                    |
     |                        | switch-mode                        | switch-mode
     |                        v                                    v
     |               +------------------+                         ...
     +---------------| scalper-orderbook|
           pause     | (stub)           |
                     +------------------+
```

**Mode behaviors:**

| Mode | WebSocket | Indicators | Alerts | Description |
|------|-----------|------------|--------|-------------|
| `PAUSED` | Disconnected | Stopped | Disabled | Idle state, pub/sub listener active |
| `position-monitor` | Connected | Active (all TF) | Active | Default mode, monitors portfolio |
| `scalper-macdv` | Connected | Active (1m, 5m) | Custom | Focus on short timeframes |
| `scalper-orderbook` | Connected | Minimal | Custom | Orderbook-focused (stub in v4.0) |

**Implementation (integrates with existing services from server.ts):**

```typescript
class RuntimeModeManager {
  private currentMode: RuntimeMode = 'position-monitor';
  private isPaused = false;

  // References to existing services (from server.ts)
  private coinbaseAdapter: CoinbaseAdapter;
  private indicatorService: IndicatorCalculationService;
  private alertService: AlertEvaluationService;
  private boundaryRestService: BoundaryRestService;

  async pause(): Promise<void> {
    if (this.isPaused) return;

    logger.info('Pausing runtime...');
    this.isPaused = true;

    // Disconnect WebSocket (stops data flow)
    this.coinbaseAdapter.disconnect();

    // Stop boundary REST service
    await this.boundaryRestService.stop();

    // Stop indicator subscriptions
    await this.indicatorService.stop();

    // Stop alert evaluation
    await this.alertService.stop();

    logger.info('Runtime paused');
  }

  async resume(): Promise<void> {
    if (!this.isPaused) return;

    logger.info('Resuming runtime...');
    this.isPaused = false;

    // Reconnect and resubscribe
    await this.coinbaseAdapter.connect();
    this.coinbaseAdapter.subscribe(this.symbols, '5m');

    // Restart services
    await this.indicatorService.start(this.indicatorConfigs);
    await this.boundaryRestService.start(this.symbols);
    await this.alertService.start(this.symbols, this.timeframes);

    logger.info('Runtime resumed');
  }

  async switchMode(newMode: RuntimeMode): Promise<void> {
    if (this.currentMode === newMode) return;

    logger.info({ from: this.currentMode, to: newMode }, 'Switching mode');

    const previousMode = this.currentMode;
    this.currentMode = newMode;

    // Reconfigure based on mode
    await this.applyModeConfig(newMode);

    logger.info({ mode: newMode }, 'Mode switched');
  }
}
```

### 5. Settings Loader

**Responsible for loading and caching user settings:**

```typescript
class SettingsLoader {
  private cache: UserSettings | null = null;
  private userId: number;

  constructor(userId: number) {
    this.userId = userId;
  }

  async load(): Promise<UserSettings> {
    const result = await db.select()
      .from(users)
      .where(eq(users.id, this.userId));

    if (!result[0]) throw new Error(`User ${this.userId} not found`);

    this.cache = result[0].settings as UserSettings;
    return this.cache;
  }

  async reload(): Promise<UserSettings> {
    logger.info({ userId: this.userId }, 'Reloading settings from database');
    return this.load();
  }

  get(): UserSettings {
    if (!this.cache) throw new Error('Settings not loaded');
    return this.cache;
  }
}
```

## Data Flow

### Startup Flow

```
1. Server starts
2. Load settings from PostgreSQL (SettingsLoader.load())
3. Initialize services with settings (replaces hardcoded values in server.ts)
   - CoinbaseAdapter with symbols from settings.symbols.monitored
   - IndicatorService with timeframes from settings.timeframes
   - AlertService with levels from settings.alerts.levels
4. Subscribe to control channel (CommandHandlerService.start())
5. Enter mode specified in settings.mode
```

### Settings Update Flow

```
Admin UI                    API                         API Process
   |                         |                               |
   |--[tRPC: update]-------->|                               |
   |                         |--[UPDATE users SET settings]->|
   |                         |                               |
   |                         |--[PUBLISH reload-settings]--->|
   |                         |                               |
   |<--[200 OK]--------------|                               |
   |                         |                               |
   |                         |     CommandHandlerService     |
   |                         |               |               |
   |                         |               |--[reload()]-->|
   |                         |               |               |
   |                         |               |  SettingsLoader
   |                         |               |       |       |
   |                         |               |       |--[SELECT]-->DB
   |                         |               |       |<--[settings]--
   |                         |               |       |
   |                         |               |<--[apply new config]
```

### Pause/Resume Flow

```
Admin UI                    API                         API Process
   |                         |                               |
   |--[tRPC: pause]--------->|                               |
   |                         |--[PUBLISH pause]------------->|
   |<--[200 OK]--------------|                               |
   |                         |     CommandHandlerService     |
   |                         |               |               |
   |                         |               |--[handleCommand]
   |                         |               |       |
   |                         |               |       v
   |                         |               | RuntimeModeManager
   |                         |               |       |
   |                         |               |       |--[disconnect WS]
   |                         |               |       |--[stop indicators]
   |                         |               |       |--[stop alerts]
   |                         |               |       |
   |                         |               |<--[isPaused = true]
```

### Symbol Add/Remove Flow

```
Admin UI                    API                         API Process
   |                         |                               |
   |--[tRPC: addSymbol]----->|                               |
   |                         |--[UPDATE settings.symbols]--->|
   |                         |--[PUBLISH add-symbol]-------->|
   |<--[200 OK]--------------|                               |
   |                         |     CommandHandlerService     |
   |                         |               |               |
   |                         |               |--[handleCommand]
   |                         |               |       |
   |                         |               |       v
   |                         |               | RuntimeModeManager
   |                         |               |       |
   |                         |               |       |--[backfill new symbol]
   |                         |               |       |--[subscribe WS]
   |                         |               |       |--[add to indicators]
   |                         |               |       |--[add to alerts]
```

## Component Boundaries

| Component | Package | Responsibility | Communicates With |
|-----------|---------|----------------|-------------------|
| Settings Router | `apps/api/src/routers/settings.router.ts` | CRUD for user settings | PostgreSQL, Redis (publish) |
| Control Router | `apps/api/src/routers/control.router.ts` | Publish control commands | Redis (publish only) |
| Command Handler | `apps/api/src/services/command-handler.service.ts` | Subscribe and dispatch commands | Redis (subscribe), RuntimeModeManager |
| Runtime Mode Manager | `apps/api/src/services/runtime-mode-manager.service.ts` | Coordinate mode switching, pause/resume | CoinbaseAdapter, IndicatorService, AlertService |
| Settings Loader | `apps/api/src/services/settings-loader.service.ts` | Load/cache PostgreSQL settings | PostgreSQL |
| User Settings Schema | `packages/schemas/src/user-settings.schema.ts` | TypeScript types + Zod validation | - |
| Control Channel Key | `packages/cache/src/keys.ts` | Channel name builder | - |

## Suggested Build Order

Based on dependencies, the recommended phase structure is:

### Phase 1: Settings Infrastructure
**Builds:** Database schema, types, loader service
**Dependencies:** None (new infrastructure)
**Deliverables:**
- `ALTER TABLE users ADD COLUMN settings JSONB` (via schema.sql + Atlas)
- `packages/schemas/src/user-settings.schema.ts`
- `apps/api/src/services/settings-loader.service.ts`
- Modify `server.ts` to load settings on startup

### Phase 2: Settings tRPC Router
**Builds:** CRUD endpoints for settings
**Dependencies:** Phase 1 (schema, loader)
**Deliverables:**
- `apps/api/src/routers/settings.router.ts`
- Add to `appRouter`
- Test with curl/Postman

### Phase 3: Control Channel Infrastructure
**Builds:** Redis pub/sub for commands
**Dependencies:** Phase 1 (settings for userId)
**Deliverables:**
- `packages/cache/src/keys.ts` - Add `controlChannel(userId)`
- `apps/api/src/routers/control.router.ts`
- `apps/api/src/services/command-handler.service.ts` (basic structure)

### Phase 4: Runtime Mode Manager
**Builds:** State machine for mode switching
**Dependencies:** Phase 3 (command handler)
**Deliverables:**
- `apps/api/src/services/runtime-mode-manager.service.ts`
- Wire up existing services (CoinbaseAdapter, IndicatorService, AlertService)
- Implement pause/resume

### Phase 5: Command Integration
**Builds:** Full command handling
**Dependencies:** Phase 3, Phase 4
**Deliverables:**
- Complete command handler with all command types
- Symbol add/remove with backfill
- Mode switching

### Phase 6: Admin UI Settings
**Builds:** Frontend for settings management
**Dependencies:** Phase 2 (settings router)
**Deliverables:**
- Settings page in Admin UI
- Form-based editor for common settings
- JSON editor for power users

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct Service Control from tRPC
**What:** tRPC endpoint directly calling `coinbaseAdapter.disconnect()`
**Why bad:** Couples HTTP layer to service lifecycle; race conditions
**Instead:** Publish command to Redis, let CommandHandler coordinate

### Anti-Pattern 2: Settings in Memory Only
**What:** Keeping settings only in service memory, not PostgreSQL
**Why bad:** Lost on restart, no Admin UI visibility
**Instead:** PostgreSQL as source of truth, in-memory cache for performance

### Anti-Pattern 3: Blocking Command Handler
**What:** Command handler that blocks on long operations
**Why bad:** Missed subsequent commands, Redis subscriber timeout
**Instead:** Fire-and-forget to RuntimeModeManager, async execution

### Anti-Pattern 4: Storing Credentials in Settings
**What:** Putting API keys/secrets in settings JSONB
**Why bad:** Visible in database, audit logs, backups
**Instead:** Store env var names in settings, actual credentials stay in environment

### Anti-Pattern 5: Polling for Settings Changes
**What:** Periodically checking database for settings updates
**Why bad:** Latency, unnecessary database load
**Instead:** Push via Redis pub/sub when settings change

## Scalability Considerations

| Concern | Current (1 user) | Future (multi-user) |
|---------|------------------|---------------------|
| Control channel | `channel:control:1` | `channel:control:{userId}` per user |
| Settings cache | Single in-memory | Per-user cache with LRU eviction |
| Command handler | Single subscriber | Subscriber per active user or pattern subscription |
| Mode manager | Single instance | Per-user instance or shared with user context |

**Future Azure pub/sub migration:** When multi-instance deployment needed, replace Redis pub/sub with Azure Service Bus. Channel becomes topic, `identity_sub` from Clerk becomes subscription filter. No architectural change, just transport swap.

## Integration with Existing Code

### Files to Modify

| File | Changes |
|------|---------|
| `packages/cache/src/keys.ts` | Add `controlChannel()` function |
| `packages/cache/src/index.ts` | Export new channel function |
| `packages/database/src/schema/users.ts` | Add `settings` column |
| `apps/api/src/routers/index.ts` | Add settings and control routers |
| `apps/api/src/server.ts` | Initialize SettingsLoader, CommandHandler, RuntimeModeManager |

### New Files to Create

| File | Purpose |
|------|---------|
| `packages/schemas/src/user-settings.schema.ts` | UserSettings type and Zod schema |
| `packages/schemas/src/control-command.schema.ts` | ControlCommand type and Zod schema |
| `apps/api/src/routers/settings.router.ts` | Settings CRUD endpoints |
| `apps/api/src/routers/control.router.ts` | Control command publisher |
| `apps/api/src/services/settings-loader.service.ts` | PostgreSQL settings loader |
| `apps/api/src/services/command-handler.service.ts` | Redis command subscriber |
| `apps/api/src/services/runtime-mode-manager.service.ts` | Service orchestration |

## Sources

- [Redis Pub/Sub Documentation](https://redis.io/docs/latest/develop/pubsub/) - Channel naming, subscription patterns
- [PostgreSQL JSONB Best Practices](https://medium.com/@richardhightower/jsonb-postgresqls-secret-weapon-for-flexible-data-modeling-cf2f5087168f) - Schema design
- [State Design Pattern in TypeScript](https://medium.com/@robinviktorsson/a-guide-to-the-state-design-pattern-in-typescript-and-node-js-with-practical-examples-20e92ff472df) - Runtime mode state machine
- [Redis Pub/Sub in Node.js](https://blog.logrocket.com/using-redis-pub-sub-node-js/) - ioredis implementation patterns
- Existing codebase: `packages/cache/src/keys.ts`, `apps/api/src/services/indicator-calculation.service.ts`, `apps/api/src/server.ts`

---

*Architecture research: 2026-01-31 for v4.0 milestone*
