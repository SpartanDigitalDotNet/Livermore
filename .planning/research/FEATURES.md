# Feature Landscape: v6.0 Perseus Network

**Domain:** Distributed instance coordination, service registry, health monitoring
**Project:** Livermore Trading Platform
**Researched:** 2026-02-10
**Overall Confidence:** HIGH

---

## Executive Summary

v6.0 transforms Livermore from a "who's connected" status flag into a proper distributed service registry with identity, health monitoring, and audit logging. The current prototype stores an `exchange:status:{exchangeId}` key in Redis with basic connection state, but it has no TTL (dead instances leave stale keys), no identity information (who is running it, where), and no history (state transitions are lost).

The Perseus Network milestone builds three interconnected subsystems:

1. **Instance Registration** -- Each API instance registers itself in Redis with full identity (hostname, IP, admin user, exchange, symbol count) and maintains that registration via heartbeat with TTL. Key expiry equals instance death.

2. **Network Activity Log** -- State transitions and errors are logged to Redis Streams with 90-day time-based retention using MINID trimming. This creates a persistent audit trail that survives instance restarts.

3. **Admin UI Network View** -- A new page showing all registered instances, their real-time status, and a scrollable activity feed sourced from the Redis Streams.

The one-instance-per-exchange constraint is enforced at registration time: before an instance starts serving an exchange, it checks whether another instance already holds the registration. This prevents data conflicts from multiple writers.

---

## Table Stakes (Must Have for v6.0)

Features users expect from a distributed instance coordination system. Missing any means the milestone is incomplete.

### API-Side: Instance Registration

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **REG-01** | Exchange-scoped status key | `exchange:{exchange_id}:status` replaces prototype `exchange:status:{exchangeId}` | Low | Consistent key naming with v5.0 exchange-scoped pattern |
| **REG-02** | Full identity payload | Status key stores: `exchangeId`, `exchangeName`, `connectionState`, `connectedAt`, `lastHeartbeat`, `symbolCount`, `adminEmail`, `adminDisplayName`, `ipAddress`, `hostname`, `lastError` | Medium | Admin needs to know who is running what, where |
| **REG-03** | Connection state machine | States: `idle -> starting -> warming -> active -> stopping -> stopped`. Transitions tracked throughout full API lifecycle | Medium | Current prototype has 5 states (`idle`, `connecting`, `connected`, `disconnected`, `error`) that don't match the actual startup phases (backfill, warmup, websocket). The new 6-state machine maps cleanly to the real lifecycle |
| **REG-04** | State transitions throughout lifecycle | State updated at each phase: server start (idle), start command (starting), warmup begin (warming), websocket connected (active), stop command (stopping), shutdown (stopped) | Medium | Current bug: connectionState stuck on `idle` when instance is down because no transition fires |
| **REG-05** | Public IP detection | Detect public IP via external service (ipify.org or similar) at startup, store in status payload | Low | Instances run on different machines; IP identifies the physical host for Admin |
| **REG-06** | Hostname detection | Use `os.hostname()` to identify the machine name, store in status payload | Low | Complements IP with human-readable machine identifier |

### API-Side: Heartbeat and Health

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **HB-01** | Heartbeat with TTL | Periodically refresh status key TTL using `SET ... EX`. If heartbeat stops, key expires = instance is dead | Medium | Core health detection mechanism. No separate health-check service needed |
| **HB-02** | Heartbeat interval configuration | Configurable heartbeat interval (default: 15s) with TTL set to 3x interval (default: 45s). Ratio ensures missed heartbeats don't cause false positives | Low | Industry standard: TTL = 3x heartbeat interval. 15s heartbeat with 45s TTL means instance must miss 3 consecutive heartbeats before being declared dead |
| **HB-03** | Heartbeat timestamp in payload | Each heartbeat updates `lastHeartbeat` ISO timestamp in the status JSON, then refreshes key TTL | Low | Admin UI displays "last seen 5 seconds ago" for real-time health indication |
| **HB-04** | Graceful shutdown cleanup | On SIGINT/SIGTERM, transition to `stopping` state, log the shutdown event, then let key expire naturally (or delete immediately) | Low | Clean shutdowns should be distinguishable from crashes. State `stopping` vs key-expired-after-TTL tells the Admin whether it was graceful |

