# MACD-V (Alex Spiroglou) — Exact Calculation Spec (for Claude)

## Goal
Implement **MACD-V**, its **Signal line**, and **Histogram** exactly per Alex Spiroglou's published formulas (MACD normalized by ATR, scaled by 100).

This spec is about **calculation correctness**. No trading rules, no entries/exits.

---

## 1) Required inputs
You need OHLC data because ATR requires **High**, **Low**, **Close**:

- `high[t]`
- `low[t]`
- `close[t]`

Also requires **previous close** for True Range:
- `prevClose[t] = close[t-1]` (for `t > 0`)

---

## 2) Default parameters (Spiroglou defaults)
- Fast EMA length: `fastLen = 12`
- Slow EMA length: `slowLen = 26`
- ATR length: `atrLen = 26`
- Signal EMA length: `signalLen = 9`
- Output scale factor: `scale = 100`

Sources:
- Spiroglou PDF (NAAIM) gives MACD-V as `[(12 EMA − 26 EMA) / ATR(26)] * 100` and defines ATR/True Range.
- StockCharts MACD-V page gives the same MACD-V, signal line, histogram formulas.

---

## 3) True Range (TR) — MUST match Wilder definition
For each bar `t`:

```
TR[t] = max(
  high[t] - low[t],
  abs(high[t] - prevClose[t]),
  abs(low[t]  - prevClose[t])
)
```

This is explicitly described in Spiroglou's document (True Range components).

---

## 4) ATR(26) — Wilder's smoothing (SMMA / RMA)
Spiroglou specifies ATR as an **N-period smoothed moving average (SMMA)** of True Range (Wilder's ATR).

Implement as Wilder's RMA/SMMA:

**Initialization (first ATR value):**
```
ATR[atrLen - 1] = SMA(TR[0..atrLen-1])
```

**Recursive update for t >= atrLen:**
```
ATR[t] = (ATR[t-1] * (atrLen - 1) + TR[t]) / atrLen
```

Notes:
- This matches standard Wilder ATR (often called RMA/SMMA).
- If you are matching TradingView, `ta.atr(atrLen)` uses Wilder/RMA-style smoothing.

Edge case:
- If `ATR[t] == 0`, MACD-V is undefined. Decide one consistent behavior:
  - return `na/null`, or
  - return `0`
  but do not silently divide by zero.

---

## 5) EMA definition (for all EMAs used below)
Use standard exponential moving average:

```
alpha = 2 / (len + 1)
EMA[t] = alpha * x[t] + (1 - alpha) * EMA[t-1]
```

Initialization:
- If you need manual seeding, use:
  - `EMA[len-1] = SMA(x[0..len-1])`
  - then apply the recursive formula from `t = len` onward.
- If you're using a TA library (Python/pandas-ta, TA-Lib, TradingView `ta.ema`, etc.), use the library's native EMA so you match the platform's behavior.

---

## 6) MACD-V line (core formula)
Compute the **fast EMA** and **slow EMA** of close:

```
fastEMA[t] = EMA(close, fastLen)
slowEMA[t] = EMA(close, slowLen)
```

Compute the EMA spread:

```
macdSpread[t] = fastEMA[t] - slowEMA[t]
```

Normalize by ATR and scale:

```
MACD_V[t] = (macdSpread[t] / ATR[t]) * scale
```

This is Spiroglou's MACD-V construction: normalize the MACD EMA spread by **ATR(26)** and multiply by **100**.

---

## 7) Signal line and Histogram
Signal line is a 9-period EMA of MACD-V:

```
Signal[t] = EMA(MACD_V, signalLen)
```

Histogram:

```
Histogram[t] = MACD_V[t] - Signal[t]
```

---

## 8) Validation requirements (non-negotiable)
Claude: include a tiny validation harness so we can confirm correctness.

Minimum checks:
1) On the same OHLC data, **your MACD_V / Signal / Histogram must match StockCharts MACD-V** (or TradingView MACD-V implementation) to within a small numerical tolerance (floating point).
2) Confirm your ATR is Wilder-style (RMA/SMMA), not SMA-only, not EMA-ATR.

---

## 9) Optional: Range-rule stage classification (if you already classify zones)
If you also label the 7 "range rules" stages, use the StockCharts definitions:

- Risk (Oversold): `MACD_V < -150`
- Rebounding: `-150 < MACD_V < +50` and `MACD_V > Signal`
- Rallying: `+50 < MACD_V < +150` and `MACD_V > Signal`
- Risk (Overbought): `MACD_V > +150` and `MACD_V > Signal`
- Retracing: `MACD_V > -50` and `MACD_V < Signal`
- Reversing: `-150 < MACD_V < -50` and `MACD_V < Signal`
- Ranging (Neutral Zone): `-50 < MACD_V < +50` for **20–30+ bars**

If you don't need classification, skip it. The core deliverable is the math above.

---

## 10) Low-Liquidity Handling

For symbols with sparse trading activity (e.g., SKL-USD on 1-minute timeframe), standard ATR calculation fails because exchanges omit candles for periods with no trades. When gap-filled, these synthetic candles have TR=0, causing ATR to collapse toward zero and MACD-V to explode.

**Solution:** Use **Informative ATR** which treats synthetic candles as missing observations (not zero-volatility events).

See **`Low-Liquidity-Handling.md`** for:
- Root cause analysis
- Informative ATR algorithm
- `isSynthetic` candle tagging
- Validity metadata (`seeded`, `nEff`, `spanBars`, `reason`)
- API response format
