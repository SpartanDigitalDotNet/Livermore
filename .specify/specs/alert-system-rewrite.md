# Alert System Rewrite Plan

## Overview

Replace the database-driven alert configuration system with a rule-based stage transition detection system. Alerts fire when MACD-V stages change (e.g., "reversing" → "rebounding"), using the hardcoded stage classification rules already in `@livermore/indicators`.

## Current State (Broken)

### What's Broken
- `AlertEvaluationService.loadAlerts()` queries `alerts` table (doesn't exist)
- `AlertEvaluationService.triggerAlert()` writes to `alert_history` table (doesn't exist)
- `alert.router.ts` has CRUD operations referencing non-existent tables
- Server crashes on startup

### What Works
- `IndicatorCalculationService` calculates MACD-V with stage and publishes to Redis
- `DiscordNotificationService` formats and sends notifications
- `classifyMACDVStage()` in `@livermore/indicators` implements stage rules
- Redis pub/sub for indicator updates is functional

---

## Phase 1: Database Schema

### 1.1 Create `alert_history` Table

**File:** `packages/database/src/schema/alert-history.ts`

```sql
CREATE TABLE alert_history (
  id SERIAL PRIMARY KEY,
  exchange_id INTEGER NOT NULL REFERENCES user_exchanges(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(5),
  alert_type VARCHAR(50) NOT NULL,
  triggered_at_epoch BIGINT NOT NULL,
  triggered_at TIMESTAMP WITH TIME ZONE NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  trigger_value DECIMAL(20, 8),
  trigger_label VARCHAR(100) NOT NULL,
  previous_label VARCHAR(100),
  details JSONB,
  notification_sent BOOLEAN DEFAULT FALSE NOT NULL,
  notification_error VARCHAR(500)
);

-- Indexes
CREATE INDEX alert_history_exchange_symbol_idx ON alert_history(exchange_id, symbol);
CREATE INDEX alert_history_triggered_at_idx ON alert_history(triggered_at DESC);
CREATE INDEX alert_history_alert_type_idx ON alert_history(alert_type);
```

### 1.2 Remove Old Schema References

**File:** `packages/database/src/schema/alerts.ts`
- Delete this file entirely (old `alerts` and `alertHistory` tables)

**File:** `packages/database/src/schema/index.ts`
- Remove: `export * from './alerts';`
- Add: `export * from './alert-history';`

### 1.3 Fix Migration Journal

**File:** `packages/database/drizzle/meta/_journal.json`
- Remove phantom entry for `0002_drop_alert_tables` (no SQL file exists)
- OR create proper migration file for the new schema

### 1.4 Generate Migration

Run drizzle-kit to generate migration for `alert_history` table.

---

## Phase 2: AlertEvaluationService Rewrite

### 2.1 New Architecture

**File:** `apps/api/src/services/alert-evaluation.service.ts`

Remove:
- `loadAlerts()` method (database query)
- `alertsBySymbol` map (database-driven alert configs)
- `AlertState` interface (was tracking database alert IDs)
- `evaluateAlertWithPrice()` (price alerts - can add back later)
- `evaluateAlertWithIndicator()` (generic condition evaluation)
- All database writes to `alerts` and `alert_history` tables

Add:
- `previousStages: Map<string, MACDVStage>` - tracks last known stage per symbol/timeframe
- `stageTransitionCooldown: Map<string, number>` - prevents spam (key: `symbol:timeframe:stage`)
- `COOLDOWN_MS = 300000` (5 minutes) - configurable cooldown per stage transition

### 2.2 Core Logic

```typescript
// On indicator update:
async handleIndicatorUpdate(indicator: CachedIndicatorValue): Promise<void> {
  const { symbol, timeframe } = indicator;
  const currentStage = indicator.params?.stage as MACDVStage;

  if (!currentStage || currentStage === 'unknown') return;

  const key = `${symbol}:${timeframe}`;
  const previousStage = this.previousStages.get(key);

  // Update tracking
  this.previousStages.set(key, currentStage);

  // Skip if no previous stage (first update after startup)
  if (!previousStage) return;

  // Skip if stage hasn't changed
  if (currentStage === previousStage) return;

  // Check cooldown for this specific transition
  const cooldownKey = `${key}:${currentStage}`;
  const lastTriggered = this.stageTransitionCooldown.get(cooldownKey);
  if (lastTriggered && Date.now() - lastTriggered < this.COOLDOWN_MS) return;

  // Stage changed! Trigger alert
  await this.triggerStageChangeAlert(symbol, timeframe, previousStage, currentStage, indicator);

  // Set cooldown
  this.stageTransitionCooldown.set(cooldownKey, Date.now());
}
```

### 2.3 Trigger Method

```typescript
private async triggerStageChangeAlert(
  symbol: string,
  timeframe: Timeframe,
  previousStage: MACDVStage,
  currentStage: MACDVStage,
  indicator: CachedIndicatorValue
): Promise<void> {
  const price = this.currentPrices.get(symbol) || 0;
  const macdVValue = indicator.value['macdV'] as number;

  // Gather all timeframe data for context
  const timeframes = this.gatherMACDVTimeframes(symbol);
  const bias = this.calculateBias(timeframes);

  // Send Discord notification (existing method works)
  let notificationSent = false;
  let notificationError: string | null = null;

  try {
    await this.discordService.sendMACDVAlert(
      symbol,
      timeframe,
      currentStage,
      timeframes,
      bias,
      price
    );
    notificationSent = true;
  } catch (error) {
    notificationError = (error as Error).message;
  }

  // Record to alert_history table
  const now = new Date();
  await this.db.insert(alertHistory).values({
    exchangeId: this.TEST_EXCHANGE_ID,
    symbol,
    timeframe,
    alertType: 'macdv_stage',
    triggeredAtEpoch: now.getTime(),
    triggeredAt: now,
    price: price.toString(),
    triggerValue: macdVValue?.toString() || null,
    triggerLabel: currentStage,
    previousLabel: previousStage,
    details: {
      timeframes,
      bias,
      histogram: indicator.value['histogram'],
      signal: indicator.value['signal'],
    },
    notificationSent,
    notificationError,
  });
}
```

### 2.4 Startup Changes

Remove `loadAlerts()` call from `start()`. The service now:
1. Subscribes to Redis indicator channels
2. Initializes empty `previousStages` map (first update per symbol/timeframe is ignored)
3. Tracks stage changes in memory

---

## Phase 3: Router Changes

### 3.1 Replace `alert.router.ts`

**File:** `apps/api/src/routers/alert.router.ts`

Remove all CRUD operations (create, update, delete, toggle).

Replace with read-only endpoints:

```typescript
export const alertRouter = router({
  // Get recent alert triggers (all symbols)
  recent: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(50) }))
    .query(async ({ input }) => {
      const triggers = await db
        .select()
        .from(alertHistory)
        .where(eq(alertHistory.exchangeId, TEST_EXCHANGE_ID))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(input.limit);
      return { success: true, data: triggers };
    }),

  // Get alert triggers for a specific symbol
  bySymbol: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      limit: z.number().int().positive().max(100).default(50)
    }))
    .query(async ({ input }) => {
      const triggers = await db
        .select()
        .from(alertHistory)
        .where(and(
          eq(alertHistory.exchangeId, TEST_EXCHANGE_ID),
          eq(alertHistory.symbol, input.symbol)
        ))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(input.limit);
      return { success: true, data: triggers };
    }),

  // Get alert triggers by type
  byType: publicProcedure
    .input(z.object({
      alertType: z.string().min(1),
      limit: z.number().int().positive().max(100).default(50)
    }))
    .query(async ({ input }) => {
      const triggers = await db
        .select()
        .from(alertHistory)
        .where(and(
          eq(alertHistory.exchangeId, TEST_EXCHANGE_ID),
          eq(alertHistory.alertType, input.alertType)
        ))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(input.limit);
      return { success: true, data: triggers };
    }),
});
```

---

## Phase 4: Schema Package Cleanup

### 4.1 Update Exports

**File:** `packages/schemas/src/indicators/alert.schema.ts`

Keep:
- `AlertConditionSchema` (may be useful for future alert types)
- Type exports

Consider removing or marking deprecated:
- `AlertConfigSchema` (was for database-stored configs)
- `AlertTriggerSchema` (replace with new schema matching `alert_history` table)

---

## Phase 5: Update `.claude-context`

Update tRPC endpoints documentation:
- Remove: `/trpc/alert.create`, `/trpc/alert.update`, `/trpc/alert.delete`, `/trpc/alert.toggle`
- Update: `/trpc/alert.list` → `/trpc/alert.recent`
- Add: `/trpc/alert.bySymbol`, `/trpc/alert.byType`

---

## Implementation Order

1. **Database first** (Phase 1)
   - Create `alert-triggers.ts` schema
   - Update `schema/index.ts`
   - Fix migration journal
   - Generate and run migration

2. **Service rewrite** (Phase 2)
   - Rewrite `AlertEvaluationService`
   - Test with server startup

3. **Router update** (Phase 3)
   - Replace `alert.router.ts`
   - Verify tRPC endpoints work

4. **Cleanup** (Phase 4 & 5)
   - Schema package cleanup
   - Update documentation

---

## Testing Checklist

- [ ] Server starts without database errors
- [ ] Indicator updates trigger stage change detection
- [ ] Discord notifications fire on stage transitions
- [ ] Alert triggers are recorded in `alert_history` table
- [ ] Cooldown prevents duplicate alerts within 5 minutes
- [ ] `/trpc/alert.recent` returns trigger history
- [ ] `/trpc/alert.bySymbol` filters correctly

---

## Future Enhancements (Out of Scope)

- User subscription preferences (who gets notified for what)
- Additional alert types (price cross, volume spike)
- Configurable cooldowns per alert type
- Alert severity levels
