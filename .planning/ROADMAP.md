# Roadmap: v5.0 Distributed Exchange Architecture

## Overview

Transform Livermore from user-scoped single-exchange to exchange-scoped distributed architecture. Core outcome: cross-exchange visibility enabling "trigger remotely, buy locally" soft-arbitrage patterns. Mike's Coinbase signals visible to Kaia's Binance instance via Redis pub/sub.

**Phases:** 6
**Requirements:** 19 (mapped 100%)
**Starting phase:** 23

---

## Phase 23: Schema Foundation

**Goal:** Establish database foundation for multi-exchange architecture with normalized metadata.

**Dependencies:** None (foundation phase)

**Requirements:**
- EXC-01: `exchanges` metadata table with API limits, fees, geo restrictions, supported timeframes
- EXC-02: `user_exchanges` FK refactor to reference `exchanges` table

**Success Criteria:**
1. `exchanges` table exists with Coinbase and Binance seed data (name, display_name, ws_url, supported_timeframes)
2. `user_exchanges.exchange_id` FK references `exchanges.id` (nullable during migration)
3. Schema migration runs via Atlas without errors
4. `drizzle-kit pull` regenerates TypeScript schema with new tables/columns

---

## Phase 24: Data Architecture

**Goal:** Redis key patterns support exchange-scoped shared data and user-scoped overflow with backward compatibility.

**Dependencies:** Phase 23 (exchanges table provides exchange_id concept)

**Requirements:**
- DATA-01: Exchange-scoped candle keys `candles:{exchange_id}:{symbol}:{timeframe}`
- DATA-02: Exchange-scoped indicator keys `indicator:{exchange_id}:{symbol}:{timeframe}:{type}`
- DATA-03: User overflow keys `usercandles:{userId}:{exchange_id}:{symbol}:{timeframe}` with TTL
- DATA-04: Dual-read pattern (indicator service checks exchange-scoped first, falls back to user-scoped)
- DATA-05: Cross-exchange pub/sub channels `channel:exchange:{exchange_id}:candle:close:{symbol}:{timeframe}`

**Success Criteria:**
1. New key functions exist in `packages/cache/src/keys.ts` for shared and user-scoped patterns
2. Cache strategies accept tier parameter (1 = shared, 2 = user overflow)
3. Indicator service reads from exchange-scoped keys first, falls back to legacy user-scoped keys
4. Candle close events publish to exchange-scoped channels (without userId)
5. Legacy key functions remain (deprecated) for backward compatibility during migration

---

## Phase 25: Symbol Management

**Goal:** Two-tier symbol sourcing with automatic de-duplication between shared pool and user positions.

**Dependencies:** Phase 24 (uses new key patterns for tier-aware storage)

**Requirements:**
- SYM-01: Tier 1 symbol list - Top N by 24h volume (exchange-driven, shared pool)
- SYM-02: Tier 2 user positions - Auto-subscribe held positions (de-duped against Tier 1)
- SYM-04: Symbol de-duplication logic (Tier 2 entries matching Tier 1 use shared pool)

**Success Criteria:**
1. `exchange_symbols` table tracks Tier 1 symbols per exchange with volume ranking
2. Startup fetches user positions and classifies as Tier 1 (use shared) or Tier 2 (user overflow)
3. Symbols in both Tier 1 and user positions write to shared keys only (no duplicate data)
4. `SymbolSourceService` provides merged symbol list with tier annotations
5. Admin symbols UI shows tier classification for each symbol

---

## Phase 26: Startup Control

**Goal:** API starts idle and awaits explicit start command, with CLI override for automation.

**Dependencies:** Phase 25 (symbol sourcing integrated into startup sequence)

**Requirements:**
- CTL-01: Idle startup mode - API starts without WebSocket connections, awaits `start` command
- CTL-02: `start` command to initiate exchange connections (replaces auto-connect)
- CTL-03: `--autostart <exchange>` CLI flag to bypass idle mode for specific exchange
- CTL-04: Connection lifecycle events (`exchange:connecting`, `exchange:connected`, `exchange:disconnected`)

**Success Criteria:**
1. API starts Fastify server and tRPC routes without connecting to any exchange
2. ControlChannelService responds to `start` command by initiating exchange connection sequence
3. `npm run dev -- --autostart coinbase` bypasses idle mode and connects immediately
4. WebSocket connection state changes emit events observable via control channel responses
5. Admin control panel shows current connection state (idle, connecting, connected, disconnected)

---

## Phase 27: Cross-Exchange Visibility

**Goal:** Any subscriber can receive signals from any exchange, enabling soft-arbitrage patterns.

**Dependencies:** Phase 24 (uses exchange-scoped channels), Phase 26 (connection lifecycle established)

**Requirements:**
- VIS-01: Exchange-scoped alert channels `channel:alerts:{exchange_id}` (not user-scoped)
- VIS-02: Cross-exchange subscription - Client can subscribe to any exchange's feed
- VIS-03: Alert source attribution - Alert payloads include `source_exchange_id` field

**Success Criteria:**
1. AlertEvaluationService publishes to `channel:alerts:{exchange_id}` instead of user-scoped channels
2. PerseusWeb (or any Redis subscriber) can subscribe to `channel:alerts:1` to receive Coinbase alerts
3. Alert payloads include `source_exchange_id` and `source_exchange_name` fields
4. Admin UI alerts panel shows which exchange generated each signal
5. Cross-exchange subscription documented in PerseusWeb integration guide

---

## Phase 28: Adapter Refactor

**Goal:** Exchange adapters instantiated via factory with connection status tracking.

**Dependencies:** Phase 23 (exchanges table), Phase 24 (new key patterns), Phase 26 (lifecycle events)

**Requirements:**
- EXC-03: Exchange adapter factory that instantiates correct adapter (Coinbase/Binance) based on exchange type
- EXC-04: Exchange connection status tracking (`connected_at`, `last_heartbeat`, `connection_state`)

**Success Criteria:**
1. `ExchangeAdapterFactory.create(exchangeId)` returns correctly typed adapter (CoinbaseAdapter or BinanceAdapter)
2. Adapter selection based on `exchanges.name` lookup (not hardcoded switch)
3. Connection status stored in Redis with `last_heartbeat` timestamp updated on WebSocket ping
4. `getStatus` control command returns actual connection state from tracking (not mock data)
5. Services receive adapter from factory, no longer hardcode `TEST_EXCHANGE_ID`

---

## Progress

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 23 | Schema Foundation | 2 | Pending |
| 24 | Data Architecture | 5 | Pending |
| 25 | Symbol Management | 3 | Pending |
| 26 | Startup Control | 4 | Pending |
| 27 | Cross-Exchange Visibility | 3 | Pending |
| 28 | Adapter Refactor | 2 | Pending |

**Total:** 6 phases, 19 requirements

---

## Coverage

| Category | Requirements | Phase |
|----------|--------------|-------|
| Exchange Management | EXC-01, EXC-02 | 23 |
| Exchange Management | EXC-03, EXC-04 | 28 |
| Data Architecture | DATA-01, DATA-02, DATA-03, DATA-04, DATA-05 | 24 |
| Symbol Management | SYM-01, SYM-02, SYM-04 | 25 |
| Startup/Control | CTL-01, CTL-02, CTL-03, CTL-04 | 26 |
| Cross-Exchange Visibility | VIS-01, VIS-02, VIS-03 | 27 |

All 19 v5.0 requirements mapped. No orphans.

---

*Created: 2026-02-06*
*Milestone: v5.0 Distributed Exchange Architecture*
