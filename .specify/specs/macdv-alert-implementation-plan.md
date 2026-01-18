# MACD-V Alert System Implementation Plan

## Overview

Replace the chatty stage-based alerting with level-crossing and reversal-signal alerts as defined in `MACD-V_Alert_Rules.md`.

---

## Files to Modify

### 1. `apps/api/src/services/alert-evaluation.service.ts` (Major Rewrite)

**Current State:**
- Tracks `previousStages` map (stage per symbol:timeframe)
- Alerts on any stage change
- Cooldown per stage transition

**New State:**
- Track `previousMacdV` map (MACD-V value per symbol:timeframe)
- Track `alertedLevels` map (which levels have been alerted, with timestamps)
- Track `reversalAlertTimestamps` map (last reversal alert per symbol:timeframe)
- Detect level crossings (±150, ±200, ±250...)
- Detect reversal signals (histogram buffer check)

**Changes:**

#### A. Replace tracking maps

```typescript
// OLD
private previousStages: Map<string, MACDVStage> = new Map();
private stageTransitionCooldown: Map<string, number> = new Map();

// NEW
private previousMacdV: Map<string, number> = new Map();
private alertedLevels: Map<string, number> = new Map();  // key: "symbol:timeframe:level", value: timestamp
private reversalAlertTimestamps: Map<string, number> = new Map();  // key: "symbol:timeframe", value: timestamp
private inReversalState: Map<string, boolean> = new Map();  // key: "symbol:timeframe", tracks if we've alerted reversal
```

#### B. Add constants for alert rules

```typescript
// Extreme level thresholds (generate dynamically or define range)
private readonly OVERSOLD_LEVELS = [-150, -200, -250, -300, -350, -400];
private readonly OVERBOUGHT_LEVELS = [150, 200, 250, 300, 350, 400];

// Buffer percentages for reversal signals
private readonly OVERSOLD_BUFFER_PCT = 0.05;   // 5%
private readonly OVERBOUGHT_BUFFER_PCT = 0.03; // 3%
```

#### C. Rewrite `handleIndicatorUpdate()`

New logic:
1. Get current MACD-V, histogram, signal from indicator
2. Get previous MACD-V from tracking map
3. Update tracking map with current value
4. Skip if no previous value (first update)
5. Check for level crossings (both directions)
6. Check for reversal signals (if in extreme territory)

```typescript
private async handleIndicatorUpdate(indicator: CachedIndicatorValue): Promise<void> {
  const { symbol, timeframe } = indicator;
  const key = `${symbol}:${timeframe}`;

  const currentMacdV = indicator.value['macdV'] as number;
  const histogram = indicator.value['histogram'] as number;

  if (currentMacdV === undefined || currentMacdV === null || Number.isNaN(currentMacdV)) {
    return;
  }

  const previousMacdV = this.previousMacdV.get(key);
  this.previousMacdV.set(key, currentMacdV);

  // Skip first update
  if (previousMacdV === undefined) {
    logger.debug({ symbol, timeframe, macdV: currentMacdV }, 'Initial MACD-V recorded');
    return;
  }

  // Check level crossings
  await this.checkLevelCrossings(symbol, timeframe as Timeframe, previousMacdV, currentMacdV, histogram, indicator);

  // Check reversal signals
  await this.checkReversalSignals(symbol, timeframe as Timeframe, currentMacdV, histogram, indicator);
}
```

#### D. Add `checkLevelCrossings()` method

```typescript
private async checkLevelCrossings(
  symbol: string,
  timeframe: Timeframe,
  previousMacdV: number,
  currentMacdV: number,
  histogram: number,
  indicator: CachedIndicatorValue
): Promise<void> {
  const key = `${symbol}:${timeframe}`;

  // Check oversold level crossings (crossing DOWN through negative levels)
  for (const level of this.OVERSOLD_LEVELS) {
    if (previousMacdV >= level && currentMacdV < level) {
      const cooldownKey = `${key}:${level}`;
      if (!this.isInCooldown(cooldownKey)) {
        await this.triggerLevelAlert(symbol, timeframe, level, 'down', currentMacdV, histogram, indicator);
        this.alertedLevels.set(cooldownKey, Date.now());
        // Reset reversal state when entering new extreme level
        this.inReversalState.set(key, false);
      }
    }
  }

  // Check overbought level crossings (crossing UP through positive levels)
  for (const level of this.OVERBOUGHT_LEVELS) {
    if (previousMacdV <= level && currentMacdV > level) {
      const cooldownKey = `${key}:${level}`;
      if (!this.isInCooldown(cooldownKey)) {
        await this.triggerLevelAlert(symbol, timeframe, level, 'up', currentMacdV, histogram, indicator);
        this.alertedLevels.set(cooldownKey, Date.now());
        // Reset reversal state when entering new extreme level
        this.inReversalState.set(key, false);
      }
    }
  }
}
```

