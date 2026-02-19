# Phase 43: Runtime Modes & Distributed Architecture - Research

**Researched:** 2026-02-19
**Domain:** Application lifecycle / conditional service initialization
**Confidence:** HIGH

## Summary

Phase 43 introduces a `LIVERMORE_MODE` environment variable that controls which subsystems the Livermore API server initializes at startup. The "exchange" mode (default) runs the full data pipeline as it does today. The "pw-host" mode starts a headless instance that only serves the public API from Redis cache -- no exchange adapters, no warmup, no indicator calculation, no alert evaluation.

This is fundamentally an **application startup branching** problem, not a library/framework problem. The codebase already has the infrastructure: `server.ts` already conditionally skips services in idle mode (the `isAutostart` branch), the `publicApiPlugin` is a self-contained Fastify plugin that reads from Redis and the database, and the `/health` endpoint already reads runtime state. The work is a controlled refactoring of the startup sequence to respect a new mode flag, plus updating the health endpoint to report mode-appropriate status.

**Primary recommendation:** Add a `LIVERMORE_MODE` env var check early in `server.ts`, gate all exchange/indicator/alert service creation behind `mode === 'exchange'`, and update the health endpoint. No new packages or libraries are needed.

## Standard Stack

### Core

No new libraries required. This phase uses only what already exists in the codebase:

| Library | Version | Purpose | Already In Use |
|---------|---------|---------|----------------|
| Fastify | existing | HTTP server, plugin architecture | Yes - server.ts |
| ioredis | existing | Redis connectivity for cache reads | Yes - @livermore/cache |
| drizzle-orm | existing | Database queries (API key validation, exchange resolution) | Yes - @livermore/database |
| zod | existing | Env var validation schema | Yes - EnvConfigSchema |

### Supporting

None required.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Env var mode flag | Config file / CLI arg | Env var is simpler, matches existing pattern (validateEnv), no file management |
| Conditional init in server.ts | Separate entrypoint per mode | Separate entrypoints cause code duplication and drift; single entrypoint with branching is cleaner |

## Architecture Patterns

### Current Startup Architecture (server.ts)

The current `start()` function in `apps/api/src/server.ts` follows this sequence:

```
1. validateEnv()                    -- requires ALL env vars (Coinbase, Clerk, Discord, DB, Redis)
2. Create Fastify, register CORS, WebSocket
3. Register Clerk webhook + Clerk plugin
4. Pre-flight: DB connect, Redis connect
5. Register publicApiPlugin at /public/v1
6. Create InstanceRegistryService, NetworkActivityLogger, StateMachineService
7. If autostart: fetch symbols, backfill, register instance
8. Register tRPC router
9. Register /health endpoint
10. Register /ws/alerts, /ws/candle-pulse
11. Create IndicatorService, BoundaryRestService, ExchangeAdapterFactory, AlertService
12. If autostart: start all services (indicators, warmup, adapter, boundary, alerts)
13. Build ServiceRegistry, store globally
14. Start Fastify listener
```

### Recommended Refactoring Pattern: Mode-Gated Initialization

```
1. Read LIVERMORE_MODE from env (default: 'exchange')
2. validateEnv() -- MODIFIED: pw-host mode makes Coinbase keys optional
3. Create Fastify, register CORS, WebSocket
4. IF exchange mode: Register Clerk webhook + Clerk plugin
5. Pre-flight: DB connect, Redis connect (BOTH modes need this)
6. Register publicApiPlugin at /public/v1 (BOTH modes)
7. IF exchange mode: all instance registry, state machine, tRPC, services...
8. Register /health endpoint (BOTH modes, mode-aware response)
9. Start Fastify listener
```

### Pattern 1: Early Mode Resolution

**What:** Read `LIVERMORE_MODE` at the very top of `start()`, before `validateEnv()`, so the env validation schema can be mode-aware.

**When to use:** When different modes require different mandatory env vars.

**Example:**
```typescript
type RuntimeMode = 'exchange' | 'pw-host';

function resolveMode(): RuntimeMode {
  const mode = process.env.LIVERMORE_MODE?.toLowerCase() ?? 'exchange';
  if (mode !== 'exchange' && mode !== 'pw-host') {
    throw new Error(`Invalid LIVERMORE_MODE: ${mode}. Must be 'exchange' or 'pw-host'.`);
  }
  return mode;
}
```

### Pattern 2: Mode-Aware Env Validation

**What:** The current `EnvConfigSchema` requires Coinbase API keys, Clerk keys, and Discord webhook. In pw-host mode, only Redis, DB, and API server config are needed.

**When to use:** When pw-host instances should not require exchange API credentials.

**Example approach:** Create a `PwHostEnvConfigSchema` that omits exchange-specific fields, or make those fields optional and validate conditionally.

