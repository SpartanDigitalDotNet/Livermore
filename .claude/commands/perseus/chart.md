---
name: perseus:chart
description: Generate MACD-V charts (PNG, dark theme) and post to Discord
argument-hint: "[SYMBOL] [TIMEFRAME] [discord]"
allowed-tools:
  - Bash
  - Read
  - Glob
---

<objective>
Generate dark-themed MACD-V chart PNGs from live Redis candle data and optionally post
them to Discord. Uses the existing @livermore/charts package (ECharts + node-canvas).
Charts show candlestick price action with EMA(9) on top, MACD-V with Hermes color zones,
signal line, and histogram on the bottom panel.
</objective>

<critical_rules>
- NEVER look for .env files. Env vars injected via .ps1 from Windows User scope.
- Always use `scripts/generate-chart.ps1` — it handles env injection.
- Dark theme only (already the default in @livermore/charts).
- Exchange ID is always 1 (Coinbase) unless specified otherwise.
- Need at least 35 candles for valid MACD-V warmup.
</critical_rules>

<context>
## Chart Script

```
scripts/generate-chart.ps1 -Symbol "BTC-USD" -Timeframe "15m" [-Discord] [-Bars 60]
```

Invoked via:
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/generate-chart.ps1" -Symbol "SYMBOL" -Timeframe "TF" [-Discord] [-Bars N]
```

Parameters:
- `-Symbol` — Trading pair (default: BTC-USD)
- `-Timeframe` — 1m, 5m, 15m, 1h, 4h, 1d (default: 15m)
- `-Discord` — Switch flag to post to Discord after generating
- `-Bars` — Number of display bars (default: 60)

Output:
- PNG saved to `tmp/{SYMBOL}-{TF}-macdv.png`
- If `-Discord`: posted as embed with price and data age

## Available Timeframes
1m, 5m, 15m, 30m, 1h, 4h, 1d

## Chart Features
- Top panel: Candlesticks + Price line + EMA(9) + Volume bars
- Bottom panel: MACD-V dots (Hermes color zones) + Signal line + Histogram
- Reference lines at +/-50 (neutral) and +/-150 (extreme)
- Dark theme optimized for Discord (#1a1a2e background)
</context>

<process>
Parse $ARGUMENTS to determine what to generate.

## Single symbol chart
If argument is a symbol (e.g., "BTC-USD") with optional timeframe and "discord":

1. Parse symbol, timeframe (default 15m), and discord flag from arguments
2. Run generate-chart.ps1 with appropriate parameters
3. Read the generated PNG to verify it rendered correctly
4. Report: symbol, timeframe, bar count, file size, MACD-V visible range

Examples:
- `/perseus:chart BTC-USD` → 15m chart, saved locally
- `/perseus:chart ETH-USD 1h` → 1h chart, saved locally
- `/perseus:chart BTC-USD 15m discord` → 15m chart, posted to Discord
- `/perseus:chart SOL-USD discord` → 15m chart, posted to Discord

## Multiple symbols (compare)
If argument starts with "compare" followed by symbols:

1. Generate charts for each symbol at the same timeframe
2. Post each to Discord sequentially
3. Report summary

Example:
- `/perseus:chart compare BTC-USD ETH-USD SOL-USD 1h discord`

## Oversold charts
If argument is "oversold":

1. Run check-macdv-oversold.ps1 to find top oversold symbols
2. Generate charts for the top 5 most oversold on the daily timeframe
3. Post all to Discord

## Default
If no arguments, generate BTC-USD 15m and save locally.
</process>

<success_criteria>
- [ ] PNG chart generated and saved to tmp/
- [ ] Chart uses dark theme (no light/white charts)
- [ ] MACD-V indicator visible with Hermes color zones
- [ ] If discord flag set, image posted as Discord embed
- [ ] Price and data freshness shown in Discord embed
</success_criteria>
