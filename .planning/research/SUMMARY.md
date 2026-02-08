# Research Summary: Livermore v5.0 Distributed Exchange Architecture

**Synthesized:** 2026-02-06
**Research Files:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Overall Confidence:** HIGH

---

## Executive Summary

The v5.0 milestone transforms Livermore from a user-scoped single-exchange platform to an exchange-scoped distributed architecture. The core value proposition is cross-exchange visibility enabling "trigger remotely, buy locally" soft-arbitrage: signals from one exchange (Mike's Coinbase) inform trading decisions on another (Kaia's Binance). The architecture change is fundamentally a **data access pattern shift**, not a ground-up rewrite. Current Redis keys embed `userId:exchangeId` in every key; v5.0 separates "shared data" (exchange-scoped, no userId) from "overflow data" (user-specific symbols not in the shared pool).

The recommended approach uses **exchange-specific adapters** rather than unified abstraction libraries like CCXT. Each exchange has distinct WebSocket protocols (MEXC uses protobuf), connection lifecycles (KuCoin requires token fetch), rate limits, and geo-restrictions. The existing `BaseExchangeAdapter` pattern should be extended with exchange-specific implementations using the `binance` npm package for Binance.com/US, `kucoin-universal-sdk` for KuCoin, and direct implementation with `protobufjs` for MEXC.

Key risks center on the migration itself: Redis key migration during live WebSocket data production, symbol normalization across exchanges (BTC-USD vs BTCUSDT), pub/sub channel breakage, and geo-restriction blind spots. Mitigation requires dual-write phases, canonical symbol formats, and explicit geo-checking before exchange connection attempts. The idle startup mode (API awaits `start` command rather than auto-connecting) provides deployment flexibility and resource optimization.

---

## Key Findings

### From STACK.md

| Exchange | Key Insight |
|----------|-------------|
| Coinbase | Already implemented; 5m native WebSocket candles, 1m aggregated from trades; JWT auth with ES256 |
| Binance.com | Blocked in US (VPN = ToS violation + ban risk); 24h max connection lifetime; HMAC-SHA256 auth |
| Binance.US | Nearly identical API to Binance.com; configurable base URLs; smaller pair selection |
| MEXC | **Uses protobuf encoding** (unique); 30 subscription limit per connection; not available in US |
| KuCoin | **Must request WebSocket token first** via REST; 300 subscriptions/connection; not available in US |

**Stack Recommendations:**
- `binance` npm (tiagosiebler) for Binance.com + Binance.US
- `kucoin-universal-sdk` for KuCoin (official; old SDK archived March 2025)
- `protobufjs` for MEXC message parsing
- Continue native adapter pattern (no CCXT)

### From FEATURES.md

**Table Stakes (Must Have):**
- `exchanges` metadata table with API limits, geo restrictions, supported timeframes
- Exchange-scoped Redis keys (`candles:{exchangeId}:{symbol}:{timeframe}`)
- User overflow keys for positions/manual adds with TTL
- Tier 1 (Top N by volume) + Tier 2 (user positions) symbol sourcing
- Idle startup mode with explicit `start` command
- Cross-exchange pub/sub visibility

**Differentiators:**
- Soft-arbitrage signals ("BTC moving on Coinbase" while viewing Binance)
- Exchange latency comparison for same symbol
- Exchange health dashboard

**Anti-Features (Do NOT Build):**
- Trade execution (monitoring-only platform)
- Full orderbook aggregation
- Cross-exchange position netting
- CCXT integration
- 1m candle support (5m is minimum)

### From ARCHITECTURE.md

**Build Order (7 Phases):**
1. Database Foundation - `exchanges` table, FK to `user_exchanges`, symbol sourcing tables
2. Key Pattern Refactor - New shared/user key functions, backward compatibility
3. Cache Strategy Updates - Tier-aware cache operations, fallback reads
4. Service Refactor - Remove hardcoded `TEST_USER_ID`, accept exchangeId config
5. Idle Startup Mode - State machine, `start` command, `--autostart` flag
6. Symbol Sourcing - Tier 1/Tier 2 management, volume-based refresh
7. Migration Cleanup - Remove legacy keys, deprecated functions, old code