### API-Side: One-Instance-Per-Exchange Constraint

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **LOCK-01** | Pre-registration check | Before registering for an exchange, check if `exchange:{exchange_id}:status` key exists and is alive (TTL > 0). If another instance holds it, refuse to start | Medium | Prevents two API instances from writing candles for the same exchange simultaneously, which would cause data conflicts |
| **LOCK-02** | Atomic registration | Use `SET exchange:{exchange_id}:status NX EX` semantics (set-if-not-exists with TTL) for the initial claim. If SET returns nil, another instance already holds the exchange | Low | Atomic operation prevents race conditions where two instances start simultaneously |
| **LOCK-03** | Stale lock detection | If key exists but TTL has expired (key gone), treat exchange as available. If key exists with valid TTL, the exchange is claimed | Low | Dead instances auto-release their exchange claim via TTL expiry -- no manual intervention needed |
| **LOCK-04** | Conflict error message | When lock fails, return clear error: "Exchange {name} is already being served by {hostname} ({ip}) since {connectedAt}. Stop that instance first." | Low | Actionable error message tells the Admin exactly who to contact |

### API-Side: Network Activity Log

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **LOG-01** | Redis Stream per exchange | Log events to `logs:network:{exchange_name}` stream (e.g., `logs:network:coinbase`) | Medium | Per-exchange streams keep logs organized and queryable. Stream key matches the naming convention in PROJECT.md |
| **LOG-02** | State transition events | Log every state change: `{timestamp, event: "state_change", fromState, toState, exchangeId, hostname, ip}` | Low | Audit trail of instance lifecycle |
| **LOG-03** | Error events | Log errors with context: `{timestamp, event: "error", error, exchangeId, hostname, ip, state}` | Low | Error history for debugging. Current bug: error not populating in status key |
| **LOG-04** | 90-day retention via MINID | On each XADD, include `MINID ~ {90_days_ago_timestamp}` to trim entries older than 90 days | Low | Time-based retention without external cleanup jobs. MINID trimming (Redis 6.2+) handles this inline with writes |
| **LOG-05** | Structured log entry schema | Consistent field names across all events: `timestamp`, `event`, `exchangeId`, `exchangeName`, `hostname`, `ip`, `adminEmail`, plus event-specific fields | Low | Consistent schema enables reliable parsing in Admin UI |

### Admin UI: Network View

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **UI-01** | Network page in nav | New "Network" page accessible from the Admin header navigation bar. Shows all registered instances | Low | Users need visibility into the distributed system |
| **UI-02** | Instance card per exchange | Card showing: exchange name, connection state (with color-coded badge), hostname, IP, admin name, symbol count, last heartbeat ("3s ago"), connected since timestamp | Medium | At-a-glance health of each instance. Color: green=active, yellow=warming/starting, red=stopped/error, gray=no instance |
| **UI-03** | Dead instance detection | When an exchange has no status key (TTL expired), show the card as "Offline" with last-known information from the most recent stream entry | Medium | Distinguishes between "never registered" and "was running but died" |
| **UI-04** | Activity feed | Scrollable, reverse-chronological feed of network events from Redis Streams. Shows state transitions and errors with timestamps | Medium | Operational visibility. "Mike's Coinbase started 2 hours ago", "Kaia's Binance errored 5 minutes ago" |
| **UI-05** | Polling-based refresh | Poll tRPC endpoint every 5 seconds for status updates (matches existing control panel pattern). No WebSocket needed for v6.0 | Low | Consistent with existing Admin UI polling pattern. Real-time WebSocket upgrades deferred |

### API-Side: tRPC Endpoints

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **RPC-01** | `network.getInstances` | Returns all exchange status keys (scan for `exchange:*:status` pattern). Each includes full identity payload | Low | Admin UI data source for instance cards |
| **RPC-02** | `network.getActivityLog` | Returns recent events from `logs:network:{exchange}` stream via XREVRANGE. Supports COUNT parameter for pagination | Low | Admin UI data source for activity feed |
| **RPC-03** | `network.getExchangeStatus` | Returns status for a single exchange by ID. Used for targeted polling | Low | Efficient single-exchange refresh |

### Bug Fixes (Existing Issues)

| ID | Feature | Description | Complexity | Rationale |
|----|---------|-------------|------------|-----------|
| **FIX-01** | Heartbeat not updating | Current prototype sets `lastHeartbeat` on connect event only, never refreshes it. Fix: periodic heartbeat timer updates the timestamp | Low | Without periodic refresh, lastHeartbeat becomes stale within seconds of connecting |
| **FIX-02** | Error not populating | Current `error` handler reads existing status, but status may be null on first error. Fix: handle null status gracefully in error path | Low | Errors silently swallowed, Admin never sees what went wrong |
| **FIX-03** | connectionState stuck on idle | When instance is down (process exits), status key shows `idle` forever because there is no TTL. Fix: TTL on status key + `stopped` state on shutdown | Low | Without TTL, dead instances look idle forever. Core design flaw that heartbeat-with-TTL solves |

