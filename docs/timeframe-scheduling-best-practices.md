# Timeframe-Based Job Scheduling in Financial Markets

## Research Findings for Indicator Calculation Scheduling

### Executive Summary

The current implementation of polling ALL timeframes every 60 seconds is **fundamentally incorrect** for financial market data systems. Industry best practices dictate that indicator calculations should be triggered **at or shortly after candle close**, not on a fixed polling interval.

---

## 1. Candle Close Timing (UTC Standard)

Cryptocurrency exchanges (Coinbase, Binance, Kraken) standardize candle close times to UTC:

| Timeframe | Candle Closes At |
|-----------|------------------|
| 1m | Every minute at :00 seconds |
| 5m | :00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55 |
| 15m | :00, :15, :30, :45 |
| 1h | Top of every hour (:00) |
| 4h | 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC |
| 1d | 00:00 UTC (midnight) |
| 1w | Sunday 00:00 UTC |

**Source:** [Bitget - When Does Bitcoin Daily Candle Close](https://www.bitget.com/wiki/when-does-bitcoin-daily-candle-close-est), [Gate.io - Daily Candle Close Guide](https://www.gate.com/crypto-wiki/article/when-does-bitcoin-daily-candle-close-est-full-trading-guide)

> "Most popular cryptocurrency trading platforms like Binance, Coinbase, and Kraken follow the universal standard of a daily candle close at 00:00 UTC."

---

## 2. Event-Driven vs. Polling Architecture

### Industry Standard: Event-Driven

Professional trading platforms use **event-driven architecture** where indicator calculations are triggered by candle close events, NOT fixed polling intervals.

**QuantConnect/LEAN Framework:**
> "Scheduled Events let you trigger code to run at specific times of day, regardless of your algorithm's data subscriptions. It's easier and more reliable to execute time-based events with Scheduled Events than checking the current algorithm time in the OnData event handler."

**Source:** [QuantConnect - Scheduled Events Documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/scheduled-events)

**NautilusTrader:**
> "NautilusTrader is an open-source, high-performance, production-grade algorithmic trading platform, providing quantitative traders with the ability to backtest portfolios of automated trading strategies on historical data with an **event-driven engine**."

**Source:** [NautilusTrader GitHub](https://github.com/nautechsystems/nautilus_trader)

### Why Polling is Inferior

1. **Wasted API calls**: Polling 1d candles every 60 seconds = 1,440 calls/day for data that changes once
2. **Stale data risk**: By the time polling cycles through all configs, short timeframes are already stale
3. **Rate limiting**: Excessive API calls risk exchange bans
4. **Resource waste**: CPU/memory spent on redundant calculations

**Coinbase explicitly warns against frequent polling:**
> "Historical rates should not be polled frequently. For real-time info, use the trade and book endpoints in conjunction with the WebSocket feed."

**Source:** [Coinbase - Get Product Candles API](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)

---

## 3. Correct Scheduling Approach

### Option A: Scheduled Events at Candle Close + Offset

Trigger indicator calculation **shortly after** each timeframe's candle closes to ensure the data is available:

```
Timeframe | Trigger Schedule (UTC)
----------|------------------------
1m        | Every minute at :01 seconds (1s after close)
5m        | :00:05, :05:05, :10:05, etc. (5s after close)
15m       | :00:10, :15:10, :30:10, :45:10 (10s after close)
1h        | :00:15 of each hour (15s after close)
4h        | 00:00:30, 04:00:30, 08:00:30, etc. (30s after close)
1d        | 00:01:00 UTC (1 minute after midnight)
```

The offset accounts for:
- Exchange processing delay
- API propagation time
- Network latency

**Source:** [QuantConnect - Calendar Consolidators](https://www.quantconnect.com/docs/v2/writing-algorithms/consolidating-data/consolidator-types/calendar-consolidators)

### Option B: Single Tick with Boundary Detection

Use a single fast interval (e.g., every 10 seconds) that checks if a candle boundary has passed:

```typescript
const lastUpdate: Record<Timeframe, number> = {};

function shouldUpdate(timeframe: Timeframe, now: number): boolean {
  const boundary = getCurrentCandleBoundary(timeframe, now);
  if (boundary > lastUpdate[timeframe]) {
    lastUpdate[timeframe] = boundary;
    return true;
  }
  return false;
}
```

This ensures:
- 1m candles: checked every tick, updated when minute boundary passes
- 1d candles: checked every tick, but only updated once per day

---

## 4. WebSocket vs REST for Real-Time Data

### Best Practice: Hybrid Approach

> "You can ignore interim WebSocket updates, process only completed cryptocurrency candles for traditional technical analysis, or use real-time WebSocket monitoring + final cryptocurrency confirmations for professional trading systems."

**Source:** [CoinAPI - OHLCV Data Explained](https://www.coinapi.io/blog/ohlcv-data-explained-real-time-updates-websocket-behavior-and-trading-applications)

**Recommended Architecture:**
1. **WebSocket**: Stream real-time ticker/trade data for live price display
2. **REST API**: Fetch completed candles at scheduled times for indicator calculation
3. **Event-driven**: Trigger calculations at candle close, not arbitrary intervals

---

## 5. Rate Limiting Considerations

**Freqtrade Configuration Example:**
> "rateLimit: 200 defines a wait-event of 0.2s between each call to avoid bans from the exchange."

**Source:** [Freqtrade Configuration Docs](https://www.freqtrade.io/en/2019.6/configuration/)

For 25 symbols:
- 1m update: 25 API calls at candle close = ~5 seconds with rate limiting
- No overlap with other timeframes since they update at different boundaries

---

## 6. Recommended Implementation for Livermore

### Current (Incorrect):
```
Every 60 seconds:
  For ALL 150 configs (25 symbols × 6 timeframes):
    Fetch candles
    Calculate indicators
```

### Proposed (Correct):
```
Every 10 seconds (tick):
  currentTime = now()

  For each timeframe:
    boundary = getCandleBoundary(timeframe, currentTime)
    if boundary > lastUpdate[timeframe] + smallOffset:
      For each symbol:
        Fetch latest candle for this timeframe
        Update cache
        Calculate indicator
      lastUpdate[timeframe] = boundary
```

### Expected Results:

| Timeframe | Updates Per Day | API Calls Per Day |
|-----------|-----------------|-------------------|
| 1m | 1,440 | 36,000 (25 × 1,440) |
| 5m | 288 | 7,200 (25 × 288) |
| 15m | 96 | 2,400 (25 × 96) |
| 1h | 24 | 600 (25 × 24) |
| 4h | 6 | 150 (25 × 6) |
| 1d | 1 | 25 (25 × 1) |

**Total: ~46,375 calls/day** (properly distributed)

vs. Current approach: **216,000 calls/day** (150 × 1,440) - mostly wasted

---

## 7. Key Takeaways

1. **Candle close is the trigger** - Not arbitrary polling intervals
2. **Match update frequency to timeframe** - 1m needs minute-level updates, 1d needs daily updates
3. **Use small offset after close** - Account for data propagation delay
4. **Avoid polling historical data** - Per Coinbase API guidelines
5. **Event-driven > Polling** - Industry standard for professional trading systems

---

## Sources

1. [QuantConnect - Scheduled Events](https://www.quantconnect.com/docs/v2/writing-algorithms/scheduled-events)
2. [QuantConnect - Time Period Consolidators](https://www.quantconnect.com/docs/v2/writing-algorithms/consolidating-data/consolidator-types/time-period-consolidators)
3. [QuantConnect - Calendar Consolidators](https://www.quantconnect.com/docs/v2/writing-algorithms/consolidating-data/consolidator-types/calendar-consolidators)
4. [QuantConnect - Updating Indicators](https://www.quantconnect.com/docs/v2/writing-algorithms/consolidating-data/updating-indicators)
5. [NautilusTrader - Event-Driven Trading Platform](https://github.com/nautechsystems/nautilus_trader)
6. [CoinAPI - OHLCV Data Explained](https://www.coinapi.io/blog/ohlcv-data-explained-real-time-updates-websocket-behavior-and-trading-applications)
7. [CoinAPI - WebSocket vs REST APIs](https://www.coinapi.io/blog/why-websocket-multiple-updates-beat-rest-apis-for-real-time-crypto-trading)
8. [Coinbase - Get Product Candles API](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)
9. [Freqtrade - Configuration](https://www.freqtrade.io/en/2019.6/configuration/)
10. [Bitget - Bitcoin Daily Candle Close](https://www.bitget.com/wiki/when-does-bitcoin-daily-candle-close-est)
11. [Gate.io - Daily Candle Close Guide](https://www.gate.com/crypto-wiki/article/when-does-bitcoin-daily-candle-close-est-full-trading-guide)
12. [BYDFi - Weekly Candle Close Time](https://www.bydfi.com/en/questions/at-what-time-does-the-weekly-candle-for-bitcoin-end)
13. [TradingView - Alert on Candle Close](https://www.tradingview.com/script/4UCBJDQS-Alert-on-Candle-Close/)
14. [Mind Math Money - Multi Timeframe Trading Strategy](https://www.mindmathmoney.com/articles/multi-timeframe-analysis-trading-strategy-the-complete-guide-to-trading-multiple-timeframes)
