# Codebase Concerns

**Analysis Date:** 2025-01-18

## Tech Debt

**Hardcoded User/Exchange IDs:**
- Issue: Test user and exchange IDs (both = 1) are hardcoded throughout the codebase
- Files:
  - `apps/api/src/services/indicator-calculation.service.ts:52-54`
  - `apps/api/src/services/coinbase-websocket.service.ts:43-45`
  - `apps/api/src/services/alert-evaluation.service.ts:44-46`
  - `apps/api/src/server.ts:112-113`
- Impact: System cannot support multiple users or exchanges; requires code changes to add multi-tenancy
- Fix approach: Implement proper user context propagation from authentication layer; remove hardcoded constants

**Orderbook Not Implemented:**
- Issue: L2 (orderbook) WebSocket subscription is active but handler is a stub
- Files: `apps/api/src/services/coinbase-websocket.service.ts:219` (TODO comment)
- Impact: Wasted network bandwidth; orderbook data not stored or used
- Fix approach: Either implement `OrderbookCacheStrategy` persistence or remove subscription

**`any` Type Usage in External API Clients:**
- Issue: Multiple uses of `any` type for Coinbase API responses
- Files:
  - `packages/coinbase-client/src/rest/client.ts:162` - candle mapping
  - `packages/coinbase-client/src/rest/client.ts:186,201` - `getProducts()` and `getProduct()` return `any`
  - `packages/coinbase-client/src/rest/client.ts:557` - `request()` method
  - `packages/coinbase-client/src/rest/auth.ts:41,71` - JWT creation
- Impact: No compile-time type safety for API responses; runtime errors may go undetected
- Fix approach: Define TypeScript interfaces for Coinbase API response shapes; validate with Zod

**Volume Not Tracked in 1m Candles:**
- Issue: Volume field always 0 in locally-aggregated candles from ticker events
- Files: `apps/api/src/services/coinbase-websocket.service.ts:113` - comment says "Volume tracked separately via 24h volume deltas"
- Impact: 1m candle volume data unavailable for indicators that need it
- Fix approach: Either calculate volume deltas from 24h volume changes or fetch from REST API

## Known Bugs

**None detected during analysis**

## Security Considerations

**API Keys in Environment:**
- Risk: Coinbase API keys stored as environment variables
- Files: `packages/schemas/src/env/config.schema.ts`
- Current mitigation: Environment validation via Zod schema
- Recommendations: Consider secrets manager integration for production; add key rotation support

**Discord Webhook URL Exposure:**
- Risk: Webhook URL in environment variable could be leaked
- Files: `apps/api/src/services/discord-notification.service.ts:88`
- Current mitigation: URL is not logged
- Recommendations: Add rate limiting on webhook calls; consider Discord bot with OAuth instead

**No Authentication on tRPC Endpoints:**
- Risk: All tRPC endpoints appear publicly accessible
- Files: `apps/api/src/server.ts:193-202`, `packages/trpc-config/src/context.ts`
- Current mitigation: Appears to be a local-only system
- Recommendations: Add authentication middleware if exposed to network

## Performance Bottlenecks

**REST API Calls on Every Candle Close:**
- Problem: On 1m candle close, REST API called even though WebSocket provided OHLC
- Files: `apps/api/src/services/indicator-calculation.service.ts:168-170`
- Cause: Comment explains locally-aggregated ticker data may miss trades; REST ensures accuracy
- Improvement path: Consider hybrid approach: use WebSocket data with periodic REST reconciliation

**Batch API Calls with Fixed Delay:**
- Problem: 1 second delay between batches of 5 API requests during warmup
- Files: `apps/api/src/services/indicator-calculation.service.ts:63-64`
- Cause: Coinbase rate limiting avoidance
- Improvement path: Implement adaptive rate limiting based on response headers; use exponential backoff

**Large Candle Fetches:**
- Problem: Fetches 200 candles from cache for indicator recalculation
- Files: `apps/api/src/services/indicator-calculation.service.ts:424-430`
- Cause: MACD-V requires warmup period (~35 bars)
- Improvement path: Calculate incremental updates instead of full recalculation; store intermediate state

## Fragile Areas