#### E. Add `checkReversalSignals()` method

```typescript
private async checkReversalSignals(
  symbol: string,
  timeframe: Timeframe,
  currentMacdV: number,
  histogram: number,
  indicator: CachedIndicatorValue
): Promise<void> {
  const key = `${symbol}:${timeframe}`;

  // Already alerted reversal for this extreme move?
  if (this.inReversalState.get(key)) {
    return;
  }

  // Check cooldown
  if (this.isInCooldown(`${key}:reversal`)) {
    return;
  }

  // Reversal from oversold (MACD-V < -150)
  if (currentMacdV < -150) {
    const buffer = Math.abs(currentMacdV) * this.OVERSOLD_BUFFER_PCT;
    if (histogram > buffer) {
      await this.triggerReversalAlert(symbol, timeframe, 'oversold', currentMacdV, histogram, buffer, indicator);
      this.reversalAlertTimestamps.set(`${key}:reversal`, Date.now());
      this.inReversalState.set(key, true);
    }
  }

  // Reversal from overbought (MACD-V > +150)
  if (currentMacdV > 150) {
    const buffer = Math.abs(currentMacdV) * this.OVERBOUGHT_BUFFER_PCT;
    if (histogram < -buffer) {
      await this.triggerReversalAlert(symbol, timeframe, 'overbought', currentMacdV, histogram, buffer, indicator);
      this.reversalAlertTimestamps.set(`${key}:reversal`, Date.now());
      this.inReversalState.set(key, true);
    }
  }
}
```

#### F. Add `isInCooldown()` helper

```typescript
private isInCooldown(key: string): boolean {
  const lastTriggered = this.alertedLevels.get(key) || this.reversalAlertTimestamps.get(key);
  return lastTriggered !== undefined && Date.now() - lastTriggered < this.COOLDOWN_MS;
}
```

#### G. Add `triggerLevelAlert()` method

```typescript
private async triggerLevelAlert(
  symbol: string,
  timeframe: Timeframe,
  level: number,
  direction: 'up' | 'down',
  currentMacdV: number,
  histogram: number,
  indicator: CachedIndicatorValue
): Promise<void> {
  const price = this.currentPrices.get(symbol) || 0;

  logger.info(
    { symbol, timeframe, level, direction, macdV: currentMacdV, price },
    'Alert triggered: level crossing'
  );

  const timeframes = await this.gatherMACDVTimeframes(symbol);
  const bias = this.calculateBias(timeframes);

  // Send Discord notification
  let notificationSent = false;
  let notificationError: string | null = null;

  try {
    await this.discordService.sendMACDVLevelAlert(
      symbol,
      timeframe,
      level,
      direction,
      currentMacdV,
      timeframes,
      bias,
      price
    );
    notificationSent = true;
  } catch (error) {
    notificationError = (error as Error).message;
    logger.error({ error, symbol, timeframe }, 'Failed to send Discord notification');
  }

  // Record to database
  const now = new Date();
  try {
    await this.db.insert(alertHistory).values({
      exchangeId: this.TEST_EXCHANGE_ID,
      symbol,
      timeframe,
      alertType: 'macdv',
      triggeredAtEpoch: now.getTime(),
      triggeredAt: now,
      price: price.toString(),
      triggerValue: currentMacdV.toString(),
      triggerLabel: `level_${level}`,
      previousLabel: null,
      details: {
        level,
        direction,
        histogram,
        signal: indicator.value['signal'],
        timeframes,
        bias,
      },
      notificationSent,
      notificationError,
    });
  } catch (dbError) {
    logger.error({ error: dbError, symbol, timeframe }, 'Failed to record alert to database');
  }
}
```

#### H. Add `triggerReversalAlert()` method

