# Requirements: Livermore v6.0 Perseus Network

**Defined:** 2026-02-10
**Core Value:** Data accuracy and timely alerts

## v1 Requirements

Requirements for v6.0 release. Each maps to roadmap phases.

### Instance Registration

- [x] **REG-01**: Exchange-scoped status key `exchange:{exchange_id}:status` replaces prototype `exchange:status`
- [x] **REG-02**: Full identity payload: exchangeId, exchangeName, connectionState, connectedAt, lastHeartbeat, symbolCount, adminEmail, adminDisplayName, ipAddress, hostname, lastError
- [x] **REG-03**: Connection state machine with 6 states: `idle → starting → warming → active → stopping → stopped`
- [x] **REG-04**: State transitions maintained at each lifecycle phase (server start, start command, warmup, websocket connected, stop command, shutdown)
- [x] **REG-05**: Public IP detection via external service (ipify.org) at startup with timeout and fallback
- [x] **REG-06**: Hostname detection via `os.hostname()` stored in status payload

### Heartbeat and Health

- [x] **HB-01**: Heartbeat refreshes status key TTL periodically using `SET ... EX`
- [x] **HB-02**: Configurable heartbeat interval (default 15s) with TTL at 3x interval (default 45s)
- [x] **HB-03**: Each heartbeat updates `lastHeartbeat` ISO timestamp in status payload
- [x] **HB-04**: Graceful shutdown transitions to `stopping` state, logs shutdown event, lets key expire or deletes immediately

### One-Instance-Per-Exchange

- [x] **LOCK-01**: Before registering, check if `exchange:{exchange_id}:status` key exists with valid TTL
- [x] **LOCK-02**: Atomic registration via `SET NX EX` (set-if-not-exists with TTL) to prevent race conditions
- [x] **LOCK-03**: Stale lock detection — expired key (TTL gone) means exchange is available
- [x] **LOCK-04**: Conflict error message includes hostname, IP, and connectedAt of the instance holding the lock

### Network Activity Log

- [x] **LOG-01**: Redis Stream per exchange (`logs:network:{exchange_name}`) for event storage
- [x] **LOG-02**: State transition events logged: timestamp, event, fromState, toState, exchangeId, exchangeName, hostname, ip, adminEmail
- [x] **LOG-03**: Error events logged: timestamp, event, error message, exchangeId, exchangeName, hostname, ip, state
- [x] **LOG-04**: 90-day retention via inline trimming on every XADD (MAXLEN or MINID)
- [x] **LOG-05**: Structured log entry schema with consistent field names across all event types
- [x] **LOG-06**: Heartbeat refreshes are NOT logged to the stream — only state transitions and errors

### Admin UI Network View

- [x] **UI-01**: "Network" page accessible from Admin header navigation
- [x] **UI-02**: Instance card per exchange showing: exchange name, connection state (color-coded badge), hostname, IP, admin name, symbol count, last heartbeat, connected since
- [x] **UI-03**: Dead instance detection — when key is expired/missing, show card as "Offline" with last-known info from most recent stream entry
- [x] **UI-04**: Scrollable activity feed showing state transitions and errors from Redis Streams (reverse chronological)
- [x] **UI-05**: Polling-based refresh at 5s interval (matches existing control panel pattern)

### tRPC Endpoints

- [x] **RPC-01**: `network.getInstances` returns all exchange instance statuses (read from known exchange IDs in DB, not SCAN/KEYS)
- [x] **RPC-02**: `network.getActivityLog` returns recent events from stream via XREVRANGE with COUNT for pagination
- [x] **RPC-03**: `network.getExchangeStatus` returns status for a single exchange by ID

### Bug Fixes

- [x] **FIX-01**: Fix heartbeat not updating — periodic timer refreshes lastHeartbeat timestamp and key TTL
- [x] **FIX-02**: Fix error not populating — handle null status in error path, persist lastError to status key
- [x] **FIX-03**: Fix connectionState stuck on idle — TTL on status key ensures dead instances don't show as idle forever

### Differentiators

- [x] **DIFF-01**: Instance uptime display ("Running for 4h 23m") calculated from connectedAt
- [x] **DIFF-02**: Heartbeat latency indicator with color degradation (green < 10s, yellow < 30s, red > 30s)
- [x] **DIFF-04**: Discord notifications for instance state changes (leverages existing Discord service)

## v2 Requirements (Deferred to v6.1+)

### Standby and Failover

- **STBY-01**: Passive/standby instance registration (subscribe as backup for an exchange)
- **STBY-02**: Graceful handoff protocol (notify → takeover → confirm → shutdown)
- **STBY-03**: Automatic standby promotion when primary heartbeat expires

### Remote Administration

- **RMOT-01**: Remote Admin control — send commands to another instance's API via Redis
- **RMOT-02**: Ngrok tunnel for remote Admin UI access, URL published to Redis
- **RMOT-03**: Authorization schema for remote operations (request/grant/revoke permissions)

### Enhanced Monitoring

- **MON-01**: WebSocket-based real-time network view (replace polling)
- **MON-02**: Historical uptime percentage (24h/7d/30d)
- **MON-03**: Connection state timeline visualization

## Out of Scope

| Feature | Reason |
|---------|--------|
| Keyspace notifications for death detection | Unreliable in Redis Cluster — events are node-specific, not broadcast |
| Separate health-check service | TTL-based heartbeat is self-contained; instance is its own health reporter |
| Instance-to-instance communication | All coordination through shared Redis; instances are unaware of each other |
| Automatic restart on crash | OS-level responsibility (pm2, systemd), not application-level |
| Multi-stream consumer groups | XREADGROUP overkill for read-only audit log; simple XREVRANGE sufficient |
| Prometheus/metrics integration | Overkill for 2-3 instances; defer until instance count grows |
| CCXT or external service discovery | Redis-native coordination is simpler and already in the stack |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REG-01 | Phase 30 | Done |
| REG-02 | Phase 30 | Done |
| REG-03 | Phase 30 | Done |
| REG-04 | Phase 30 | Done |
| REG-05 | Phase 30 | Done |
| REG-06 | Phase 30 | Done |
| HB-01 | Phase 30 | Done |
| HB-02 | Phase 30 | Done |
| HB-03 | Phase 30 | Done |
| HB-04 | Phase 30 | Done |
| LOCK-01 | Phase 30 | Done |
| LOCK-02 | Phase 30 | Done |
| LOCK-03 | Phase 30 | Done |
| LOCK-04 | Phase 30 | Done |
| LOG-01 | Phase 31 | Done |
| LOG-02 | Phase 31 | Done |
| LOG-03 | Phase 31 | Done |
| LOG-04 | Phase 31 | Done |
| LOG-05 | Phase 31 | Done |
| LOG-06 | Phase 31 | Done |
| UI-01 | Phase 33 | Done |
| UI-02 | Phase 33 | Done |
| UI-03 | Phase 33 | Done |
| UI-04 | Phase 33 | Done |
| UI-05 | Phase 33 | Done |
| RPC-01 | Phase 32 | Done |
| RPC-02 | Phase 32 | Done |
| RPC-03 | Phase 32 | Done |
| FIX-01 | Phase 30 | Done |
| FIX-02 | Phase 30 | Done |
| FIX-03 | Phase 30 | Done |
| DIFF-01 | Phase 33 | Done |
| DIFF-02 | Phase 33 | Done |
| DIFF-04 | Phase 33 | Done |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0

---
*Requirements defined: 2026-02-10*
*Last updated: 2026-02-10 -- ALL REQUIREMENTS COMPLETE (34/34 done)*