---

## Differentiators (Would Make It Better)

Features that elevate the system beyond basic functionality. Not blocking v6.0, but worth considering.

| ID | Feature | Value Proposition | Complexity | Priority |
|----|---------|-------------------|------------|----------|
| **DIFF-01** | Instance uptime display | Show "Running for 4h 23m" calculated from `connectedAt` | Low | HIGH -- trivial to implement, high user value |
| **DIFF-02** | Heartbeat latency indicator | Show "Last heartbeat: 3s ago" with color degradation (green < 10s, yellow < 30s, red > 30s) | Low | HIGH -- gives real-time health confidence |
| **DIFF-03** | Activity feed filtering | Filter activity feed by exchange, event type (state changes only, errors only), or time range | Medium | MEDIUM -- useful when multiple exchanges are active |
| **DIFF-04** | Discord notifications for state changes | Send Discord notification when instance goes active, errors, or dies (key expires). Leverages existing Discord service | Low | MEDIUM -- extends existing notification infrastructure |
| **DIFF-05** | Instance version tracking | Include API version/git commit hash in status payload. Shows "v6.0.0 (abc1234)" on instance card | Low | LOW -- useful for debugging version mismatches |
| **DIFF-06** | Historical uptime percentage | Calculate uptime from stream events over last 24h/7d/30d. Display as percentage or timeline | High | LOW -- requires stream aggregation, more useful once system is stable |
| **DIFF-07** | Connection state timeline | Visual timeline showing state transitions over time for an instance (horizontal bar chart) | Medium | LOW -- cool but not essential for v6.0 |
| **DIFF-08** | Auto-scroll activity feed | New events appear at top with subtle animation, auto-scrolling if user is at top of feed | Low | MEDIUM -- improves real-time feel of network view |
| **DIFF-09** | Stream entry count display | Show total event count per exchange stream. "1,247 events logged" | Low | LOW -- minor informational value |

---

## Anti-Features (Do NOT Build in v6.0)

Features to explicitly avoid. These are common in distributed systems but premature or out of scope.

| Anti-Feature | Reason | What to Do Instead |
|--------------|--------|-------------------|
| **Standby/passive instance registration** | Requires fundamentally different registration model (active vs passive slots). v6.0 is the foundation for this -- build the registry first, add standby in v6.1+ | Register only active instances. One slot per exchange |
| **Graceful handoff protocol** | "Notify -> takeover -> confirm -> shutdown" requires standby instances, which are not in v6.0 scope | Clean shutdown transitions to `stopped`, key expires. New instance can claim after TTL |
| **Remote Admin control** | Sending commands across instances (Admin UI on Mike's machine controlling Kaia's API) requires ngrok tunnels, auth, and cross-instance pub/sub | Each Admin UI controls only its local API. Network view is read-only |
| **Authorization for remote operations** | Permission schema for "Mike can restart Kaia's instance" is complex and premature | Defer until remote control is implemented |
| **Keyspace notifications for death detection** | Redis keyspace events (`__keyevent@0__:expired`) seem ideal for detecting TTL expiry, but they have critical limitations in Redis Cluster: events are node-specific, not broadcast across cluster. Azure Managed Redis with OSS Cluster mode would require subscribing to every cluster node | Use polling from Admin UI. tRPC endpoint reads current status keys every 5s. Missing key = dead instance. Simple, reliable, cluster-safe |
| **WebSocket-based real-time network view** | Adding WebSocket channels for network status creates complexity for minimal gain over 5s polling | Poll tRPC endpoints every 5s. Matches existing Control Panel pattern. Upgrade to WebSocket in a future milestone if needed |
| **Separate health-check service** | External service that pings instances adds deployment complexity | TTL-based heartbeat is self-contained. Instance is its own health reporter. Missing heartbeat = dead |
| **Instance-to-instance communication** | Direct communication between API instances (Mike's Coinbase talks to Kaia's Binance) adds network complexity | All coordination happens through shared Redis. Instances are unaware of each other |
| **Automatic restart on crash** | Process supervisor (pm2, systemd) responsibility, not application-level | Document recommended process supervisor setup. OS-level restart, not Redis-orchestrated |
| **Multi-stream consumer groups** | XREADGROUP with consumer groups adds complexity for what is essentially a read-only audit log | Use simple XREVRANGE for reading. No consumer groups needed for display-only activity feed |
| **Metrics/prometheus integration** | Full observability stack is overkill for 2-3 instances | Keep it simple: status keys + stream events. Add Prometheus later if instance count grows |

