# Livermore Trading Platform

## What This Is

A real-time cryptocurrency trading analysis platform that monitors exchange data (starting with Coinbase), calculates technical indicators (MACD-V), and fires alerts when signal conditions are met. Designed for multi-exchange support with Binance.us and Binance.com planned for future milestones.

## Core Value

Data accuracy and timely alerts — indicators must calculate on complete, accurate candle data, and signals must fire reliably without missing conditions or producing false positives from stale data.

## Current Milestone: v2.0 Data Pipeline Redesign

**Goal:** Eliminate 429 errors by redesigning the data pipeline to be event-driven and cache-first, with architecture supporting multiple exchanges.

**Target features:**
- Exchange adapter pattern (exchange-agnostic indicator service)
- Cache as single source of truth for candle data
- WebSocket-driven candle updates (no timer-based polling)
- Background reconciliation for gap detection and self-healing
- Zero REST API calls during normal operation (startup backfill only)

## Requirements

### Validated

- ✓ Coinbase REST client with JWT authentication — v1.0
- ✓ Transaction summary endpoint (current fee tier, 30-day volume) — v1.0
- ✓ CoinbaseOrder interface with fee fields — v1.0
- ✓ WebSocket ticker subscription for real-time price updates — existing
- ✓ 1m candle building from ticker data — existing
- ✓ MACDV calculation across all timeframes (1m, 5m, 15m, 1h, 4h, 1d) — existing
- ✓ Redis cache for candle and indicator storage — existing
- ✓ Alert system for signal notifications — existing

### Active

- [ ] Exchange adapter abstraction layer
- [ ] Unified candle cache schema (exchange-agnostic)
- [ ] WebSocket candles channel subscription (Coinbase 5m native candles)
- [ ] Cache-first indicator calculation (no REST during normal operation)
- [ ] Background reconciliation job for gap detection
- [ ] Startup backfill with 60-candle minimum per symbol/timeframe
- [ ] Event-driven architecture (candle close → indicator calc → alert)

### Out of Scope

- Binance.us adapter implementation — architecture ready, implementation deferred
- Binance.com adapter implementation — architecture ready, implementation deferred
- Additional indicators (SMA, RSI) — confluence stacking is future milestone
- Liquidity detection — out of scope for v2.0
- Real-time chat/notifications beyond existing alerts — not needed
- Fee analysis integration — v1.0 spike was standalone

## Context

**Problem being solved:**
Current architecture hits Coinbase REST API on every candle recalculation, causing 429 (rate limit) errors at timeframe boundaries. At 4h boundary with 25 symbols: 125+ REST calls in burst.

**Root causes identified:**
1. WebSocket-built candles not saved to Redis cache
2. Indicator service always calls REST API for candles
3. Not using WebSocket `candles` channel for native 5m data
4. Batching (5 req/batch, 1s delay) insufficient for burst prevention

**Target architecture (Pattern D: Hybrid with Reconciliation):**
```
Per Exchange:
  [Exchange WebSocket] → [Exchange Adapter] → writes to unified cache
                                            → emits candle event

Shared:
  [Indicator Service] ← subscribes to candle events
                     ← reads from unified cache for history

Background:
  [Reconciliation Job] → periodic REST checks per exchange
                       → fills gaps in cache
```

**Multi-exchange considerations:**
- Coinbase: symbols from account holdings (≥$2 value)
- Binance (future): static symbol list or top-100 active
- Each exchange adapter responsible for its own auth, rate limits, data format
- Unified cache schema normalizes data for indicator service

## Constraints

- **Event-driven**: No timer-based polling for indicator calculations. System must be driven by exchange data.
- **60-candle minimum**: MACDV requires at least 60 candles per symbol/timeframe for accurate alignment with charts.
- **Latency targets**: 1m/5m signals <10s, 4h/1d signals can tolerate 30s-1m delay.
- **Coinbase rate limits**: Must respect API limits, hence move to WebSocket + cache-first.
- **Incremental refactor**: Existing MACDV functionality must work throughout refactor.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pattern D: Hybrid with Reconciliation | Data accuracy (#1) + Reliability (#2) priorities | — Pending |
| Exchange adapter abstraction | Multi-exchange support planned (Binance.us, Binance.com) | — Pending |
| Incremental transition | Verify each layer before removing REST safety net | — Pending |
| Cache as source of truth | Indicator service should never know about exchange APIs | — Pending |
| WebSocket candles channel | Coinbase provides native 5m candles via WebSocket | — Pending |

---
*Last updated: 2026-01-19 after v2.0 milestone initialization*
