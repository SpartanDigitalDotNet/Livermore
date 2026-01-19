# Research Summary: v2.0 Data Pipeline Redesign

**Project:** Livermore Trading Platform
**Synthesized:** 2026-01-19
**Overall Confidence:** HIGH

## Executive Summary

The v2.0 data pipeline redesign transforms the Livermore platform from a REST-heavy, request-driven architecture to a cache-first, event-driven system. The core problem being solved is excessive REST API calls during indicator recalculation (currently making REST calls for every candle fetch, leading to 429 rate limit errors). The solution uses an exchange adapter pattern where Coinbase WebSocket data flows directly to Redis cache, with the indicator service consuming exclusively from cache via candle close events.

The recommended approach leverages the existing technology stack (TypeScript, Redis with ioredis, Fastify/tRPC) with minimal additions: only `node-cron` for background reconciliation scheduling. The existing Coinbase WebSocket client is extended rather than replaced, and the cache layer already supports sorted sets with the correct key schema. The architecture is designed for multi-exchange support (Binance.us and Binance.com planned) through a unified adapter interface, ensuring the indicator service remains exchange-agnostic.

Key risks include silent WebSocket disconnections (data goes stale without errors), race conditions in concurrent cache updates, and data gaps during reconnection. These are mitigated through watchdog timers, timestamp-based versioned writes, and background reconciliation jobs. The migration strategy is incremental: add cache writes first, verify data flowing, then switch reads - never a "big bang" cutover that risks breaking existing MACD-V functionality.

## Stack

**Existing (reuse):**
| Technology | Version | Purpose |
|------------|---------|---------|
| TypeScript | 5.6.3 | All application code |
| Node.js | 20+ | Runtime (required for worker threads, generic EventEmitter) |
| Fastify | 5.2.2 | HTTP server |
| tRPC | 11.0.2 | Type-safe API |
| ioredis | 5.4.2 | Redis client (supports pub/sub, sorted sets) |
| Pino | 9.5.0 | Structured logging |
| Zod | 3.24.1 | Runtime validation |
| ws | 8.18.0 | WebSocket client |
| Drizzle ORM | 0.36.4 | Database ORM |

**Additions needed:**
| Addition | Rationale |
|----------|-----------|
| `node-cron` ^3.0.3 | Background job scheduling for reconciliation (5-minute gap detection, hourly full reconciliation) |
| `@types/node-cron` | TypeScript types for node-cron |
| Typed EventEmitter (native) | Use Node.js native EventEmitter with TypeScript generics (@types/node 20+ supports this) |
| Candles WebSocket channel | Add `candles` channel type to existing Coinbase WebSocket client for native 5m data |

**Not recommended:**
- CCXT: Massive dependency (100+ exchanges) when only 2-3 needed; existing custom client works
- BullMQ: Over-engineered for single-process background jobs
- typed-emitter package: Native support in @types/node since Node 20

## Key Features

**Table Stakes:**
| Feature | Description |
|---------|-------------|
| Exchange Adapter Interface | Single interface for all exchanges; indicator service must not know exchange specifics |
| WebSocket Connection Management | Connect, disconnect, reconnect with exponential backoff |
| Heartbeat Subscription | Auto-subscribe to heartbeats on connect to prevent 60-90s idle disconnection |
| Candle Normalization | Convert exchange-specific formats to unified `UnifiedCandle` schema |
| Event Emission | Emit standardized `candle:close` events when candles finalize |
| Cache Writing | Write candles directly to Redis sorted sets |
| Sequence Tracking | Track WebSocket message sequence numbers for gap detection |
| Startup Backfill | Fetch 60+ historical candles via REST on startup |
| Gap Detection Query | Find missing timestamps in candle sequences |
| Timeframe Aggregation | Build 15m/1h/4h/1d from 5m candles (Coinbase only provides 5m via WebSocket) |
| Rate-Limited Backfill | Stagger REST calls at startup to avoid 429s |

**Differentiators (optional):**
| Feature | Value |
|---------|-------|
| Connection Health Metrics | Observability for production monitoring |
| Circuit Breaker | Stop reconnect attempts after N failures |
| TTL Jitter | Prevent cache stampede at expiration |
| Priority-Based Gap Fill | Fill shorter timeframes (1m, 5m) before longer ones |

**Anti-features (skip for v2.0):**
| Feature | Why Skip |
|---------|----------|
| Full Order Book (Level2) | Not needed for MACD-V calculation |
| Trade Execution | v2.0 is monitoring only |
| CCXT Library | Performance overhead, 100+ exchange abstraction unnecessary |
| Cross-Region Replication | Single-region deployment sufficient |
| Historical Backfill Beyond 60 Candles | 60 is sufficient for MACD-V accuracy |
| Binance Adapter Implementation | Architecture supports it; defer implementation |

## Architecture

**Recommended approach:**

The adapter pattern creates a clean separation between exchange-specific logic and the indicator calculation service:

```
External Sources -> Exchange Adapters -> Unified Cache -> Indicator Service -> Alerts
                                             |
                              Reconciliation Job (gap filling)
```

Key principles:
1. **Adapters own exchange logic**: Connection management, auth, data normalization, rate limits
2. **Cache is source of truth**: All reads come from Redis, not REST API
3. **Events drive updates**: Indicator service subscribes to `candle:close` events, never polls
4. **Reconciliation is background**: Gap detection and filling happens asynchronously

