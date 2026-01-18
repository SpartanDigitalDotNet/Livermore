# MACD-V Alert Rules

## Overview

Alert rules for MACD-V stage transitions, designed to minimize noise while capturing actionable signals. Rules focus on **extreme levels** and **reversal signals**, ignoring mid-range chatter.

## Design Principles

1. **Level crossings at extremes** — Alert when MACD-V enters extreme territory (±150, ±200, ±250...)
2. **Reversal signals from extremes** — Alert when MACD-V crosses the signal line while in extreme territory
3. **Asymmetric buffers** — Tighter buffer on overbought (3%) vs oversold (5%) because tops reverse faster than bottoms
4. **Ignore mid-range** — No alerts for activity between -50 and +50 (too noisy)

---

## Alert Types

### 1. Level Crossing Alerts

Trigger when MACD-V crosses key thresholds:

**Bearish (entering oversold territory):**
- Crosses below -150 (entering extreme oversold)
- Crosses below -200, -250, -300... (deepening oversold)

**Bullish (entering overbought territory):**
- Crosses above +150 (entering extreme overbought)
- Crosses above +200, +250, +300... (deepening overbought)

**Logic:**
```
For each level in [-150, -200, -250, -300, ...]:
  If previous MACD-V >= level AND current MACD-V < level:
    → Alert "Crossed below {level}"

For each level in [+150, +200, +250, +300, ...]:
  If previous MACD-V <= level AND current MACD-V > level:
    → Alert "Crossed above {level}"
```

### 2. Reversal Signal Alerts

Trigger when MACD-V crosses the signal line while in extreme territory, with a buffer to prevent false signals.

**Reversal from Oversold (bullish signal):**
- Condition: MACD-V < -150 (in oversold territory)
- Trigger: Histogram > |MACD-V| × 5%
- Meaning: MACD-V has crossed above signal line by a meaningful margin

**Reversal from Overbought (bearish signal):**
- Condition: MACD-V > +150 (in overbought territory)
- Trigger: Histogram < -(|MACD-V| × 3%)
- Meaning: MACD-V has crossed below signal line by a meaningful margin

**Why asymmetric buffers?**
- Oversold (5%): Bottoms tend to form gradually; wait for confirmation
- Overbought (3%): Tops can collapse fast ("stairs up, elevator down"); exit earlier

**Buffer Examples:**

| MACD-V | Zone | Buffer % | Buffer Value | Histogram Threshold |
|--------|------|----------|--------------|---------------------|
| -150 | Oversold | 5% | 7.5 | > +7.5 |
| -200 | Oversold | 5% | 10.0 | > +10.0 |
| -300 | Oversold | 5% | 15.0 | > +15.0 |
| +150 | Overbought | 3% | 4.5 | < -4.5 |
| +200 | Overbought | 3% | 6.0 | < -6.0 |
| +300 | Overbought | 3% | 9.0 | < -9.0 |

---

## Timeframe Scope

**1m Timeframe:**
- Level crossing alerts (±150, ±200, ±250...)
- Reversal signal alerts with buffers

**Higher Timeframes (5m, 15m, 1h, 4h, 1d):**
- Level crossing alerts (±150, ±200, ±250...)
- Reversal signal alerts with buffers
- Note: Higher timeframe reversals are significant events

---

## What We Ignore (For Now)

1. **Mid-range stage transitions** — No alerts for rebounding/retracing/rallying transitions between -50 and +50
2. **±50 level crossings** — Future enhancement: detect range breakouts
3. **Signal line crossovers in mid-range** — Too noisy, not actionable

---

## Alert Message Format

**Level Crossing:**
```
{symbol}: MACD-V crossed below -150 ({timeframe})
{symbol}: MACD-V crossed above +200 ({timeframe})
```

**Reversal Signal:**
```
{symbol}: Potential reversal from oversold (MACD-V: -180, Histogram: +12) ({timeframe})
{symbol}: Potential reversal from overbought (MACD-V: +165, Histogram: -8) ({timeframe})
```

---

## Database Recording

All alerts are recorded to `alert_history` table:

| Field | Level Crossing | Reversal Signal |
|-------|----------------|-----------------|
| alert_type | `macdv` | `macdv` |
| trigger_label | `level_-150`, `level_+200` | `reversal_oversold`, `reversal_overbought` |
| trigger_value | MACD-V value | MACD-V value |
| previous_label | Previous level or null | null |
| details | `{ level, direction, timeframes, bias }` | `{ histogram, buffer, bufferPct, timeframes, bias }` |

---

## Cooldown Rules

**Per-symbol-timeframe-level cooldown:**
- After alerting on a level crossing (e.g., -150), don't alert on that same level again for 5 minutes
- Allows alerting on -200 immediately after -150 if MACD-V keeps falling

**Per-symbol-timeframe reversal cooldown:**
- After alerting on a reversal signal, don't alert on another reversal for 5 minutes
- Prevents chatter if histogram oscillates around the buffer threshold

---

## Implementation Notes

1. Track previous MACD-V value per symbol:timeframe to detect level crossings
2. Track which levels have been alerted (with timestamps) for cooldown
3. Track reversal alert timestamps for cooldown
4. Fetch current indicator data from Redis cache when alert triggers
5. Calculate histogram buffer dynamically based on current MACD-V value