---

## Feature Dependencies

```
REG-01 (exchange-scoped status key)
    |
    +---> REG-02 (full identity payload)
    |         |
    |         +---> REG-05 (public IP detection)
    |         |
    |         +---> REG-06 (hostname detection)
    |
    +---> REG-03 (connection state machine)
    |         |
    |         +---> REG-04 (state transitions throughout lifecycle)
    |                   |
    |                   +---> LOG-02 (state transition events)
    |
    +---> HB-01 (heartbeat with TTL)
    |         |
    |         +---> HB-02 (heartbeat interval config)
    |         |
    |         +---> HB-03 (heartbeat timestamp in payload)
    |         |
    |         +---> HB-04 (graceful shutdown cleanup)
    |         |
    |         +---> FIX-01 (heartbeat not updating)
    |         |
    |         +---> FIX-03 (connectionState stuck on idle)
    |
    +---> LOCK-01 (pre-registration check)
    |         |
    |         +---> LOCK-02 (atomic registration)
    |         |
    |         +---> LOCK-03 (stale lock detection)
    |         |
    |         +---> LOCK-04 (conflict error message)
    |
    +---> LOG-01 (Redis Stream per exchange)
              |
              +---> LOG-02 (state transition events)
              |
              +---> LOG-03 (error events)
              |
              +---> LOG-04 (90-day retention)
              |
              +---> LOG-05 (structured log schema)

RPC-01 (getInstances) ---> UI-02 (instance cards)
                                   |
RPC-02 (getActivityLog) ---> UI-04 (activity feed)
                                   |
RPC-03 (getExchangeStatus) ---> UI-03 (dead instance detection)

UI-01 (network page) ---> UI-02 + UI-03 + UI-04 + UI-05
```

---

## Phase Ordering Recommendation

### Phase 1: Instance Identity and State Machine

Build the registration subsystem. Replaces the prototype `exchange:status` with proper identity.

- **REG-01**: Exchange-scoped status key (new key format)
- **REG-02**: Full identity payload (schema)
- **REG-03**: Connection state machine (6-state FSM)
- **REG-04**: State transitions throughout lifecycle
- **REG-05**: Public IP detection
- **REG-06**: Hostname detection
- **FIX-02**: Error not populating

**Rationale:** Everything else depends on having a well-structured status key with proper state machine. This phase replaces the broken prototype.

### Phase 2: Heartbeat and Locking

Add health monitoring and exclusive ownership.

- **HB-01**: Heartbeat with TTL
- **HB-02**: Heartbeat interval configuration
- **HB-03**: Heartbeat timestamp in payload
- **HB-04**: Graceful shutdown cleanup
- **LOCK-01**: Pre-registration check
- **LOCK-02**: Atomic registration
- **LOCK-03**: Stale lock detection
- **LOCK-04**: Conflict error message
- **FIX-01**: Heartbeat not updating
- **FIX-03**: connectionState stuck on idle

**Rationale:** Heartbeat TTL is what makes the registry self-healing. Locking prevents conflicts. Bug fixes are naturally resolved by the new heartbeat design.

### Phase 3: Network Activity Log

Add the audit trail via Redis Streams.

- **LOG-01**: Redis Stream per exchange
- **LOG-02**: State transition events
- **LOG-03**: Error events
- **LOG-04**: 90-day retention via MINID
- **LOG-05**: Structured log entry schema

**Rationale:** Logging depends on having state transitions to log (Phase 1) and a running heartbeat system to detect lifecycle events (Phase 2).

### Phase 4: Admin UI Network View

Build the visualization layer.

- **UI-01**: Network page in nav
- **UI-02**: Instance card per exchange
- **UI-03**: Dead instance detection
- **UI-04**: Activity feed
- **UI-05**: Polling-based refresh
- **RPC-01**: `network.getInstances`
- **RPC-02**: `network.getActivityLog`
- **RPC-03**: `network.getExchangeStatus`

**Rationale:** UI consumes all three backend subsystems. Build last so all data sources are available and tested.

---

## Technical Considerations

### Status Key Format

```
Key:   exchange:{exchange_id}:status
Type:  String (JSON-encoded)
TTL:   45 seconds (refreshed by heartbeat every 15 seconds)

Payload:
{
  "exchangeId": 1,
  "exchangeName": "coinbase",
  "connectionState": "active",
  "connectedAt": "2026-02-10T14:30:00.000Z",
  "lastHeartbeat": "2026-02-10T15:42:30.000Z",
  "symbolCount": 24,
  "adminEmail": "mike@example.com",
  "adminDisplayName": "Mike",
  "ipAddress": "72.34.55.12",
  "hostname": "MIKE-DESKTOP",
  "lastError": null
}
```

