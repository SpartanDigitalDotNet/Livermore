# Phase 42: WebSocket Bridge with Backpressure - Research

**Researched:** 2026-02-19
**Domain:** WebSocket real-time streaming, Redis pub/sub bridge, backpressure management, AsyncAPI documentation
**Confidence:** HIGH

## Summary

This phase builds a WebSocket bridge that relays internal Redis pub/sub events (candle closes and trade signals) to external API clients. The codebase already has all the foundational pieces: `@fastify/websocket` v11.2.0 is installed and used for internal WebSocket routes (`/ws/alerts`, `/ws/candle-pulse`), Redis pub/sub channels for candle close events (`channel:exchange:{id}:candle:close:{symbol}:{timeframe}`) and alert events (`channel:alerts:exchange:{id}`) are actively publishing, and the IP-protective transformer layer from Phase 39 defines exactly which fields to expose.

The primary challenge is building the subscription management layer that maps external client channel requests (e.g., `candles:BTC-USD:1h`) to internal Redis pub/sub patterns, while enforcing per-API-key connection limits, heartbeat-based liveness detection, and backpressure handling for slow clients. The `ws` library (underlying `@fastify/websocket`) provides `bufferedAmount`, `pause()`, `resume()`, and `terminate()` methods that make server-side backpressure implementation straightforward.

**Primary recommendation:** Build a `WebSocketBridge` class within `@livermore/public-api` that manages a single Redis subscriber connection shared across all WebSocket clients, with per-client subscription tracking, the existing `transformCandle`/`transformIndicatorToSignal` transformers for IP protection, and `bufferedAmount`-based backpressure detection on every relay.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @fastify/websocket | 11.2.0 | WebSocket plugin for Fastify 5 | Already installed, wraps `ws` library, integrates with Fastify hooks |
| ws | 8.x | Underlying WebSocket implementation | Industry standard Node.js WebSocket library, provides `bufferedAmount` for backpressure |
| ioredis | 5.4.2 | Redis pub/sub subscriber | Already used throughout codebase, supports `psubscribe` with patterns |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 3.24.1 | Schema validation for WS messages | Validate incoming subscribe/unsubscribe messages |
| @livermore/cache | workspace | Redis key/channel builders | `exchangeCandleCloseChannel()`, `exchangeAlertChannel()` functions |
| @livermore/public-api | workspace | Transformers and schemas | `transformCandle()`, `transformIndicatorToSignal()`, `deriveDirection()`, `deriveStrength()` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ws (via @fastify/websocket) | Socket.IO | Overkill - adds protocol overhead, fallback transports not needed for API clients |
| Single shared Redis subscriber | Per-client Redis subscribers | Would exhaust Redis connections; shared subscriber with in-memory fan-out is standard |
| AsyncAPI YAML file | Programmatic spec generation | YAML is simpler, version-controlled, no runtime dependency; matches OpenAPI approach |

**Installation:**
No new dependencies needed. All libraries are already in the workspace.

## Architecture Patterns

### Recommended Project Structure
```
packages/public-api/src/
  ws/
    bridge.ts           # WebSocketBridge class - manages Redis sub + client fan-out
    connection.ts        # ClientConnection class - per-client state, subscriptions, backpressure
    handlers.ts          # Message handlers (subscribe, unsubscribe, ping)
    types.ts             # WS message types, envelope types
    auth.ts              # WebSocket auth (query param API key validation)
  transformers/
    candle.transformer.ts    # EXISTING - reuse for WS candle events
    signal.transformer.ts    # EXISTING - reuse for WS signal events
    alert.transformer.ts     # EXISTING - reuse for WS alert events
  schemas/
    ws-message.schema.ts     # Zod schemas for WS protocol messages
docs/
  asyncapi.yaml              # AsyncAPI 3.1 spec (static file)
```