**Build order:**

| Phase | Focus | Deliverables |
|-------|-------|--------------|
| **Phase 1: Foundation** | Interfaces and base classes | `IExchangeAdapter`, `UnifiedCandle`, `ExchangeAdapterEvents`, `candleCloseChannel()` key pattern, base adapter abstract class |
| **Phase 2: Coinbase Adapter** | WebSocket + cache integration | Implement `CoinbaseAdapter`, add `candles` channel subscription, normalize messages, write to cache, emit close events |
| **Phase 3: Indicator Refactor** | Event-driven calculation | Subscribe to `candle:close`, remove REST API calls from recalculation, read exclusively from cache, add readiness checks (60 candle minimum) |
| **Phase 4: Startup Backfill** | Historical data population | Rate-limited REST backfill on startup (5 requests/batch, 1s delay), progress tracking, priority order (1m first) |
| **Phase 5: Reconciliation** | Background gap filling | `node-cron` scheduled jobs (5-min gap scan, hourly full reconciliation), REST backfill for gaps |
| **Phase 6: Cleanup** | Remove legacy code | Deprecate old `CoinbaseWebSocketService`, remove REST calls from hot path, update server.ts |

**Dependency graph:**
- Phase 1 blocks all others (interfaces required first)
- Phase 2 blocks Phase 3 (adapter must exist for indicator refactor)
- Phase 3 blocks Phase 5 (indicator service must be event-driven before reconciliation matters)
- Phase 4 and Phase 5 can run in parallel after Phase 3
- Phase 6 requires Phase 4 and 5 complete

## Pitfalls to Avoid

### 1. Silent WebSocket Disconnections (CRITICAL)
**Problem:** Connection drops without triggering error handlers; data goes stale without awareness.
**Prevention:** Implement watchdog timer comparing last message timestamp to current time. If no message received within 30 seconds, force reconnection. Log timestamp of every message.
**Phase:** Phase 2 (Coinbase Adapter) - build into adapter foundation.

### 2. Cache-REST Data Mismatch (CRITICAL)
**Problem:** WebSocket-built candles differ from REST candles for same period, causing wrong indicator values.
**Prevention:** Use native `candles` channel for 5m (exchange's official aggregation). Implement periodic validation comparing cached candles to REST. Align boundaries to UTC.
**Phase:** Phase 5 (Reconciliation) - add validation job.

### 3. Race Conditions in Event-Driven Cache Updates (CRITICAL)
**Problem:** Multiple events updating same cache key simultaneously causes corruption or out-of-order writes.
**Prevention:** Use timestamp-based versioning - only accept writes if timestamp > existing timestamp. Process events sequentially per symbol, parallel across symbols.
**Phase:** Phase 1 (Foundation) - build versioning into cache operations from start.

### 4. Reconnection Without State Recovery (CRITICAL)
**Problem:** After reconnection, system resumes but has data gap that corrupts indicator calculations.
**Prevention:** On reconnection, calculate time gap since last candle. If gap > 1 candle period, trigger REST backfill before resuming normal operation.
**Phase:** Phase 2 (Coinbase Adapter) - part of connection recovery logic.

### 5. Losing Existing Functionality During Refactor (HIGH)
**Problem:** While refactoring to cache-first, working MACD calculations break due to incomplete migration.
**Prevention:** Incremental migration: add cache writes first (parallel to existing REST reads), verify data flowing, then switch reads with REST fallback, then remove fallback. Never "big bang" cutover.
**Phase:** All phases - constraint throughout refactor.

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| Stack | HIGH | Minimal additions to proven stack; node-cron is mature |
| Features | HIGH | Based on official Coinbase documentation; channels verified |
| Architecture | HIGH | Adapter pattern matches existing codebase patterns |
| Pitfalls | HIGH | Verified with official docs and community sources |

**Gaps to address during planning:**
- 4h timeframe not natively supported by Coinbase REST (must aggregate from 1h)
- Exact rate limit handling strategy for 25 symbols x 6 timeframes startup backfill
- Testing strategy for race conditions (hard to reproduce in dev)

## Sources

**Official Documentation:**
- [Coinbase WebSocket Channels](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels)
- [Coinbase WebSocket Overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview)
- [ioredis GitHub](https://github.com/redis/ioredis)
- [@types/node EventEmitter generics](https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/55298)

**Architecture Patterns:**
- [CCXT Library](https://github.com/ccxt/ccxt) - Reference for adapter pattern (not used, but informed design)
- [Flowsurface Exchange Architecture](https://deepwiki.com/akenshaw/flowsurface/5.1-exchange-architecture)
- [Event-Driven Architecture in JavaScript](https://dev.to/hamzakhan/event-driven-architecture-in-javascript-applications-a-2025-deep-dive-4b8g)

**Pitfall Prevention:**
- [Redis Cache Consistency](https://redis.io/blog/three-ways-to-maintain-cache-consistency/)
- [CoinAPI OHLCV Data Explained](https://www.coinapi.io/blog/ohlcv-data-explained-real-time-updates-websocket-behavior-and-trading-applications)
- [Event-Driven.io Race Conditions](https://event-driven.io/en/dealing_with_race_conditions_in_eda_using_read_models/)

---
*Summary created: 2026-01-19*
