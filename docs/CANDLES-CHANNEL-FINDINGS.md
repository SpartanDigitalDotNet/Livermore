# Coinbase WebSocket Candles Channel: Empirical Findings

**Date:** 2026-01-23
**Method:** PowerShell test harness against live Coinbase Advanced Trade WebSocket
**Confidence:** HIGH (verified with actual API responses)

## Executive Summary

The Coinbase Advanced Trade WebSocket candles channel does NOT behave as documented. Key findings:

1. **Granularity is fixed at 5m** — no way to specify other timeframes
2. **Candles with no trades are skipped** — creates gaps in the data
3. **Snapshot provides 100 candles** (or fewer for low-volume symbols)
4. **Higher timeframes (15m, 1h, 4h, 1d) are NOT available via WebSocket**

## Test Results

### Single Symbol Test (BTC-USD)

```
Candle count: 100
Time span: Variable (9-16 hours depending on trading activity)
Granularity: 5 minutes (but with gaps)
```

### Multi-Symbol Test (100 symbols)

| Metric | Result |
|--------|--------|
| Symbols subscribed | 100 |
| Symbols with snapshots | 86 |
| Symbols with 100 candles | 72 (84%) |
| Symbols with < 100 candles | 14 (16%) |

**Low-volume symbols with insufficient candles:**
- RAD-USD: 16 candles
- DNT-USD: 34 candles
- BICO-USD: 36 candles
- BNT-USD: 40 candles
- BLUR-USD: 46 candles
- UMA-USD: 50 candles
- POND-USD: 54 candles
- BAND-USD: 55 candles
- BAL-USD: 68 candles
- KNC-USD: 73 candles
- RLC-USD: 82 candles
- MASK-USD: 84 candles
- CTSI-USD: 91 candles

### Gap Analysis

Consecutive candle timestamps show gaps where no trades occurred:

```
01:00:00 → 01:05:00 = 5 min (normal)
01:05:00 → 01:10:00 = 5 min (normal)
01:10:00 → 01:20:00 = 10 min (01:15 MISSING - no trades)
01:20:00 → 01:25:00 = 5 min (normal)
01:25:00 → 01:35:00 = 10 min (01:30 MISSING - no trades)
```

## Documentation vs Reality

| Aspect | Documentation Says | Reality |
|--------|-------------------|---------|
| Granularity | "five minutes" | 5m, but skips empty candles |
| Snapshot size | Not specified | 100 candles max |
| Granularity parameter | Not documented | Ignored if sent |
| Higher timeframes | Not available | Confirmed not available |

## Implications for Architecture

### What WebSocket CAN Do

1. **Provide 5m candles for high-volume symbols** — 100 candles, sufficient for MACD-V
2. **Real-time updates** — as trades happen
3. **Multi-symbol subscription** — 100 symbols in one subscription
4. **No rate limiting** — unlimited reads via WebSocket

### What WebSocket CANNOT Do

1. **Provide higher timeframes** — no 15m, 1h, 4h, 1d via WebSocket
2. **Guarantee continuous data** — gaps when no trades occur
3. **Fill historical gaps** — only provides what's available
4. **Low-volume symbols** — may not have 100 candles

### Architecture Options

#### Option A: WebSocket for 5m + REST for Higher Timeframes

```
Startup:
  └─ REST backfill: 100 candles × 4 timeframes (15m, 1h, 4h, 1d) × N symbols

Runtime:
  └─ WebSocket: 5m candles (real-time)
  └─ REST: Higher timeframes at boundaries only
     ├─ 15m boundary: 1 REST call per symbol (every 15 min)
     ├─ 1h boundary: 1 REST call per symbol (every hour)
     ├─ 4h boundary: 1 REST call per symbol (every 4 hours)
     └─ 1d boundary: 1 REST call per symbol (daily)
```

**REST calls per day (100 symbols):**
- 15m: 96 boundaries × 100 = 9,600 calls
- 1h: 24 boundaries × 100 = 2,400 calls
- 4h: 6 boundaries × 100 = 600 calls
- 1d: 1 boundary × 100 = 100 calls
- **Total: 12,700 calls/day**

**Pros:**
- Real-time 5m data
- Accurate higher timeframe data from source

**Cons:**
- Still requires REST calls (potential 429s at boundaries)
- 12,700 calls/day for 100 symbols

#### Option B: WebSocket Only (5m) + Deferred Higher Timeframes

```
Startup:
  └─ REST backfill: ALL timeframes (one-time)

Runtime:
  └─ WebSocket: 5m candles only
  └─ Higher timeframes: Use cached data from startup
  └─ Refresh: Only on reconnection or manual trigger
```

**Pros:**
- Zero REST calls during normal operation
- No 429 risk

**Cons:**
- Higher timeframe candles become stale
- Current candle never updates until next refresh

#### Option C: Accept 5m-Only Indicators

```
Startup:
  └─ None required

Runtime:
  └─ WebSocket: 5m candles only
  └─ Calculate MACD-V on 5m only
  └─ Skip higher timeframe indicators
```

**Pros:**
- Simplest architecture
- Zero REST calls
- Zero 429 risk

**Cons:**
- Loses multi-timeframe analysis
- May miss longer-term trends

## Handling Low-Volume Symbols

14% of tested symbols had < 100 candles. Options:

1. **Exclude from monitoring** — Skip symbols that can't provide 100 candles
2. **Lower threshold** — Accept fewer candles (60? 50?) for MACD-V
3. **REST supplement** — Use REST to fill gaps for low-volume symbols
4. **Indicator adaptation** — Adjust MACD-V calculation for fewer candles

## Recommendation

Given the constraints (no aggregation, no cron jobs, no 429s):

**Hybrid Approach:**

1. **5m timeframe:** WebSocket only (100 candles on subscribe, real-time updates)
2. **Higher timeframes:** REST at startup + event-driven refresh at boundaries
3. **Trigger mechanism:** Use 5m WebSocket candle close to detect higher timeframe boundaries
4. **Rate limiting:** Batch REST calls with delays to avoid 429s

This is event-driven (triggered by WebSocket), not cron-based.

## Open Questions

1. **Reconnection behavior:** Does reconnection provide fresh 100-candle snapshot?
2. **Stale detection:** How to detect if WebSocket data is stale?
3. **Gap handling:** Should we fill 5m gaps via REST or accept them?
4. **Low-volume policy:** Include or exclude symbols with < 100 candles?

## Future Considerations

- **Binance WebSocket:** May have different candles channel behavior
- **Other exchanges:** Each will need similar empirical testing
- **Exchange abstraction:** Adapter pattern should account for these differences

---
*Research conducted: 2026-01-23*
*Test harness: scripts/test-candles-channel.ps1*
*Raw results: candles-test-100-symbols.json*