**Alert Cooldown State:**
- Files: `apps/api/src/services/alert-evaluation.service.ts:29-39`
- Why fragile: Cooldown state stored only in memory (`Map` objects); lost on restart
- Safe modification: Ensure state is re-populated on startup or persisted to Redis
- Test coverage: No tests found for alert evaluation service

**WebSocket Reconnection:**
- Files: `packages/coinbase-client/src/websocket/client.ts:241-262`
- Why fragile: Reconnection logic with exponential backoff but max 10 attempts; gives up permanently after
- Safe modification: Consider infinite reconnection with circuit breaker pattern
- Test coverage: No tests for WebSocket client

**Candle Boundary Detection:**
- Files: `apps/api/src/services/indicator-calculation.service.ts:181-216`
- Why fragile: Depends on exact timestamp alignment for detecting higher timeframe closes
- Safe modification: Add tolerance window; log boundary crossing events for debugging
- Test coverage: No tests for boundary detection logic

## Scaling Limits

**Single Redis Connection:**
- Current capacity: Single Redis client for all operations
- Limit: Could become bottleneck with many symbols/timeframes
- Scaling path: Implement connection pooling; separate pub/sub from commands

**In-Memory Price Tracking:**
- Current capacity: `currentPrices` Map in alert service
- Limit: Memory grows with number of symbols
- Scaling path: Store prices in Redis instead; already done for indicators/candles

**All Timeframes Calculated for All Symbols:**
- Current capacity: 6 timeframes * N symbols = 6N indicator calculations
- Limit: With ~40 symbols, 240 indicator configs processed
- Scaling path: Lazy calculation (only compute when needed); prioritize active symbols

## Dependencies at Risk

**No Dependency Concerns Detected:**
- All major dependencies are stable, widely-used packages
- Coinbase API v3 is current and documented

## Missing Critical Features

**No Automated Testing:**
- Problem: Only `packages/indicators/src/__tests__/` has tests; services have zero coverage
- Blocks: Safe refactoring; confidence in deployments
- Files: Test files exist only at `packages/indicators/src/__tests__/*.test.ts`

**No Graceful Degradation:**
- Problem: If Coinbase WebSocket disconnects permanently (>10 retries), system stops receiving data
- Blocks: 24/7 reliability
- Files: `packages/coinbase-client/src/websocket/client.ts:242-244`

**No Position Value Tracking:**
- Problem: Position sync service exists but not wired to main server
- Files: `apps/api/src/services/position-sync.service.ts` - defined but not started in `server.ts`
- Blocks: Knowing current portfolio value in real-time

## Test Coverage Gaps

**Services Untested:**
- What's not tested: All services in `apps/api/src/services/`
- Files:
  - `apps/api/src/services/alert-evaluation.service.ts`
  - `apps/api/src/services/coinbase-websocket.service.ts`
  - `apps/api/src/services/discord-notification.service.ts`
  - `apps/api/src/services/indicator-calculation.service.ts`
  - `apps/api/src/services/position-sync.service.ts`
- Risk: Regressions go unnoticed; refactoring is risky
- Priority: High - these are core business logic

**tRPC Routers Untested:**
- What's not tested: All routers in `apps/api/src/routers/`
- Files:
  - `apps/api/src/routers/alert.router.ts`
  - `apps/api/src/routers/indicator.router.ts`
  - `apps/api/src/routers/position.router.ts`
- Risk: API contract changes could break consumers
- Priority: Medium

**Cache Strategies Untested:**
- What's not tested: Redis cache strategies
- Files:
  - `packages/cache/src/strategies/candle-cache.ts`
  - `packages/cache/src/strategies/indicator-cache.ts`
  - `packages/cache/src/strategies/ticker-cache.ts`
  - `packages/cache/src/strategies/orderbook-cache.ts`
- Risk: Data corruption or loss in cache operations
- Priority: Medium

**WebSocket Client Untested:**
- What's not tested: Connection, reconnection, message handling
- Files: `packages/coinbase-client/src/websocket/client.ts`
- Risk: Production failures in WebSocket handling
- Priority: High - critical data path

---

*Concerns audit: 2025-01-18*