### Redis Stream Entry Format

```
Stream: logs:network:coinbase
Entry:  XADD logs:network:coinbase MINID ~ {90_days_ago_ms} * \
          timestamp "2026-02-10T14:30:00.000Z" \
          event "state_change" \
          fromState "warming" \
          toState "active" \
          exchangeId "1" \
          exchangeName "coinbase" \
          hostname "MIKE-DESKTOP" \
          ip "72.34.55.12" \
          adminEmail "mike@example.com"
```

### State Machine Transitions

```
idle -----(start command)-----> starting
starting --(backfill done)----> warming
warming ---(indicators done)--> active
active ----(stop command)-----> stopping
stopping --(cleanup done)----> stopped

Any state --(error)-----------> [stays in current state, sets lastError]
Any state --(TTL expires)-----> [key deleted, instance is dead]
```

Note: Errors do NOT change state. An instance that errors during `warming` stays in `warming` with `lastError` populated. Only explicit transitions change state. This prevents error-induced state oscillation.

### Heartbeat Interval Math

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Heartbeat interval | 15 seconds | Balance between freshness and Redis load. At 2-3 instances, this is ~12 writes/minute total |
| Key TTL | 45 seconds | 3x heartbeat interval. Instance must miss 3 consecutive heartbeats to be declared dead |
| Admin UI poll | 5 seconds | Matches existing control panel. "Last seen Xs ago" updates every poll cycle |
| Worst-case detection | ~50 seconds | 45s TTL + 5s poll interval = Admin learns of death within 50s |

### Azure Redis Cluster Compatibility

All operations used are cluster-safe:
- `SET key value NX EX ttl` -- single-key atomic operation
- `GET key` -- single-key read
- `XADD stream ...` -- single-key write
- `XREVRANGE stream ...` -- single-key read
- `KEYS exchange:*:status` -- NOTE: KEYS is discouraged in cluster mode. Use `SCAN 0 MATCH exchange:*:status COUNT 100` instead for the getInstances endpoint

The SCAN-based approach is important because KEYS blocks the Redis event loop. With only 2-6 exchange status keys expected, SCAN with COUNT 100 will complete in a single iteration.

---

## Sources

Research based on:
- Existing codebase analysis (v5.0 shipped patterns, adapter-factory.ts prototype)
- PROJECT.md v6.0 milestone specification
- Domain research:
  - [Redis Heartbeat-Based Session Tracking](https://medium.com/tilt-engineering/redis-powered-user-session-tracking-with-heartbeat-based-expiration-c7308422489f) -- TTL refresh patterns, heartbeat interval ratios
  - [Redis Distributed Locks with Heartbeats](https://compileandrun.com/redis-distrubuted-locks-with-heartbeats/) -- SET NX EX for atomic claims
  - [Redis Distributed Locks (Official)](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) -- Safety properties, SET NX EX semantics
  - [Redis Streams Documentation](https://redis.io/docs/latest/develop/data-types/streams/) -- XADD, XREVRANGE, MINID trimming
  - [Redis XADD Command Reference](https://redis.io/docs/latest/commands/xadd/) -- MINID syntax, approximate trimming
  - [Redis XREVRANGE Command Reference](https://redis.io/docs/latest/commands/xrevrange/) -- Reverse range queries, COUNT parameter
  - [Redis Keyspace Notifications](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/) -- Cluster limitations (events not broadcast across nodes)
  - [Azure Redis Keyspace Notifications](https://techcommunity.microsoft.com/blog/azurepaasblog/redis-keyspace-events-notifications/1551134) -- Azure-specific limitations
  - [ipify Public IP API](https://www.ipify.org/) -- Zero-dependency public IP detection
  - [public-ip npm package](https://github.com/sindresorhus/public-ip) -- Node.js public IP detection with multiple fallback services
  - [ioredis Streams Example](https://gist.github.com/forkfork/c27d741650dd65631578771ab264dd2c) -- XADD/XREAD with ioredis
  - [Health Check API Pattern](https://microservices.io/patterns/observability/health-check-api.html) -- Microservices health monitoring patterns
  - [Health Endpoint Monitoring (Azure)](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring) -- Endpoint monitoring best practices

---

*Researched: 2026-02-10*
*Researcher: Claude (gsd-researcher)*