### Pattern 1: Shared Redis Subscriber with In-Memory Fan-Out
**What:** One Redis subscriber connection handles all pub/sub channels. When a message arrives, the bridge iterates over connected clients and relays only to those subscribed to the matching channel.
**When to use:** Always -- creating per-client Redis subscribers would exhaust connections.
**Example:**
```typescript
// Source: Existing pattern in indicator-calculation.service.ts lines 254-268
class WebSocketBridge {
  private subscriber: RedisClient;
  private clients: Map<string, ClientConnection> = new Map(); // keyed by connection ID

  async start(): Promise<void> {
    this.subscriber = redis.duplicate();

    // Subscribe to all candle close events for all exchanges
    await this.subscriber.psubscribe('channel:exchange:*:candle:close:*:*');
    // Subscribe to all alert events for all exchanges
    await this.subscriber.psubscribe('channel:alerts:exchange:*');

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      this.relayToClients(channel, message);
    });
  }

  private relayToClients(channel: string, rawMessage: string): void {
    // Parse channel to determine type and extract symbol/timeframe
    // Transform internal data through IP-protective transformers
    // Fan out to subscribed clients with backpressure check
  }
}
```

### Pattern 2: Channel Mapping (External to Internal)
**What:** External clients subscribe to simplified channel names that map to internal Redis pub/sub patterns.
**When to use:** All subscription requests -- never expose internal channel naming.
**Example:**
```typescript
// External: "candles:BTC-USD:1h"
// Internal: "channel:exchange:{exchangeId}:candle:close:BTC-USD:1h"

// External: "signals:BTC-USD:15m"
// Internal: "channel:alerts:exchange:{exchangeId}" (filtered by symbol/timeframe in relay)

function mapExternalChannel(external: string): { type: 'candle' | 'signal'; symbol: string; timeframe: string } {
  const [type, symbol, timeframe] = external.split(':');
  if (type === 'candles') return { type: 'candle', symbol, timeframe };
  if (type === 'signals') return { type: 'signal', symbol, timeframe };
  throw new Error(`Unknown channel type: ${type}`);
}
```

### Pattern 3: Backpressure Detection via bufferedAmount
**What:** Before sending each message, check `socket.bufferedAmount`. If above threshold, skip the message. If persistently above, terminate the client.
**When to use:** Every relay operation.
**Example:**
```typescript
// Source: ws library docs - bufferedAmount, pause(), terminate()
const BUFFER_WARNING_THRESHOLD = 64 * 1024;  // 64KB - start skipping
const BUFFER_DISCONNECT_THRESHOLD = 256 * 1024; // 256KB - terminate

function relaySafe(socket: WebSocket, data: string): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;

  if (socket.bufferedAmount > BUFFER_DISCONNECT_THRESHOLD) {
    socket.terminate(); // Force close slow client
    return false;
  }

  if (socket.bufferedAmount > BUFFER_WARNING_THRESHOLD) {
    // Skip this message - client is too slow
    return false;
  }

  socket.send(data);
  return true;
}
```

### Pattern 4: WebSocket Route with Query Parameter Auth
**What:** WebSocket connections authenticate via `?apiKey=xxx` query parameter since WS clients cannot set custom headers during handshake.
**When to use:** The `/public/v1/stream` endpoint.
**Example:**
```typescript
// Register WebSocket route in Fastify
fastify.get('/stream', { websocket: true }, async (socket, request) => {
  // Extract API key from query string
  const apiKey = (request.query as any).apiKey;
  if (!apiKey) {
    socket.close(4001, 'API key required');
    return;
  }

  const keyId = await validateApiKey(apiKey);
  if (keyId === null) {
    socket.close(4001, 'Invalid API key');
    return;
  }

  // Check per-key connection limit
  const currentConnections = bridge.getConnectionCount(keyId);
  if (currentConnections >= 5) {
    socket.close(4008, 'Connection limit exceeded');
    return;
  }

  // Register connection - MUST attach message handlers synchronously
  bridge.addClient(socket, keyId);

  socket.on('message', (data) => {
    bridge.handleClientMessage(socket, data);
  });

  socket.on('close', () => {
    bridge.removeClient(socket);
  });
});
```