**Key Changes:**
- Redis keys drop userId prefix for shared pool
- New `exchanges` table centralizes metadata
- Services receive exchangeId from config, not hardcoded
- Control channel adds `start` command handler
- Dual-read pattern during migration (exchange-scoped first, user-scoped fallback)

### From PITFALLS.md

**Critical Pitfalls:**

| Pitfall | Prevention |
|---------|------------|
| Key migration during live data | Dual-write phase OR stop-the-world; validate candle counts before cutover |
| Symbol normalization gaps | Canonical `BASE-QUOTE` format; normalize at adapter boundary |
| Redis Cluster cross-slot failures | Preserve per-key loop pattern; avoid pipeline across slots |
| Geo-restriction detection failure | IP geolocation at startup; `geo_allowed` in exchanges table |
| Exchange rate limit divergence | Per-exchange rate limiter; monitor weight headers; exponential backoff |

**Phase Warnings:**
- Phase 1 (Key Migration): Orphaned keys, pub/sub breakage, TypeScript type breakage
- Phase 2 (Exchange Metadata): Stale metadata after deployment
- Phase 4 (Idle Startup): Race condition on `start` command
- Phase 5 (Symbol Sourcing): Shared pool starvation if no user monitors symbol

---

## Implications for Roadmap

### Suggested Phase Structure

The research strongly suggests this phase order based on dependencies and risk:

**Phase 1: Database Foundation**
- Create `exchanges` metadata table
- Add `exchange_id` FK to `user_exchanges`
- Create `exchange_symbols` and `user_symbol_subscriptions` tables
- **Rationale:** Foundation for all exchange-specific behavior; no code changes until DB ready
- **Delivers:** Normalized exchange data, centralized metadata
- **Pitfalls to avoid:** FK constraint ordering (exchanges before user_exchanges FK)

**Phase 2: Key Pattern + Cache Strategies**
- Add new shared/user key functions to `keys.ts`
- Update cache strategies for tier-aware writes
- Implement dual-read pattern (shared first, user fallback)
- **Rationale:** Must stabilize key format before touching services
- **Delivers:** Backward-compatible key infrastructure
- **Pitfalls to avoid:** Redis Cluster cross-slot issues, TypeScript breakage

**Phase 3: Service Refactor**
- Remove hardcoded `TEST_USER_ID`, `TEST_EXCHANGE_ID`
- Services accept exchangeId from config
- Update subscription patterns for new channel format
- **Rationale:** Services must use new key patterns before new adapters
- **Delivers:** Configurable services, no hardcoded IDs
- **Pitfalls to avoid:** Pub/sub channel migration breaks subscribers

**Phase 4: Idle Startup Mode**
- Implement `IdleStartupManager` with state machine
- Add `start` command to ControlChannelService
- Add `--autostart <exchange>` CLI flag
- **Rationale:** Required for clean multi-exchange deployment
- **Delivers:** Lazy initialization, explicit resource control
- **Pitfalls to avoid:** Race condition on `start` command before services ready

**Phase 5: Symbol Sourcing + Cross-Exchange Visibility**
- Implement `SymbolSourceService` for Tier 1/Tier 2
- Tier 1 refresh from exchange volume endpoints
- Cross-exchange pub/sub channels
- **Rationale:** Symbol sourcing depends on all prior phases
- **Delivers:** Dynamic symbol management, cross-exchange signals
- **Pitfalls to avoid:** Shared pool starvation

**Phase 6: Binance Adapter**
- Implement BinanceAdapter extending BaseExchangeAdapter
- Use `binance` npm package
- Per-exchange rate limiter
- **Rationale:** Second exchange validates multi-exchange architecture
- **Delivers:** Binance.com + Binance.US support
- **Pitfalls to avoid:** Rate limit divergence, geo-restriction blind spots

**Phase 7: Migration Cleanup + Additional Exchanges**
- Remove legacy key functions
- Delete orphaned Redis keys
- Add MEXC adapter (protobuf)
- Add KuCoin adapter (token flow)
- **Rationale:** Cleanup only after stable rollout
- **Delivers:** Clean codebase, full exchange support
- **Pitfalls to avoid:** Orphaned keys consuming memory