### Pattern 3: Health Endpoint Mode Branching

**What:** The `/health` endpoint returns different status fields based on runtime mode.

**Example:**
```typescript
// Exchange mode:
{
  status: 'ok',
  mode: 'exchange',
  services: {
    database: 'connected',
    redis: 'connected',
    exchange: { connectionState: 'active', connected: true },
  }
}

// pw-host mode:
{
  status: 'ok',
  mode: 'pw-host',
  services: {
    database: 'connected',
    redis: 'connected',
  }
}
```

### Anti-Patterns to Avoid

- **Separate server entrypoint for pw-host:** Creates code duplication, plugin registration drift, and two files to maintain. A single `server.ts` with mode branching is strictly better.
- **Wrapping every service call in `if (mode === 'exchange')`:** Instead, simply skip creating exchange-only services entirely. Don't create them and then no-op them.
- **Making public API routes mode-aware:** The public API routes already read from Redis/DB directly. They don't know or care about the data pipeline. Don't add mode checks to route handlers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Env var schema variants | Two separate schema files | Zod `.partial()` / `.omit()` on existing schema | Single source of truth for shared fields |
| Redis health check | Custom ping logic | Existing `testRedisConnection()` from @livermore/cache | Already handles cluster mode correctly |
| DB health check | Custom query | Existing `testDatabaseConnection()` from @livermore/database | Already exists and is tested |

**Key insight:** This phase requires zero new libraries. Every building block already exists. The work is purely about controlling the initialization flow.

## Common Pitfalls

### Pitfall 1: Database Dependency in pw-host Mode

**What goes wrong:** The public API routes (`candles`, `exchanges`, `symbols`, `signals`, `alerts`) ALL use `getDbClient()` for exchange name-to-ID resolution and API key validation. If you think pw-host only needs Redis, you'd be wrong.

**Why it happens:** The data flow is: Redis stores candles/indicators keyed by exchangeId (integer), but the public API accepts exchange names (strings) in URL params. The DB lookup maps name -> ID. Also, API key auth hits the `api_keys` table.

**How to avoid:** pw-host mode MUST connect to the database. Both `DATABASE_*` and `LIVERMORE_REDIS_*` env vars remain required.

**Warning signs:** 404 errors on all endpoints because exchange name resolution fails.

### Pitfall 2: EnvConfigSchema Requires Exchange Credentials

**What goes wrong:** `validateEnv()` currently calls `EnvConfigSchema.parse(process.env)` which requires `Coinbase_ApiKeyId`, `Coinbase_EcPrivateKeyPem`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `DISCORD_LIVERMORE_BOT`. A pw-host instance doesn't need any of these.

**Why it happens:** The schema was written for a single-mode server.

**How to avoid:** Either: (a) create a `PwHostEnvConfigSchema` that omits exchange/Clerk/Discord fields, or (b) make those fields optional in the base schema and validate them only when mode === 'exchange'. Option (b) is simpler but weakens validation for exchange mode. Option (a) is cleaner.

**Warning signs:** Server crashes on startup with "Coinbase API key ID is required" when running in pw-host mode.

### Pitfall 3: Clerk Plugin Initialization Side Effects

**What goes wrong:** `import 'dotenv/config'` is loaded at line 1 of server.ts specifically because "Clerk reads CLERK_SECRET_KEY during ES module initialization." If Clerk plugin is registered in pw-host mode without the key, it may crash.

**Why it happens:** The comment in server.ts explicitly warns about this.

**How to avoid:** In pw-host mode, skip `clerkPlugin` registration entirely. The public API uses API key auth (X-API-Key header), not Clerk JWT.

**Warning signs:** Crash at import time or plugin registration with missing Clerk key errors.

### Pitfall 4: tRPC Router in pw-host Mode

**What goes wrong:** Registering the tRPC router in pw-host mode is unnecessary (no admin will use it) and may fail if Clerk context creation fails.

**Why it happens:** The tRPC `createContext` function calls `baseCreateContext` which requires Clerk auth.

**How to avoid:** Skip tRPC router registration in pw-host mode. The pw-host instance only serves `/public/v1/*` and `/health`.

### Pitfall 5: WebSocket Bridge Needs exchangeId

**What goes wrong:** The public API WebSocket bridge (Phase 42) requires `exchangeId` and `exchangeName` in its options. In pw-host mode, the instance doesn't "own" an exchange.

**Why it happens:** The bridge subscribes to Redis pub/sub channels scoped to a specific exchange.

**How to avoid:** In pw-host mode, the WebSocket bridge may need to subscribe to ALL exchange channels, or accept exchangeId as configuration. This is a design decision: does pw-host serve a specific exchange's data (configured via env var) or all exchanges? Given the requirement "one instance per exchange," pw-host likely serves a specific exchange, so `LIVERMORE_EXCHANGE_ID` or similar env var would be needed.