```typescript
private async triggerReversalAlert(
  symbol: string,
  timeframe: Timeframe,
  zone: 'oversold' | 'overbought',
  currentMacdV: number,
  histogram: number,
  buffer: number,
  indicator: CachedIndicatorValue
): Promise<void> {
  const price = this.currentPrices.get(symbol) || 0;
  const bufferPct = zone === 'oversold' ? this.OVERSOLD_BUFFER_PCT : this.OVERBOUGHT_BUFFER_PCT;

  logger.info(
    { symbol, timeframe, zone, macdV: currentMacdV, histogram, buffer, price },
    'Alert triggered: reversal signal'
  );

  const timeframes = await this.gatherMACDVTimeframes(symbol);
  const bias = this.calculateBias(timeframes);

  // Send Discord notification
  let notificationSent = false;
  let notificationError: string | null = null;

  try {
    await this.discordService.sendMACDVReversalAlert(
      symbol,
      timeframe,
      zone,
      currentMacdV,
      histogram,
      buffer,
      timeframes,
      bias,
      price
    );
    notificationSent = true;
  } catch (error) {
    notificationError = (error as Error).message;
    logger.error({ error, symbol, timeframe }, 'Failed to send Discord notification');
  }

  // Record to database
  const now = new Date();
  try {
    await this.db.insert(alertHistory).values({
      exchangeId: this.TEST_EXCHANGE_ID,
      symbol,
      timeframe,
      alertType: 'macdv',
      triggeredAtEpoch: now.getTime(),
      triggeredAt: now,
      price: price.toString(),
      triggerValue: currentMacdV.toString(),
      triggerLabel: `reversal_${zone}`,
      previousLabel: null,
      details: {
        zone,
        histogram,
        buffer,
        bufferPct,
        signal: indicator.value['signal'],
        timeframes,
        bias,
      },
      notificationSent,
      notificationError,
    });
  } catch (dbError) {
    logger.error({ error: dbError, symbol, timeframe }, 'Failed to record alert to database');
  }
}
```

#### I. Update `stop()` to clear new maps

```typescript
async stop(): Promise<void> {
  // ... existing code ...

  this.previousMacdV.clear();
  this.alertedLevels.clear();
  this.reversalAlertTimestamps.clear();
  this.inReversalState.clear();
  this.currentPrices.clear();
}
```

#### J. Remove old stage-based code

- Remove `previousStages` map
- Remove `stageTransitionCooldown` map
- Remove `triggerStageChangeAlert()` method
- Remove import of `MACDVStage` (if no longer needed)

---

### 2. `apps/api/src/services/discord-notification.service.ts`

**Add two new methods:**

#### A. `sendMACDVLevelAlert()`