### Anti-Patterns to Avoid
- **Exposing internal Redis channel names:** External clients must never see `channel:exchange:1:candle:close:BTC-USD:1h`. Map to `candles:BTC-USD:1h`.
- **Creating Redis subscriber per WebSocket client:** Would exhaust Redis connections. Use shared subscriber with in-memory fan-out.
- **Passing raw internal candle data:** ALWAYS use `transformCandle()` to whitelist fields. The internal `Candle` type has `isSynthetic`, `sequenceNum`, and other proprietary fields.
- **Passing raw alert data:** Alert payloads from Redis contain `alertType: 'macdv'`, `triggerValue`, `signalDelta`. ALWAYS transform through signal transformer.
- **Relying on Fastify onRequest hooks for WS auth:** The existing `buildAuthHook()` reads `X-API-Key` header, but WebSocket clients use query params. Need separate auth path for WS.
- **Async work before attaching message handlers:** Per `@fastify/websocket` docs, event handlers MUST be attached synchronously in the WebSocket handler to avoid dropping messages.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket server | Raw `ws.Server` | `@fastify/websocket` plugin | Already registered in server.ts, handles upgrade, integrates with hooks |
| Heartbeat detection | Custom timers per socket | `ws` built-in `ping()`/`pong()` with `socket.on('pong')` | `ws` tracks pong responses natively |
| API key validation | New auth logic | Existing `validateApiKey()` from `middleware/auth.ts` | Same function, different transport (query param vs header) |
| Candle field whitelisting | New transformer | Existing `transformCandle()` | Already battle-tested, explicit whitelist approach |
| Signal field mapping | New transformer | Existing `transformIndicatorToSignal()` + `deriveDirection()`/`deriveStrength()` | IP protection is critical |
| Redis pub/sub channels | Custom key builders | Existing `exchangeCandleCloseChannel()`, `exchangeAlertChannel()` from `@livermore/cache` | Consistent naming |
| JSON schema for AsyncAPI | Runtime generation | Static YAML file in `docs/` | Simpler, version-controlled, no dependencies |

**Key insight:** Almost all the building blocks exist. The new code is primarily the bridge orchestration layer (subscription management, fan-out, backpressure) and the WebSocket route registration.

## Common Pitfalls

### Pitfall 1: Azure Redis Cluster and psubscribe
**What goes wrong:** In Redis Cluster mode, pub/sub works but has caveats. psubscribe receives messages from all nodes, but the subscriber client cannot be used for regular commands.
**Why it happens:** Redis pub/sub in cluster mode broadcasts across all nodes, but ioredis requires a dedicated connection for subscriber mode.
**How to avoid:** Always use `redis.duplicate()` to create a dedicated subscriber connection, exactly as done in `indicator-calculation.service.ts` (line 255) and `server.ts` (line 280). Never reuse the main Redis client for subscriptions.
**Warning signs:** `MOVED` errors, missing messages, or connection drops.

### Pitfall 2: IP Leakage Through WebSocket Messages
**What goes wrong:** Internal candle data contains `isSynthetic`, `sequenceNum`, and other proprietary fields. Alert payloads contain `alertType: 'macdv'`, raw `triggerValue`, `signalDelta`.
**Why it happens:** Developer shortcuts -- spreading internal objects or passing raw Redis messages to clients.
**How to avoid:** ALWAYS run data through `transformCandle()` for candles and build a dedicated WS signal envelope that uses `deriveDirection()` and `deriveStrength()` for alerts. Never `JSON.parse()` a Redis message and forward it directly.
**Warning signs:** Any `...spread` operator on internal types, any `JSON.stringify(rawMessage)` without transformation.