**Warning signs:** WebSocket /stream endpoint not available, or bridge not relaying events.

## Code Examples

### Current Idle Mode Pattern (Already Exists)

The existing `isAutostart` branching in server.ts (lines 349-538) already demonstrates the pattern needed:

```typescript
// server.ts lines 486-538 (simplified)
if (isAutostart) {
  // Start indicator service, warmup, adapter, boundary, alerts...
  await stateMachine.transition('warming');
  await indicatorService.start(indicatorConfigs);
  // ... full pipeline startup
} else {
  // Idle mode -- services created but not started
  logger.info('Server starting in IDLE mode');
  initRuntimeState({
    isPaused: false,
    mode: 'position-monitor',
    exchangeConnected: false,
    connectionState: 'idle',
    connectionStateChangedAt: Date.now(),
    queueDepth: 0,
  });
}
```

pw-host mode is a step further: services are not even CREATED, only the public API plugin and health endpoint.

### Public API Data Access (Redis-Only for Candle/Signal Data)

```typescript
// candles.route.ts -- reads from Redis sorted set, no exchange adapter dependency
const key = exchangeCandleKey(exchangeId, symbol, timeframe);
const results = await redis.zrange(key, -limit, -1);
const candles: Candle[] = results.map((json) => JSON.parse(json));
```

```typescript
// signals.route.ts -- reads from Redis string key, no indicator service dependency
const key = exchangeIndicatorKey(exchangeId, symbol, tf, 'macd-v');
const raw = await redis.get(key);
```

Both patterns work identically regardless of who wrote the data to Redis.

### Health Endpoint (Current)

```typescript
// Current health endpoint (server.ts lines 400-417)
fastify.get('/health', async () => {
  const runtimeState = getRuntimeState();
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      redis: 'connected',
      discord: discordService.isEnabled() ? 'enabled' : 'disabled',
    },
    exchange: {
      connectionState: runtimeState.connectionState,
      connected: runtimeState.exchangeConnected,
    },
  };
});
```

## Key Findings from Codebase Analysis

### Services to SKIP in pw-host mode

| Service | Why Skip | Notes |
|---------|----------|-------|
| ExchangeAdapterFactory + adapter | No WebSocket data ingestion | Requires Coinbase/Binance API keys |
| IndicatorCalculationService | No calculations needed | Reads indicator results from Redis |
| AlertEvaluationService | No alert evaluation | Alert history served from DB |
| BoundaryRestService | No REST polling | Requires exchange REST client |
| ControlChannelService | No admin commands needed | Requires Clerk auth |
| InstanceRegistryService | pw-host doesn't own an exchange | Different registration needed? |
| StateMachineService | No state transitions | No exchange lifecycle |
| NetworkActivityLogger | No activity to log | No exchange operations |
| SymbolSourceService | No symbol classification | Symbols read from DB by routes |
| StartupBackfillService | No backfill | Data comes from exchange-mode instance |
| clerkPlugin | No admin auth | Public API uses API keys |
| tRPC router | No admin dashboard | Only public routes needed |
| Discord notifications | No operational events | No exchange lifecycle |
| /ws/alerts, /ws/candle-pulse | Internal WebSocket routes | Public /stream is separate |

### Services to KEEP in pw-host mode