```typescript
async sendMACDVLevelAlert(
  symbol: string,
  timeframe: string,
  level: number,
  direction: 'up' | 'down',
  currentMacdV: number,
  timeframes: MACDVTimeframeData[],
  bias: string,
  price: number
): Promise<void> {
  const emoji = direction === 'up' ? '⬆️' : '⬇️';
  const zone = level > 0 ? 'overbought' : 'oversold';
  const title = `${symbol}: MACD-V crossed ${direction === 'up' ? 'above' : 'below'} ${level} (${timeframe})`;

  // Build timeframe display (same compact format as before)
  const formatTf = (tf: MACDVTimeframeData): string => {
    const val = tf.macdV !== null ? (tf.macdV >= 0 ? `+${tf.macdV.toFixed(0)}` : tf.macdV.toFixed(0)) : 'N/A';
    return val;
  };

  const tf1m = timeframes.find(t => t.timeframe === '1m');
  const tf5m = timeframes.find(t => t.timeframe === '5m');
  const tf15m = timeframes.find(t => t.timeframe === '15m');
  const tf1h = timeframes.find(t => t.timeframe === '1h');
  const tf4h = timeframes.find(t => t.timeframe === '4h');
  const tf1d = timeframes.find(t => t.timeframe === '1d');

  const line1 = `1m: ${tf1m ? formatTf(tf1m) : 'N/A'} │ 5m: ${tf5m ? formatTf(tf5m) : 'N/A'}`;
  const line2 = `15m: ${tf15m ? formatTf(tf15m) : 'N/A'} │ 1h: ${tf1h ? formatTf(tf1h) : 'N/A'}`;
  const line3 = `4h: ${tf4h ? formatTf(tf4h) : 'N/A'} │ 1d: ${tf1d ? formatTf(tf1d) : 'N/A'}`;

  const description = [
    `${emoji} Entering ${zone} territory`,
    '```',
    line1,
    line2,
    line3,
    '```',
    `**Bias: ${bias}**`,
  ].join('\n');

  await this.sendAlert({
    title,
    description,
    type: 'indicator_alert',
    price,
  });
}
```

#### B. `sendMACDVReversalAlert()`

```typescript
async sendMACDVReversalAlert(
  symbol: string,
  timeframe: string,
  zone: 'oversold' | 'overbought',
  currentMacdV: number,
  histogram: number,
  buffer: number,
  timeframes: MACDVTimeframeData[],
  bias: string,
  price: number
): Promise<void> {
  const emoji = zone === 'oversold' ? '🔄⬆️' : '🔄⬇️';
  const direction = zone === 'oversold' ? 'up' : 'down';
  const title = `${symbol}: Potential reversal ${direction} from ${zone} (${timeframe})`;

  // Build timeframe display
  const formatTf = (tf: MACDVTimeframeData): string => {
    const val = tf.macdV !== null ? (tf.macdV >= 0 ? `+${tf.macdV.toFixed(0)}` : tf.macdV.toFixed(0)) : 'N/A';
    return val;
  };

  const tf1m = timeframes.find(t => t.timeframe === '1m');
  const tf5m = timeframes.find(t => t.timeframe === '5m');
  const tf15m = timeframes.find(t => t.timeframe === '15m');
  const tf1h = timeframes.find(t => t.timeframe === '1h');
  const tf4h = timeframes.find(t => t.timeframe === '4h');
  const tf1d = timeframes.find(t => t.timeframe === '1d');

  const line1 = `1m: ${tf1m ? formatTf(tf1m) : 'N/A'} │ 5m: ${tf5m ? formatTf(tf5m) : 'N/A'}`;
  const line2 = `15m: ${tf15m ? formatTf(tf15m) : 'N/A'} │ 1h: ${tf1h ? formatTf(tf1h) : 'N/A'}`;
  const line3 = `4h: ${tf4h ? formatTf(tf4h) : 'N/A'} │ 1d: ${tf1d ? formatTf(tf1d) : 'N/A'}`;

  const description = [
    `${emoji} Signal line crossover detected`,
    `MACD-V: ${currentMacdV.toFixed(1)} | Histogram: ${histogram >= 0 ? '+' : ''}${histogram.toFixed(1)} | Buffer: ${buffer.toFixed(1)}`,
    '```',
    line1,
    line2,
    line3,
    '```',
    `**Bias: ${bias}**`,
  ].join('\n');

  await this.sendAlert({
    title,
    description,
    type: 'indicator_alert',
    price,
  });
}
```

---

## Testing Plan

1. **Unit test level crossing detection:**
   - MACD-V goes from -140 to -160 → should alert on -150
   - MACD-V goes from -160 to -140 → should NOT alert (wrong direction)
   - MACD-V goes from 140 to 160 → should alert on +150
   - MACD-V goes from -190 to -210 → should alert on -200

2. **Unit test reversal detection:**
   - MACD-V at -180, histogram at +10 (buffer = 9) → should alert
   - MACD-V at -180, histogram at +5 (buffer = 9) → should NOT alert
   - MACD-V at +200, histogram at -8 (buffer = 6) → should alert
   - MACD-V at +200, histogram at -4 (buffer = 6) → should NOT alert

3. **Unit test cooldowns:**
   - Alert on -150, then MACD-V crosses -150 again within 5 min → should NOT alert
   - Alert on -150, then wait 5+ min, MACD-V crosses -150 again → should alert

4. **Integration test:**
   - Run API server with live data
   - Observe Discord notifications
   - Verify database records

---

## Rollback Plan

If issues arise, revert to the previous stage-based alerting by:
1. Git revert the commits
2. Restart the API server

---

## Summary of Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `alert-evaluation.service.ts` | Major rewrite | Replace stage-based with level/reversal alerting |
| `discord-notification.service.ts` | Add methods | New `sendMACDVLevelAlert()` and `sendMACDVReversalAlert()` |
| `MACD-V_Alert_Rules.md` | New file | Documentation of alert rules |

---

## Estimated Scope

- ~150 lines removed (old stage-based code)
- ~250 lines added (new level/reversal code)
- 2 new Discord notification methods (~60 lines)
