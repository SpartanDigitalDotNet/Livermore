# Pitfalls Research: v4.0 User Settings + Runtime Control

**Domain:** User settings management, inter-process communication, runtime mode switching
**Researched:** 2026-01-31
**Context:** Adding JSONB settings on users table, Redis pub/sub for Admin-to-API commands, multi-user isolation (you + Kaia)

## Critical Pitfalls

Mistakes that cause data leakage, system deadlock, or extended downtime.

---

### Pitfall 1: Tenant Data Leakage Through Missing User Context

**What goes wrong:** A query or cache operation forgets to include userId, exposing one user's settings or data to another user. This is especially dangerous in the pub/sub command handling where commands should only affect the issuing user's processes.

**Why it happens:**
- Hardcoded `TEST_USER_ID = 1` patterns throughout codebase (see server.ts, indicator-calculation.service.ts)
- Copy-paste of existing code that assumes single user
- Missing userId parameter in new functions
- Pub/sub message handler doesn't validate sender identity

**Consequences:**
- Kaia's settings applied to your processes (wrong exchange credentials)
- Your symbols added to Kaia's scanner
- One user's pause command stops both users' processes
- Credential env var names exposed cross-user

**Warning signs:**
- Functions with no userId parameter (grep for hardcoded `1`)
- Pub/sub channels without user-scoped naming
- Cache keys without userId prefix
- Settings queries without WHERE user_id clause

**Prevention:**
1. **Audit all hardcoded user IDs:** Search for `TEST_USER_ID`, `userId: 1`, `userId = 1`
2. **User-scoped pub/sub channels:** `command:{userId}:*` not `command:*`
3. **Validate command origin:** Commands must include userId, handler must verify
4. **Row-Level Security (optional):** PostgreSQL RLS as defense-in-depth

**Code pattern to avoid:**
```typescript
// BAD: No user isolation
const settings = await db.select().from(userSettings);
await redis.publish('command:pause', JSON.stringify({ action: 'pause' }));

// GOOD: User-scoped
const settings = await db.select().from(users).where(eq(users.id, userId));
await redis.publish(`command:${userId}:pause`, JSON.stringify({ action: 'pause', userId }));
```

**Recommended phase:** Phase 1 (Settings Schema) - Build user isolation into foundation.

**Confidence:** HIGH - This is the documented #1 SaaS security pitfall.