### Pitfall 3: Message Handler Attachment Timing
**What goes wrong:** Messages arrive during async auth validation and are silently dropped.
**Why it happens:** `@fastify/websocket` requires event handlers to be attached synchronously during handler execution. If you `await validateApiKey()` before attaching `socket.on('message')`, messages received during that await are lost.
**How to avoid:** Attach `socket.on('message')` synchronously first, queue messages, then process after async auth completes. Or perform auth validation in a `preValidation` hook that runs before the WebSocket handler.
**Warning signs:** Clients report first subscribe message being ignored intermittently.

### Pitfall 4: Memory Leak from Uncleared Client State
**What goes wrong:** Server OOM after days of operation due to accumulated client state.
**Why it happens:** Client disconnects without clean close event (network drop), or close handler fails to clean up all state (subscription maps, connection count tracking).
**How to avoid:** Use `socket.on('close')` AND `socket.on('error')` for cleanup. Implement the heartbeat ping/pong to detect dead connections. Use a `Set` or `Map` keyed by connection ID with clear lifecycle.
**Warning signs:** Growing memory over time, connection count never decreasing.

### Pitfall 5: bufferedAmount Not Updating Correctly in ws
**What goes wrong:** `bufferedAmount` may not reflect accurate values in all ws versions.
**Why it happens:** Known issue in ws library (GitHub issue #492) where `bufferedAmount` doesn't reset properly after data transmission in some scenarios.
**How to avoid:** Use `bufferedAmount` as a heuristic threshold check, not as an exact byte counter. Combine with the `send()` callback to confirm delivery. Set generous thresholds (64KB warning, 256KB disconnect) rather than relying on precise values.
**Warning signs:** Clients being disconnected prematurely or not disconnected when they should be.

### Pitfall 6: Alert Channel is Exchange-Scoped, Not Symbol-Scoped
**What goes wrong:** Subscribing to `signals:BTC-USD:15m` cannot be mapped 1:1 to a Redis channel because alerts publish to `channel:alerts:exchange:{id}` (exchange-level, not symbol/timeframe-level).
**Why it happens:** The alert system publishes all alerts for an exchange to a single channel. The published payload contains `symbol` and `timeframe` fields that must be filtered in the bridge.
**How to avoid:** Subscribe to the exchange-level alert channel once, then filter each incoming message against each client's subscribed signal channels. This is an in-memory operation and fast.
**Warning signs:** Clients receiving signals for symbols they didn't subscribe to.

## Code Examples

### Existing Redis Pub/Sub Channel Names (Verified from Source)
```typescript
// Source: packages/cache/src/keys.ts lines 107-115
// Candle close events - exchange scoped
exchangeCandleCloseChannel(1, 'BTC-USD', '5m')
// => 'channel:exchange:1:candle:close:BTC-USD:5m'

// Alert events - exchange scoped
exchangeAlertChannel(1)
// => 'channel:alerts:exchange:1'

// Pattern subscription for all candle closes
`channel:exchange:${exchangeId}:candle:close:*:*`
```

### Existing Candle Close Payload (Verified from Source)
```typescript
// Source: packages/exchange-core/src/adapter/coinbase-adapter.ts line 530
// Published as JSON.stringify(candle) where candle is UnifiedCandle:
{
  timestamp: 1708264800000,
  open: 42350.5,
  high: 42450.75,
  low: 42300.25,
  close: 42400.0,
  volume: 123.456,
  symbol: "BTC-USD",
  timeframe: "1h",
  exchange: "coinbase",
  // PROPRIETARY - must NOT be forwarded:
  isSynthetic: false,
  sequenceNum: 42
}
```

### Existing Alert Payload (Verified from Source)
```typescript
// Source: apps/api/src/services/alert-evaluation.service.ts lines 494-506
// Published as JSON.stringify(alertPayload):
{
  id: 123,
  symbol: "BTC-USD",
  alertType: "macdv",           // PROPRIETARY - must NOT be forwarded
  timeframe: "15m",
  price: 42350.5,
  triggerValue: 85.3,           // PROPRIETARY - must NOT be forwarded
  signalDelta: 12.4,            // PROPRIETARY - must NOT be forwarded
  triggeredAt: "2026-02-19T12:00:00.000Z",
  sourceExchangeId: 1,          // INTERNAL - must NOT be forwarded
  sourceExchangeName: "coinbase",
  triggerLabel: "level_3"       // INTERNAL - must NOT be forwarded
}
```

### Transformed Public Candle (WebSocket Envelope)
```typescript
// Apply transformCandle() from packages/public-api/src/transformers/candle.transformer.ts
{
  type: "candle_close",
  channel: "candles:BTC-USD:1h",
  data: {
    timestamp: "2026-02-19T12:00:00.000Z",
    open: "42350.5",
    high: "42450.75",
    low: "42300.25",
    close: "42400",
    volume: "123.456"
  }
}
```

### Transformed Public Signal (WebSocket Envelope)
```typescript
// Apply deriveDirection() and deriveStrength() from signal/alert transformers
{
  type: "trade_signal",
  channel: "signals:BTC-USD:15m",
  data: {
    symbol: "BTC-USD",
    exchange: "coinbase",
    timeframe: "15m",
    signal_type: "momentum_signal",
    direction: "bullish",       // Derived from triggerLabel
    strength: "strong",         // Derived from abs(triggerValue)
    price: "42350.5",
    timestamp: "2026-02-19T12:00:00.000Z"
  }
}
```

### Heartbeat Ping/Pong Pattern
```typescript
// Source: ws library API docs
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds per WS-05

class ClientConnection {
  private alive = true;
  private heartbeatTimer: NodeJS.Timeout;

  startHeartbeat(socket: WebSocket): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.alive) {
        socket.terminate(); // Dead connection - WS-05
        return;
      }
      this.alive = false;
      socket.ping(); // ws library handles low-level ping frame
    }, HEARTBEAT_INTERVAL);

    socket.on('pong', () => {
      this.alive = true; // Client responded
    });
  }

  stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
  }
}
```

### WebSocket Protocol Messages (Client -> Server)
```typescript
// Subscribe
{ "action": "subscribe", "channels": ["candles:BTC-USD:1h", "signals:ETH-USD:15m"] }

// Unsubscribe
{ "action": "unsubscribe", "channels": ["candles:BTC-USD:1h"] }
```

### WebSocket Protocol Messages (Server -> Client)
```typescript
// Subscription confirmation
{ "type": "subscribed", "channels": ["candles:BTC-USD:1h", "signals:ETH-USD:15m"] }

// Error
{ "type": "error", "code": "INVALID_CHANNEL", "message": "Unknown channel: foo:bar" }

// Candle close event
{ "type": "candle_close", "channel": "candles:BTC-USD:1h", "data": { ... } }

// Trade signal event
{ "type": "trade_signal", "channel": "signals:BTC-USD:15m", "data": { ... } }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-user Redis channels (`candles:{userId}:...`) | Exchange-scoped channels (`channel:exchange:{id}:...`) | Phase 24 (v5.0) | Public API subscribes to exchange-scoped channels only |
| Direct `ws.Server` setup | `@fastify/websocket` plugin integration | Already adopted | WS routes are Fastify routes with hooks, validation |
| No backpressure handling | `bufferedAmount` + `terminate()` | New in Phase 42 | Prevents slow clients from causing server OOM |
| Internal WS broadcasts (server.ts) | Separate bridge in public-api package | New in Phase 42 | IP isolation, clean separation of concerns |

**Deprecated/outdated:**
- `candleCloseChannel()` (user-scoped): Deprecated in favor of `exchangeCandleCloseChannel()`. Public API must use exchange-scoped channels only.
- `candleChannel()` (user-scoped): Deprecated. Not relevant for public API.

## Open Questions

1. **Exchange ID Resolution for External Clients**
   - What we know: Internal channels use numeric `exchangeId` (e.g., `1` for Coinbase). External clients will likely subscribe by exchange name (`coinbase`).
   - What's unclear: Should channel names include exchange? e.g., `candles:coinbase:BTC-USD:1h` vs `candles:BTC-USD:1h` (single-exchange assumption).
   - Recommendation: For v1, assume single exchange (the one currently active). Channel format: `candles:{symbol}:{timeframe}`. This matches the requirement examples. Multi-exchange can be added later.

2. **Redis Subscriber Lifecycle in Public API Package**
   - What we know: The public-api plugin receives `redis` via opts. Creating a subscriber requires `redis.duplicate()`.
   - What's unclear: Should the bridge create its own subscriber, or should server.ts pass in the existing `subscriberRedis`?
   - Recommendation: The bridge should create its own dedicated subscriber via `redis.duplicate()`. This keeps the public-api package self-contained and avoids coupling to server.ts internals. The existing `subscriberRedis` in server.ts is used by the indicator service.

3. **AsyncAPI 3.1 vs 3.0**
   - What we know: The requirement specifies AsyncAPI 3.1. The spec is available at asyncapi.com.
   - What's unclear: Tooling support for 3.1 (validators, generators) may lag behind 3.0.
   - Recommendation: Write the spec in 3.1 format. If tooling issues arise, it's trivially downgradable to 3.0 since the structural differences are minor.

## Sources

### Primary (HIGH confidence)
- `packages/cache/src/keys.ts` - All Redis channel name builders verified
- `packages/exchange-core/src/adapter/coinbase-adapter.ts` lines 510-543 - Candle close publish payload verified
- `apps/api/src/services/alert-evaluation.service.ts` lines 494-511, 606-623 - Alert publish payload verified
- `packages/public-api/src/transformers/candle.transformer.ts` - Candle whitelist transformer verified
- `packages/public-api/src/transformers/signal.transformer.ts` - Signal transformer with deriveDirection/deriveStrength verified
- `packages/public-api/src/transformers/alert.transformer.ts` - Alert transformer verified
- `packages/public-api/src/middleware/auth.ts` - validateApiKey() function verified
- `apps/api/src/server.ts` lines 254, 414-443 - Existing WS routes and @fastify/websocket usage verified
- `apps/api/src/services/indicator-calculation.service.ts` lines 254-268 - Redis psubscribe pattern verified
- `apps/api/package.json` - @fastify/websocket 11.0.1 (installed 11.2.0) verified

### Secondary (MEDIUM confidence)
- [fastify/fastify-websocket README](https://github.com/fastify/fastify-websocket/blob/main/README.md) - Handler signature, sync requirement
- [ws library API docs](https://github.com/websockets/ws/blob/master/doc/ws.md) - bufferedAmount, ping(), pong(), pause(), terminate()
- [AsyncAPI 3.1.0 Specification](https://www.asyncapi.com/docs/reference/specification/v3.1.0) - Document structure
- [AsyncAPI WebSocket tutorial](https://www.asyncapi.com/docs/tutorials/websocket) - Channel/operation patterns
- [AsyncAPI Gemini WebSocket example](https://github.com/asyncapi/spec/blob/master/examples/websocket-gemini-asyncapi.yml) - Real-world structure reference

### Tertiary (LOW confidence)
- [ws bufferedAmount issue #492](https://github.com/websockets/ws/issues/492) - bufferedAmount accuracy concerns (may be resolved in current version)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and used in codebase
- Architecture: HIGH - Patterns directly derived from existing codebase (indicator service, existing WS routes, transformers)
- Pitfalls: HIGH - Verified from codebase patterns and library documentation
- AsyncAPI spec: MEDIUM - Spec structure is well-documented, but first time implementing in this codebase

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable domain, no fast-moving dependencies)
