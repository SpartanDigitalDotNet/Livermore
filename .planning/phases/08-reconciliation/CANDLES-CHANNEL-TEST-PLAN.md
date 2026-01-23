# Candles Channel Test Plan

**Created:** 2026-01-22
**Goal:** Determine what the Coinbase WebSocket candles channel actually provides

## Context

We need all timeframes (5m, 15m, 1h, 4h, 1d) in Redis for up to 100 symbols with:
- Zero 429 errors
- No aggregation (building higher timeframes from lower)
- No cron jobs

The documentation is unclear on what the candles channel provides on subscription. We need empirical testing.

## Constraints (Non-Negotiable)

1. **No aggregation** — We will never build higher timeframes from 5m candles
2. **No cron jobs** — No scheduled background tasks
3. **No excessive REST calls** — Must avoid 429 rate limit errors

## Questions to Answer

### Primary Questions

1. **Snapshot size**: How many candles are returned on initial subscription?
2. **Granularity options**: Can we specify timeframe, or is it fixed at 5m?
3. **Multiple subscriptions**: Can we subscribe to multiple granularities?
4. **Message format**: What exactly does the snapshot and update messages contain?

### Secondary Questions

5. **Reconnection behavior**: Do we get a fresh snapshot on reconnect?
6. **Historical depth**: How far back does the snapshot go?
7. **Rate limits**: Any limits on subscription messages?

## Test Harness Requirements

### PowerShell Script: `test-candles-channel.ps1`

**Features:**
- Connect to `wss://advanced-trade-ws.coinbase.com`
- Subscribe to candles channel for a single symbol (BTC-USD)
- Log all messages received (snapshot and updates)
- Count candles in snapshot
- Record message timestamps and format
- Test with/without authentication
- Output results to JSON for analysis

**Test Scenarios:**

1. **Basic subscription** — Subscribe to candles for BTC-USD, log snapshot
2. **Multiple symbols** — Subscribe with multiple product_ids, compare snapshots
3. **Reconnection test** — Disconnect and reconnect, verify snapshot consistency
4. **Authenticated vs unauthenticated** — Compare behavior

### Output Format

```json
{
  "test_timestamp": "2026-01-22T...",
  "endpoint": "wss://advanced-trade-ws.coinbase.com",
  "channel": "candles",
  "product_ids": ["BTC-USD"],
  "authenticated": false,
  "snapshot": {
    "candle_count": null,
    "oldest_timestamp": null,
    "newest_timestamp": null,
    "granularity_detected": null,
    "raw_message": {}
  },
  "updates": [],
  "observations": []
}
```

## Success Criteria

Test is successful if we can answer:
- [ ] Exact number of candles in snapshot
- [ ] Whether granularity can be specified
- [ ] Whether snapshot provides enough history for MACD-V (100 candles per timeframe)
- [ ] Message format documented

## Future Scope (Out of Current Scope)

- Binance WebSocket candles testing
- Binance.us WebSocket candles testing
- Other exchange adapters

These will follow the same test harness pattern once Coinbase is understood.

## Next Steps Based on Results

**If candles channel provides multiple timeframes or enough 5m history:**
- Design cache-population strategy using WebSocket only
- Implement adapter to consume snapshot + updates

**If candles channel is insufficient:**
- Document limitations
- Design hybrid approach (WebSocket for live, minimal REST for gaps)
- Explore alternative event-driven triggers (not cron)

---
*Plan created: 2026-01-22*