**Sources:**
- [AWS SaaS Tenant Isolation Strategies](https://d1.awsstatic.com/whitepapers/saas-tenant-isolation-strategies.pdf)
- [AWS Whitepaper - Tenant Isolation Fundamentals](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html)

---

### Pitfall 2: Redis Pub/Sub Message Loss During Disconnection

**What goes wrong:** API process misses commands while Redis connection is down or during reconnection. Admin sends "pause" command, but API never receives it. System continues running when it should be paused.

**Why it happens:**
- Redis Pub/Sub is fire-and-forget (at-most-once delivery)
- No message persistence - if subscriber offline, message lost forever
- Reconnection logic re-subscribes but doesn't replay missed messages
- ioredis reconnection may leave subscriber in bad state

**Consequences:**
- Commands lost during brief network blips
- User thinks system is paused but it's still running
- Settings reload command missed, stale settings in use
- No audit trail of commands

**Warning signs:**
- Commands appear to "do nothing" intermittently
- Admin UI shows command sent but API state unchanged
- Redis reconnection events in logs around time of missed commands

**Prevention:**
1. **Acknowledge critical commands:** API publishes ack on separate channel
2. **State polling as fallback:** API periodically checks settings table for `isPaused` column
3. **Command queue (optional):** Use Redis Streams or Lists for guaranteed delivery
4. **Timeout + retry in Admin:** If no ack within 5s, retry command

**Ack pattern:**
```typescript
// API: Command handler with ack
subscriber.on('message', async (channel, message) => {
  const cmd = JSON.parse(message);
  try {
    await handleCommand(cmd);
    // Publish acknowledgment
    await publisher.publish(`ack:${cmd.userId}:${cmd.commandId}`, JSON.stringify({
      commandId: cmd.commandId,
      status: 'success',
      timestamp: Date.now()
    }));
  } catch (error) {
    await publisher.publish(`ack:${cmd.userId}:${cmd.commandId}`, JSON.stringify({
      commandId: cmd.commandId,
      status: 'error',
      error: error.message
    }));
  }
});

// Admin: Send command and wait for ack
async function sendCommand(cmd: Command): Promise<void> {
  const commandId = uuid();
  const ackChannel = `ack:${userId}:${commandId}`;

  await subscriber.subscribe(ackChannel);
  await publisher.publish(`command:${userId}`, JSON.stringify({ ...cmd, commandId }));

  // Wait for ack with timeout
  const ack = await waitForAck(ackChannel, 5000);
  if (!ack) throw new Error('Command timed out');
}
```

**Recommended phase:** Phase 2 (Pub/Sub Infrastructure) - Build ack pattern from start.

**Confidence:** HIGH - Redis official docs explicitly state this limitation.

**Sources:**
- [Redis Pub/Sub Documentation - At-most-once semantics](https://redis.io/docs/latest/develop/pubsub/)
- [Redis Pub/Sub In-Depth](https://medium.com/@joudwawad/redis-pub-sub-in-depth-d2c6f4334826)

---

### Pitfall 3: Subscriber Connection Leak from Improper Cleanup

**What goes wrong:** Creating new subscriber connections without properly closing old ones, leading to memory leaks and Redis connection exhaustion. Eventually Redis refuses new connections.

**Why it happens:**
- ioredis subscriber mode requires dedicated connection (can't share with regular commands)
- `redis.duplicate()` creates new connection - must be explicitly closed
- psubscribe pattern changes without punsubscribe
- Error paths don't clean up subscriber connections

**Consequences:**
- Memory grows over time in API process
- Redis `maxclients` reached, new connections refused
- Server restart required to clear leaked connections
- Under load, connections leak faster

**Warning signs:**
- Redis `INFO clients` shows growing `connected_clients`
- Node.js process memory grows without corresponding data growth
- "Max number of clients reached" errors
- Heap dumps show many Redis connection objects

**Prevention:**
1. **Single subscriber per service:** Create once at startup, reuse
2. **Explicit cleanup in shutdown:** punsubscribe before quit
3. **Connection tracking:** Log when connections created/closed
4. **Health check:** Monitor connected_clients in Redis

**Cleanup pattern:**
```typescript
class CommandSubscriber {
  private subscriber: Redis | null = null;

  async start(userId: number): Promise<void> {
    // Create dedicated subscriber (required for pub/sub mode)
    this.subscriber = redis.duplicate();
    await testRedisConnection(this.subscriber);

    await this.subscriber.psubscribe(`command:${userId}:*`);
    this.subscriber.on('pmessage', this.handleMessage.bind(this));

    logger.info({ userId }, 'Command subscriber started');
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.punsubscribe();
      await this.subscriber.quit();
      this.subscriber = null;
      logger.info('Command subscriber stopped');
    }
  }
}

// In shutdown handler
process.on('SIGTERM', async () => {
  await commandSubscriber.stop();  // Clean up before exit
  await redis.quit();
  process.exit(0);
});
```

**Recommended phase:** Phase 2 (Pub/Sub Infrastructure) - Connection lifecycle management.

**Confidence:** HIGH - Verified from existing codebase patterns (server.ts lines 189-192).

**Sources:**
- [ioredis GitHub - Pub/Sub requires separate connection](https://github.com/redis/ioredis)
- [ioredis Memory Leak Issue](https://github.com/redis/ioredis/issues/1965)

---

### Pitfall 4: JSONB Schema Evolution Without Migration Strategy

**What goes wrong:** Settings JSONB structure changes between versions, but old data in database doesn't match new TypeScript interface. Reading old settings crashes or returns undefined fields.

**Why it happens:**
- JSONB is schema-less at database level
- TypeScript interface changes, database data doesn't
- No version field in JSONB to detect old format
- Zod validation fails on old data

**Consequences:**
- `settings.newField` is undefined, crashes with "cannot read property X of undefined"
- Old users can't load settings after upgrade
- Partial settings load (some fields work, some don't)
- Rollback difficult because new code added fields

**Warning signs:**
- TypeError on settings access after deployment
- Zod parse errors on settings load
- Different behavior between new users and old users
- Settings "reset" for some users after upgrade

**Prevention:**
1. **Version field in JSONB:** `{ version: 1, ...settings }`
2. **Migration function by version:** Transform old format to new on read
3. **Default values for new fields:** Don't assume field exists
4. **Backwards-compatible changes only:** Add fields, don't remove/rename

**Schema evolution pattern:**
```typescript
// Settings schema with version
interface SettingsV1 {
  version: 1;
  symbols: string[];
  alertsEnabled: boolean;
}

interface SettingsV2 {
  version: 2;
  symbols: string[];
  alertsEnabled: boolean;
  runtimeMode: 'position-monitor' | 'scalper-macdv';  // New in v2
}

type Settings = SettingsV1 | SettingsV2;
type CurrentSettings = SettingsV2;

function migrateSettings(raw: unknown): CurrentSettings {
  const parsed = raw as Settings;

  if (!parsed.version || parsed.version === 1) {
    // Migrate v1 -> v2
    return {
      ...parsed,
      version: 2,
      runtimeMode: 'position-monitor',  // Default for existing users
    };
  }

  return parsed as CurrentSettings;
}

// On read
const raw = await db.select().from(users).where(eq(users.id, userId));
const settings = migrateSettings(raw.settings);

// On write (always write current version)
await db.update(users).set({ settings: { version: 2, ...newSettings } });
```

**Recommended phase:** Phase 1 (Settings Schema) - Include version from day one.

**Confidence:** HIGH - Standard JSONB versioning best practice.

**Sources:**
- [Zero-Downtime PostgreSQL JSONB Migration Guide](https://medium.com/@shinyjai2011/zero-downtime-postgresql-jsonb-migration-a-practical-guide-for-scalable-schema-evolution-9f74124ef4a1)
- [Xata - pgroll for schema migrations](https://xata.io/blog/pgroll-schema-migrations-postgres)

---

## Moderate Pitfalls

Mistakes that cause delays, degraded functionality, or technical debt.

---

### Pitfall 5: Pause Mode That Doesn't Keep Pub/Sub Alive

**What goes wrong:** "Pause" implementation stops all services including the pub/sub subscriber. Now the API can't receive the "resume" command because it's not listening!

**Why it happens:**
- Pause interpreted as "stop everything"
- Single shutdown flow used for both pause and full stop
- No distinction between data services and control services

**Consequences:**
- Can't resume without restarting API
- Admin shows "resume" sent but nothing happens
- User has to SSH in and restart service
- Defeats purpose of pause (graceful pause, not crash)

**Warning signs:**
- Resume command never acknowledged
- API process still running but unresponsive to commands
- Logs stop after pause (subscriber not logging either)

**Prevention:**
1. **Separate control plane from data plane:** Command subscriber never stops
2. **Pause = stop data services only:** Indicator service, WebSocket adapter, alert service
3. **Idempotent pause:** Multiple pause commands = same state
4. **State machine:** RUNNING -> PAUSED -> RUNNING (command subscriber always active)

**Pause implementation pattern:**
```typescript
class ApiController {
  private state: 'running' | 'paused' = 'running';
  private commandSubscriber: CommandSubscriber;  // NEVER stops
  private indicatorService: IndicatorService;
  private coinbaseAdapter: CoinbaseAdapter;

  async pause(): Promise<void> {
    if (this.state === 'paused') return;  // Idempotent

    // Stop data services
    await this.indicatorService.stop();
    this.coinbaseAdapter.disconnect();

    this.state = 'paused';
    logger.info('API paused - command subscriber still active');
  }

  async resume(): Promise<void> {
    if (this.state === 'running') return;  // Idempotent

    // Restart data services
    await this.coinbaseAdapter.connect();
    await this.indicatorService.start(this.configs);

    this.state = 'running';
    logger.info('API resumed');
  }

  // Command subscriber ALWAYS running
  async handleCommand(cmd: Command): Promise<void> {
    switch (cmd.action) {
      case 'pause': await this.pause(); break;
      case 'resume': await this.resume(); break;
      case 'reload-settings': await this.reloadSettings(); break;  // Works even when paused
    }
  }
}
```

**Recommended phase:** Phase 3 (Command Handling) - Design pause state machine carefully.

**Confidence:** HIGH - Explicit requirement from PROJECT.md ("Pause mode not shutdown").

---

### Pitfall 6: JSONB Query Performance Without Indexes

**What goes wrong:** Querying settings by a field inside JSONB (e.g., "find all users with scalper-macdv mode") does full table scan. Works fine with 2 users, catastrophic with 200.

**Why it happens:**
- JSONB is flexible but not automatically indexed
- Standard B-tree indexes don't work on JSONB internals
- PostgreSQL query planner has no statistics on JSONB field distributions
- Developer assumes "it's just a column, indexes work"

**Consequences:**
- Settings page takes 10+ seconds to load
- Database CPU spikes on settings queries
- Concurrent queries lock each other
- "Works on my machine" but fails in production

**Warning signs:**
- EXPLAIN shows Seq Scan on users table
- Query time increases linearly with user count
- Settings-related queries much slower than ID-based queries

**Prevention:**
1. **Don't query JSONB for frequent operations:** Use dedicated columns for queryable fields
2. **GIN index for containment queries:** If must query JSONB
3. **Expression index for specific fields:** `CREATE INDEX ON users ((settings->>'runtimeMode'))`
4. **Hybrid approach:** Critical fields as columns, flexible fields as JSONB

**Hybrid schema pattern:**
```sql
-- Users table with hybrid approach
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  -- ... existing columns ...

  -- Frequently queried settings as columns (indexed automatically)
  runtime_mode VARCHAR(30) DEFAULT 'position-monitor',
  is_paused BOOLEAN DEFAULT false,

  -- Flexible settings as JSONB (rarely queried by content)
  settings JSONB DEFAULT '{"version": 1}'::jsonb
);

-- If you must query JSONB, add targeted index
CREATE INDEX users_settings_mode_idx ON users ((settings->>'runtimeMode'));
```

**Recommended phase:** Phase 1 (Settings Schema) - Design schema with query patterns in mind.

**Confidence:** HIGH - PostgreSQL documentation explicitly warns about JSONB statistics.

**Sources:**
- [When To Avoid JSONB In A PostgreSQL Schema - Heap](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema)
- [PostgreSQL Indexing Strategies for JSONB Columns](https://www.rickychilcott.com/2025/09/22/postgresql-indexing-strategies-for-jsonb-columns/)
- [Pitfalls of JSONB indexes in PostgreSQL](https://vsevolod.net/postgresql-jsonb-index/)

---

### Pitfall 7: Credential Env Var Name Validation Failures

**What goes wrong:** Settings store env var NAMES like `COINBASE_API_KEY`, but the name is wrong or env var doesn't exist. System crashes at runtime when trying to use credentials.

**Why it happens:**
- Settings validation checks if field is a string, not if env var exists
- Typo in env var name: `COINBASE_APIKEY` vs `COINBASE_API_KEY`
- Env var exists in dev but not in production
- User changes env var name but forgets to update settings

**Consequences:**
- API crashes on startup (if validated early)
- API crashes mid-operation (if validated lazily)
- Confusing error: "COINBASE_APIKEY is not defined" when user set COINBASE_API_KEY
- Works for one user, fails for another (different env var names)

**Warning signs:**
- "Environment variable X is not defined" errors
- Works in dev, fails in production
- Settings look correct but connection fails
- Different error messages for different users

**Prevention:**
1. **Validate env var exists at settings save:** Reject if `process.env[varName]` undefined
2. **Validate at startup:** Check all credential env vars before starting services
3. **Clear error messages:** "Env var 'COINBASE_APIKEY' not found. Did you mean 'Coinbase_ApiKeyId'?"
4. **List expected format:** Show user what env var names look like in the UI

**Validation pattern:**
```typescript
// At settings save time
function validateCredentialEnvVars(settings: UserSettings): ValidationResult {
  const errors: string[] = [];

  if (settings.coinbaseApiKeyEnvVar) {
    if (!process.env[settings.coinbaseApiKeyEnvVar]) {
      errors.push(`Environment variable '${settings.coinbaseApiKeyEnvVar}' is not defined`);
    }
  }

  if (settings.coinbasePrivateKeyEnvVar) {
    if (!process.env[settings.coinbasePrivateKeyEnvVar]) {
      errors.push(`Environment variable '${settings.coinbasePrivateKeyEnvVar}' is not defined`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// At startup
function validateAllUserCredentials(): void {
  const users = await db.select().from(users).where(eq(users.isActive, true));

  for (const user of users) {
    const result = validateCredentialEnvVars(user.settings);
    if (!result.valid) {
      logger.error({ userId: user.id, errors: result.errors }, 'Invalid credential env vars');
      // Don't crash - just disable this user's processes
      await disableUserProcesses(user.id);
    }
  }
}
```

**Recommended phase:** Phase 1 (Settings Schema) - Build validation into settings save.

**Confidence:** HIGH - Direct requirement from PROJECT.md ("Settings store env var names, not actual secrets").

---

### Pitfall 8: Race Condition Between Settings Update and Active Processes

**What goes wrong:** User updates settings while indicator service is mid-calculation. Service reads partial old settings + partial new settings, producing inconsistent state.

**Why it happens:**
- Settings read at multiple points during operation
- No transaction boundary around "read settings + do work"
- Hot reload reads from database mid-operation
- Cache and database out of sync during update

**Consequences:**
- Old symbols + new thresholds (invalid combination)
- Alerts fire with wrong parameters
- Indicator calculates for symbols not in current config
- State partially updated, partially stale

**Warning signs:**
- Inconsistent behavior after settings change
- Logs show mix of old and new configuration
- "Symbol not found" errors after symbol list update
- Alerts with wrong thresholds

**Prevention:**
1. **Atomic settings object:** Read entire settings once, use throughout operation
2. **Settings version/timestamp:** Detect if settings changed mid-operation
3. **Reload on clean boundary:** Queue reload command, apply at next cycle start
4. **Copy-on-read:** Services work with snapshot, not live reference

**Safe reload pattern:**
```typescript
class IndicatorService {
  private settings: UserSettings;
  private pendingReload = false;

  async handleCandleClose(symbol: string, timeframe: Timeframe): Promise<void> {
    // Use settings snapshot for entire operation
    const settings = this.settings;

    if (!settings.symbols.includes(symbol)) {
      return; // Symbol not in our config
    }

    // All operations use same settings snapshot
    await this.calculateIndicator(symbol, timeframe, settings);
    await this.evaluateAlerts(symbol, timeframe, settings);

    // Check for pending reload AFTER operation completes
    if (this.pendingReload) {
      await this.applyReload();
    }
  }

  async reloadSettings(): Promise<void> {
    // Don't reload mid-operation
    this.pendingReload = true;
    logger.info('Settings reload queued');
  }

  private async applyReload(): Promise<void> {
    this.settings = await fetchSettings(this.userId);
    this.pendingReload = false;
    logger.info('Settings reloaded');
  }
}
```

**Recommended phase:** Phase 3 (Command Handling) - Design reload behavior carefully.

**Confidence:** MEDIUM - Depends on reload frequency and operation duration.

---

### Pitfall 9: Admin UI Showing Stale State After Command

**What goes wrong:** Admin sends "pause" command, API acknowledges, but Admin UI still shows "Running" because it cached the old state.

**Why it happens:**
- Admin fetched state before command sent
- No state refresh after command acknowledgment
- Optimistic UI update didn't happen
- WebSocket state subscription not implemented

**Consequences:**
- User confusion: "Did the command work?"
- User sends command again (idempotent is fine, but wasteful)
- User thinks system is broken
- Support requests for "pause doesn't work"

**Warning signs:**
- UI state doesn't match API state after commands
- User reports needing to refresh page after every command
- Duplicate commands in logs

**Prevention:**
1. **Refresh state after ack:** Fetch fresh state from API
2. **Optimistic update + confirm:** Update UI immediately, correct on ack
3. **State subscription:** WebSocket push of state changes
4. **Loading state:** Show "Pausing..." until confirmed

**UI pattern:**
```typescript
// React example
async function handlePause() {
  setCommandState('pending');  // Show "Pausing..."

  try {
    await trpc.commands.pause.mutate();
    // Refresh state from server after successful command
    const newState = await trpc.status.get.query();
    setApiState(newState);
    setCommandState('success');
  } catch (error) {
    setCommandState('error');
    toast.error('Pause failed: ' + error.message);
  }
}
```

**Recommended phase:** Phase 4 (Admin UI) - Build refresh into command flow.

**Confidence:** HIGH - Common UI/backend synchronization issue.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable without major rework.

---

### Pitfall 10: Pub/Sub Channel Naming Collisions

**What goes wrong:** Command channel name collides with existing candle channel naming. Or multiple features use same channel name pattern.

**Why it happens:**
- No documented channel naming convention
- Different developers choose similar names
- Copy-paste from existing code without renaming

**Consequences:**
- Command messages mixed with candle messages
- Wrong handler receives wrong message type
- JSON parse errors (candle isn't a command)
- Hard to debug which messages go where

**Warning signs:**
- Unexpected message types in handlers
- JSON parse errors on specific channels
- Messages "disappear" (handled by wrong subscriber)

**Prevention:**
1. **Document channel naming convention:** `{type}:{userId}:{exchangeId}:{...details}`
2. **Prefix by purpose:** `cmd:`, `data:`, `ack:`
3. **Validate message type:** Handler checks message schema before processing
4. **Central channel registry:** Single file defining all channel patterns

**Existing patterns to follow (from codebase):**
```typescript
// Existing data channels (from keys.ts)
// candles:{userId}:{exchangeId}:{symbol}:{timeframe}
// indicator:{userId}:{exchangeId}:{symbol}:{timeframe}:{type}
// ticker:{userId}:{exchangeId}:{symbol}

// NEW command channels (proposed for v4.0)
// cmd:{userId}:pause
// cmd:{userId}:resume
// cmd:{userId}:reload-settings
// cmd:{userId}:switch-mode
// ack:{userId}:{commandId}
```

**Recommended phase:** Phase 2 (Pub/Sub Infrastructure) - Document before implementing.

**Confidence:** HIGH - Convention established in existing codebase.

---

### Pitfall 11: Settings Default Values Not Applied Consistently

**What goes wrong:** New settings field added with default in code, but existing database rows have null/undefined. Different code paths handle missing values differently.

**Why it happens:**
- Default in TypeScript interface, not in database
- Some code checks `settings.field || default`, others assume field exists
- Migration didn't backfill existing rows
- Zod schema has default, but raw JSON read bypasses Zod

**Consequences:**
- Existing users have different behavior than new users
- "Works for new users" bug reports
- Inconsistent null vs undefined vs default handling
- Tests pass (use new data), production fails (has old data)

**Warning signs:**
- Different behavior for old vs new users
- Null pointer exceptions for specific users
- Tests pass, production fails

**Prevention:**
1. **Database column defaults:** `DEFAULT 'value'` in schema
2. **Zod .default() for all optional fields:** Consistent parsing
3. **Migration backfills:** Update existing rows when adding fields
4. **Integration tests with real old data:** Seed tests with various data states

**Default handling pattern:**
```typescript
// Zod schema with defaults
const UserSettingsSchema = z.object({
  version: z.number().default(1),
  symbols: z.array(z.string()).default([]),
  runtimeMode: z.enum(['position-monitor', 'scalper-macdv']).default('position-monitor'),
  alertsEnabled: z.boolean().default(true),
  // All fields have defaults - no undefined possible after parse
});

// Always parse through Zod
async function getUserSettings(userId: number): Promise<UserSettings> {
  const row = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  // Parse applies defaults for missing fields
  return UserSettingsSchema.parse(row[0]?.settings ?? {});
}
```

**Recommended phase:** Phase 1 (Settings Schema) - Define defaults in Zod from start.

**Confidence:** HIGH - Standard schema validation best practice.

---

### Pitfall 12: Logging Sensitive Data in Command Messages

**What goes wrong:** Command messages logged at debug level include env var names or other semi-sensitive data. Logs exposed to monitoring systems or log aggregators.

**Why it happens:**
- Debug logging of entire message object
- Didn't consider what fields are in commands
- Log aggregator accessible to wider team

**Consequences:**
- Env var names visible in logs (not secrets, but reveals structure)
- Symbol lists visible (trading strategy leak)
- Compliance concerns for future multi-tenant

**Warning signs:**
- Full command payloads in logs
- Structured logging includes all fields

**Prevention:**
1. **Redact sensitive fields:** Log command type, not full payload
2. **Separate debug vs audit logs:** Audit log has sanitized version
3. **Review log output:** Check what actually appears in logs

**Logging pattern:**
```typescript
subscriber.on('message', (channel, message) => {
  const cmd = JSON.parse(message);

  // Log type and metadata, not full payload
  logger.info({
    channel,
    commandType: cmd.action,
    userId: cmd.userId,
    commandId: cmd.commandId,
    // DON'T log: cmd.settings, cmd.envVarName, cmd.symbols
  }, 'Command received');
});
```

**Recommended phase:** Phase 2 (Pub/Sub Infrastructure) - Review logging during implementation.

**Confidence:** MEDIUM - Good practice but not critical for 2-user system.

---

## Breaking Existing Functionality

How v4.0 features can break existing v2.0/v3.0 functionality.

---

### Pitfall 13: User-Scoped Cache Keys Breaking Existing Data

**What goes wrong:** v4.0 changes cache key format to include real userId (from database) instead of hardcoded `1`. Existing cached data becomes inaccessible because key format changed.

**Why it happens:**
- Cache keys currently use `TEST_USER_ID = 1`
- v4.0 uses actual user.id from database
- Existing Redis data has old key format
- No migration for cached data

**Consequences:**
- All cached candles "disappear" after upgrade
- Full backfill triggered (unnecessary REST calls)
- 429 risk if many symbols need backfill
- Indicators show "no data" until backfill completes

**Warning signs:**
- "No candles found" after upgrade
- Full backfill running after upgrade
- Cache hit rate drops to 0%

**Prevention:**
1. **Keep user ID = 1 for you:** Your database user ID should be 1 (primary user)
2. **Migration script:** Rename existing keys if user ID changes
3. **Verify user IDs before upgrade:** Ensure database IDs match expected
4. **Clear cache intentionally:** If migrating, clear cache as part of deployment

**Key format verification:**
```typescript
// Before v4.0 deployment, verify:
// 1. Your user ID in database is 1
const user = await db.select().from(users).where(eq(users.email, 'your@email.com'));
console.assert(user[0].id === 1, 'Primary user should have ID 1');

// 2. Kaia's user ID is different
const kaia = await db.select().from(users).where(eq(users.email, 'kaia@email.com'));
console.assert(kaia[0].id !== 1, 'Kaia should have different ID');
```

**Recommended phase:** Pre-deployment verification.

**Confidence:** HIGH - Critical data continuity concern.

---

### Pitfall 14: Settings Table vs Column Confusion

**What goes wrong:** Existing `user_settings` table (key-value store) conflicts with plan to add `settings` JSONB column on `users` table. Unclear which is source of truth.

**Why it happens:**
- v1.0 created `user_settings` table as key-value store
- v4.0 plan says "JSONB column on users table"
- Two different patterns, both called "settings"
- Migration path unclear

**Consequences:**
- Queries hit wrong table
- Settings saved in one place, read from another
- Duplicate storage of same data
- Confusing codebase with two "settings" concepts

**Current state (from codebase):**
```typescript
// user-settings.ts - Key-value store
export const userSettings = pgTable('user_settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),  // Global key, not per-user!
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Warning signs:**
- Two files: `user-settings.ts` and new settings column
- Queries sometimes use table, sometimes use column
- "Settings not saving" bugs

**Prevention:**
1. **Clarify scope:** `user_settings` table is global app settings, `users.settings` is per-user
2. **Or consolidate:** Migrate `user_settings` to `users.settings` if not needed globally
3. **Rename for clarity:** `app_settings` vs `user_settings` column
4. **Document which to use:** Clear guidance in code comments

**Recommended phase:** Phase 1 (Settings Schema) - Clarify before implementing.

**Confidence:** HIGH - Existing schema conflict visible in codebase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Settings Schema | JSONB evolution without versioning | Version field in JSONB, migration functions |
| Settings Schema | user_settings table vs users.settings column | Clarify or consolidate before building |
| Pub/Sub Infrastructure | Message loss during disconnection | Ack pattern, state polling fallback |
| Pub/Sub Infrastructure | Subscriber connection leaks | Explicit cleanup in shutdown, single subscriber |
| Command Handling | Pause stops command subscriber | Separate control plane from data plane |
| Command Handling | Race condition with settings reload | Atomic settings reads, reload on clean boundary |
| Admin UI | Stale state after command | Refresh on ack, loading states |
| Multi-User | Data leakage through missing userId | Audit hardcoded IDs, user-scoped channels |

---

## Summary: Top 5 Pitfalls by Severity

1. **Tenant Data Leakage (Pitfall 1)** - Wrong user's data exposed or modified
2. **Pub/Sub Message Loss (Pitfall 2)** - Commands never reach API
3. **Pause Stops Everything (Pitfall 5)** - Can't resume without restart
4. **JSONB Schema Evolution (Pitfall 4)** - Old settings crash new code
5. **Cache Key Format Change (Pitfall 13)** - All cached data becomes inaccessible

---

## Sources

### PostgreSQL JSONB
- [When To Avoid JSONB In A PostgreSQL Schema - Heap](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema)
- [PostgreSQL Indexing Strategies for JSONB Columns](https://www.rickychilcott.com/2025/09/22/postgresql-indexing-strategies-for-jsonb-columns/)
- [Pitfalls of JSONB indexes in PostgreSQL](https://vsevolod.net/postgresql-jsonb-index/)
- [Zero-Downtime PostgreSQL JSONB Migration](https://medium.com/@shinyjai2011/zero-downtime-postgresql-jsonb-migration-a-practical-guide-for-scalable-schema-evolution-9f74124ef4a1)
- [JSON in PostgreSQL: how to use it right - CYBERTEC](https://www.cybertec-postgresql.com/en/json-postgresql-how-to-use-it-right/)

### Redis Pub/Sub
- [Redis Pub/Sub Documentation](https://redis.io/docs/latest/develop/pubsub/)
- [Redis Pub/Sub In-Depth](https://medium.com/@joudwawad/redis-pub-sub-in-depth-d2c6f4334826)
- [ioredis GitHub - Pub/Sub](https://github.com/redis/ioredis)
- [Using Redis Pub/Sub with Node.js - LogRocket](https://blog.logrocket.com/using-redis-pub-sub-node-js/)
- [ioredis Memory Leak Issues](https://github.com/redis/ioredis/issues/1965)

### Multi-Tenant Security
- [AWS SaaS Tenant Isolation Strategies](https://d1.awsstatic.com/whitepapers/saas-tenant-isolation-strategies.pdf)
- [AWS Whitepaper - Tenant Isolation Fundamentals](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html)
- [Multi-Tenant Security Best Practices - Qrvey](https://qrvey.com/blog/multi-tenant-security/)

### Runtime State Management
- [Modern Node.js Patterns for 2025](https://kashw1n.com/blog/nodejs-2025/)
- [Node.js Process Lifecycle](https://www.thenodebook.com/node-arch/node-process-lifecycle)
- [Graceful Shutdown Patterns](https://xata.io/blog/zero-downtime-schema-migrations-postgresql)

---

*Researched: 2026-01-31 | Confidence: HIGH (verified with official documentation, existing codebase patterns, and community sources)*