| Service | Why Keep | Notes |
|---------|----------|-------|
| publicApiPlugin | The entire point of pw-host | All 5 REST routes + OpenAPI spec + WebSocket bridge |
| Redis connection | Candle/indicator data source | Required by all public API data routes |
| Database connection | Exchange resolution + API key auth | Required by candles, signals, exchanges, symbols, alerts routes |
| /health endpoint | MODE-04 requirement | Updated to report pw-host mode |
| CORS plugin | Required for public API | Already permissive for /public/v1/* |
| WebSocket plugin | Required for /stream endpoint | Phase 42 WebSocket bridge |

### Env Vars: Exchange Mode vs pw-host Mode

| Env Var | Exchange Mode | pw-host Mode | Notes |
|---------|--------------|--------------|-------|
| API_HOST, API_PORT | Required | Required | Server binding |
| DATABASE_* (5 vars) | Required | Required | Exchange resolution, API key auth |
| LIVERMORE_REDIS_* (3 vars) | Required | Required | Candle/indicator cache |
| Coinbase_ApiKeyId | Required | NOT needed | Exchange API credentials |
| Coinbase_EcPrivateKeyPem | Required | NOT needed | Exchange API credentials |
| CLERK_PUBLISHABLE_KEY | Required | NOT needed | Admin dashboard auth |
| CLERK_SECRET_KEY | Required | NOT needed | Admin dashboard auth |
| DISCORD_LIVERMORE_BOT | Required | NOT needed | Operational notifications |
| LIVERMORE_MODE | Optional (default: exchange) | Required: 'pw-host' | New env var |

### switch-mode Stub (Existing Tech Debt)

The `handleSwitchMode` method in `control-channel.service.ts` (lines 790-816) is documented as a stub. It validates mode names (`position-monitor`, `scalper-macdv`, `scalper-orderbook`) and updates `RuntimeState.mode` but doesn't change any service behavior. This is a different "mode" concept from `LIVERMORE_MODE` -- `switch-mode` is about trading strategies within exchange mode, while `LIVERMORE_MODE` is about which services to initialize. These two mode concepts are orthogonal and should not be confused.

### WebSocket Bridge in pw-host Mode

The WebSocket bridge (Phase 42) in `plugin.ts` lines 213-268 is conditionally created only when `opts.redis && opts.exchangeId && opts.exchangeName` are provided. In pw-host mode, the bridge would need to know which exchange to subscribe to. Options:

1. **Require `LIVERMORE_EXCHANGE_ID` env var in pw-host mode** -- simple, maps to "one instance per exchange" principle
2. **Multi-exchange bridge** -- subscribe to all exchanges, but this contradicts the single-exchange principle
3. **No WebSocket bridge in pw-host** -- REST-only, simplest but loses streaming capability

Recommendation: Option 1 (env var for exchange identity in pw-host mode) is most consistent with the existing architecture.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single startup path | isAutostart branching | Phase 26 (v4.0) | Two startup modes: autostart vs idle |
| User-scoped Redis keys | Exchange-scoped Redis keys | Phase 34 (v7.0) | Public API can read data without user context |
| Direct adapter creation | ExchangeAdapterFactory | Phase 29 (v5.0) | Adapter creation abstracted behind factory |

## Open Questions

1. **Does pw-host need its own instance registry entry?**
   - What we know: Exchange-mode instances register at `exchange:{id}:status`. The exchanges route reads this for online/offline status.
   - What's unclear: Should pw-host instances register themselves? If not, the exchanges route will always report "offline" when only pw-host is running (because it checks instance registry). But that may be correct -- if no exchange-mode instance is running, the data IS stale.
   - Recommendation: Do NOT register pw-host in instance registry. The registry reflects the data pipeline health, not API serving health. pw-host health is reported by its own `/health` endpoint.

2. **Should pw-host accept exchange identity via env var for WebSocket bridge?**
   - What we know: The WebSocket bridge needs exchangeId to subscribe to Redis pub/sub channels.
   - What's unclear: Whether pw-host should support WebSocket streaming at all, or just REST.
   - Recommendation: Add `LIVERMORE_EXCHANGE_ID` and `LIVERMORE_EXCHANGE_NAME` env vars for pw-host mode. If not set, WebSocket bridge is simply not created (REST-only mode).

3. **dotenv/config import at top of server.ts**
   - What we know: Line 1 imports `dotenv/config` specifically for Clerk. In pw-host mode, Clerk is not used.
   - What's unclear: Whether removing/conditionalizing this import affects anything else.
   - Recommendation: The import is harmless in pw-host mode (it just reads a .env file that may not exist). Leave it. The critical thing is not registering `clerkPlugin`.

## Sources

### Primary (HIGH confidence)

- Direct codebase analysis: `apps/api/src/server.ts` (661 lines) -- full startup sequence
- Direct codebase analysis: `packages/public-api/src/plugin.ts` (279 lines) -- public API plugin architecture
- Direct codebase analysis: `packages/public-api/src/routes/*.ts` -- all 5 route handlers
- Direct codebase analysis: `packages/public-api/src/middleware/auth.ts` -- API key validation (DB-backed)
- Direct codebase analysis: `packages/schemas/src/env/config.schema.ts` -- current env var requirements
- Direct codebase analysis: `apps/api/src/services/runtime-state.ts` -- runtime state module
- Direct codebase analysis: `apps/api/src/services/control-channel.service.ts` -- switch-mode stub context
- Direct codebase analysis: `apps/api/src/services/state-machine.service.ts` -- connection state machine
- Direct codebase analysis: `apps/api/src/services/types/service-registry.ts` -- service registry interface
- Direct codebase analysis: `.planning/REQUIREMENTS.md` -- MODE-01 through MODE-04 requirements

### Secondary (MEDIUM confidence)

- None needed -- this is a codebase-internal refactoring phase, not a library integration.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed, purely internal refactoring
- Architecture: HIGH - Clear branching pattern, existing idle-mode precedent in server.ts
- Pitfalls: HIGH - Identified from direct code analysis of startup dependencies

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable -- internal architecture, no external dependencies)