### Research Flags

| Phase | Research Needed | Rationale |
|-------|-----------------|-----------|
| Phase 2 | MINIMAL | Well-documented Redis patterns; existing code provides template |
| Phase 3 | MINIMAL | Internal refactor; patterns already established |
| Phase 6 | YES - `/gsd:research-phase` | Binance rate limits, WebSocket lifecycle, symbol format differences |
| Phase 7 (MEXC) | YES - `/gsd:research-phase` | Protobuf encoding is unique; requires proto definition research |
| Phase 7 (KuCoin) | YES - `/gsd:research-phase` | Token-first connection flow is unique |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official documentation verified; library recommendations based on active maintenance |
| Features | HIGH | Based on existing codebase patterns + PROJECT.md goals |
| Architecture | HIGH | Based on comprehensive codebase analysis; 13+ file audit for hardcoded values |
| Pitfalls | HIGH | Specific codebase references provided; Redis Cluster issues already encountered and solved |

### Gaps to Address

1. **MEXC Protobuf Definitions:** Need to verify proto files from https://github.com/mexcdevelop/websocket-proto compile cleanly with protobufjs
2. **KuCoin Universal SDK:** New SDK (March 2025); limited production usage data
3. **Binance.US State Restrictions:** 11 states blocked or paused; need dynamic geo-check, not hardcoded list
4. **Tier 1 Symbol Refresh Frequency:** Research didn't determine optimal refresh interval (hourly? daily?)
5. **Cross-Exchange Latency:** No research on expected price discrepancy windows between exchanges

---

## Sources

### Official Exchange Documentation
- [Binance WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [Binance Rate Limits](https://developers.binance.com/docs/binance-spot-api-docs/websocket-api/rate-limits)
- [Binance.US API Docs](https://docs.binance.us/)
- [Binance.US WebSocket (GitHub)](https://github.com/binance-us/binance-us-api-docs/blob/master/web-socket-streams.md)
- [MEXC WebSocket Market Streams](https://www.mexc.com/api-docs/spot-v3/websocket-market-streams)
- [MEXC Protobuf Definitions](https://github.com/mexcdevelop/websocket-proto)
- [KuCoin WebSocket Klines](https://www.kucoin.com/docs/websocket/spot-trading/public-channels/klines)
- [KuCoin Rate Limits](https://www.kucoin.com/docs/basic-info/request-rate-limit/websocket)
- [Coinbase WebSocket Channels](https://docs.cdp.coinbase.com/advanced-trade/docs/ws-channels)

### Libraries
- [binance npm (tiagosiebler)](https://www.npmjs.com/package/binance)
- [kucoin-universal-sdk GitHub](https://github.com/Kucoin/kucoin-universal-sdk)
- [@binance/connector npm](https://www.npmjs.com/package/@binance/connector)

### Migration and Architecture
- [Redis MIGRATE Command](https://redis.io/docs/latest/commands/migrate/)
- [Zero-Downtime Database Migration Guide](https://dev.to/ari-ghosh/zero-downtime-database-migration-the-definitive-guide-5672)
- [ioredis Cross-Slot Pipeline Issue #1602](https://github.com/redis/ioredis/issues/1602)

### Geo-Restrictions
- [Binance.US Supported Regions](https://support.binance.us/en/articles/9842798-list-of-supported-and-unsupported-states-and-regions)
- [Binance Restricted Countries](https://www.cryptowinrate.com/binance-restricted-supported-countries)

### Codebase References
- `packages/cache/src/keys.ts` - Current key patterns
- `packages/cache/src/strategies/candle-cache.ts` - Cache strategy implementation
- `packages/database/drizzle/schema.ts` - Current database schema
- `packages/coinbase-client/src/adapter/coinbase-adapter.ts` - Adapter implementation
- `apps/api/src/server.ts` - Startup sequence
- `apps/api/src/services/indicator-calculation.service.ts` - Service patterns
- `.planning/PROJECT.md` - v5.0 goals and requirements

---

*Research synthesis complete. Ready for requirements definition.*
