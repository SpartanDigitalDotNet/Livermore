# Roadmap: Livermore v6.0 Perseus Network

## Overview

v6.0 transforms Livermore from isolated API instances with no mutual awareness into a coordinated Perseus Network with identity, health monitoring, and audit logging. The roadmap progresses from foundational instance registration and heartbeat (replacing the broken prototype) through Redis Streams logging, tRPC API surface, and finally an Admin UI Network page that makes the entire system observable. Each phase delivers a complete, testable capability that the next phase builds upon.

## Phases

**Phase Numbering:**
- Integer phases (30, 31, 32, 33): Planned v6.0 milestone work
- Decimal phases (30.1, 30.2): Urgent insertions if needed (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 30: Instance Registry and State Machine** - Exchange-scoped registration with typed state machine, TTL heartbeat, and one-instance-per-exchange enforcement
- [ ] **Phase 31: Network Activity Logging** - Redis Streams event log for state transitions and errors with 90-day retention
- [ ] **Phase 32: tRPC Network Router** - API endpoints for reading instance status and activity logs
- [ ] **Phase 33: Admin UI Network View** - Visual network dashboard with instance cards, status badges, activity feed, and differentiators

## Phase Details

### Phase 30: Instance Registry and State Machine
**Goal**: Each Livermore API instance is a uniquely identifiable, self-reporting node in Redis with validated state transitions and automatic dead-instance detection
**Depends on**: Nothing (first phase -- replaces broken prototype)
**Requirements**: REG-01, REG-02, REG-03, REG-04, REG-05, REG-06, HB-01, HB-02, HB-03, HB-04, LOCK-01, LOCK-02, LOCK-03, LOCK-04, FIX-01, FIX-02, FIX-03
**Success Criteria** (what must be TRUE):
  1. When a Livermore API instance starts and receives a `start` command, an exchange-scoped Redis key appears with full identity payload (exchangeId, exchangeName, connectionState, hostname, IP, admin info, symbolCount, connectedAt, lastHeartbeat, lastError)
  2. The instance key TTL refreshes every heartbeat interval (default 15s) and the key auto-expires after 3x the interval (default 45s) if heartbeating stops -- meaning a killed process leaves no permanent ghost key
  3. Connection state progresses through `idle -> starting -> warming -> active` during normal startup and `active -> stopping -> stopped` during shutdown, with invalid transitions rejected
  4. A second instance attempting to claim the same exchange is refused with an error message identifying who holds the lock (hostname, IP, connectedAt)
  5. The three existing bugs are resolved: heartbeat updates consistently (FIX-01), errors persist to the status key (FIX-02), and dead instances do not show as `idle` forever (FIX-03)
**Plans**: 3 plans

Plans:
- [ ] 30-01-PLAN.md -- Foundation: Zod schemas, key builders, IP detection utility
- [ ] 30-02-PLAN.md -- Core services: StateMachineService and InstanceRegistryService
- [ ] 30-03-PLAN.md -- Integration: Wire into server.ts, control-channel, cleanup adapter-factory

### Phase 31: Network Activity Logging
**Goal**: Every state transition and error across all instances is durably recorded in Redis Streams with automatic retention management
**Depends on**: Phase 30 (state transitions and errors to log)
**Requirements**: LOG-01, LOG-02, LOG-03, LOG-04, LOG-05, LOG-06
**Success Criteria** (what must be TRUE):
  1. When an instance transitions state (e.g., idle to starting, active to stopping), an entry appears in the exchange's Redis Stream (`logs:network:{exchange_name}`) containing timestamp, event type, fromState, toState, exchangeId, exchangeName, hostname, ip, and adminEmail
  2. When an error occurs, an error event is logged to the same stream with timestamp, event type, error message, exchangeId, exchangeName, hostname, ip, and current state
  3. Heartbeat refreshes do NOT produce stream entries -- only state transitions and errors appear in the log
  4. Stream entries older than 90 days are automatically trimmed via inline MAXLEN or MINID on every XADD, preventing unbounded memory growth
**Plans**: TBD

Plans:
- [ ] 31-01: TBD

### Phase 32: tRPC Network Router
**Goal**: The Admin UI has a reliable API surface to read instance status and activity logs without SCAN/KEYS commands
**Depends on**: Phase 30 (instance keys to read), Phase 31 (stream entries to query)
**Requirements**: RPC-01, RPC-02, RPC-03
**Success Criteria** (what must be TRUE):
  1. Calling `network.getInstances` returns status for all known exchanges (sourced from the `exchanges` database table, not Redis SCAN/KEYS), including instances that are offline (key missing)
  2. Calling `network.getActivityLog` returns recent state transitions and errors from Redis Streams in reverse chronological order with pagination support (COUNT parameter)
  3. Calling `network.getExchangeStatus` returns the full status payload for a single exchange by ID, or a clear "offline" indicator if the key has expired
**Plans**: TBD

Plans:
- [ ] 32-01: TBD

### Phase 33: Admin UI Network View
**Goal**: Admins can see every instance in the Perseus Network at a glance -- who is running what, where, whether it is healthy, and what happened recently
**Depends on**: Phase 32 (tRPC endpoints to consume)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, DIFF-01, DIFF-02, DIFF-04
**Success Criteria** (what must be TRUE):
  1. A "Network" link appears in the Admin header navigation, and clicking it shows instance cards for every known exchange -- each card displays exchange name, connection state as a color-coded badge, hostname, IP, admin name, symbol count, last heartbeat timestamp, and connected-since time
  2. When an instance key has expired (instance is dead), its card displays as "Offline" with last-known information pulled from the most recent stream entry
  3. A scrollable activity feed below the cards shows state transitions and errors in reverse chronological order, auto-refreshing alongside the instance cards
  4. The entire page polls at a 5-second interval consistent with the existing control panel pattern, showing live heartbeat latency with color degradation (green < 10s, yellow < 30s, red > 30s) and uptime duration ("Running for 4h 23m")
  5. Discord notifications fire when an instance changes state (e.g., goes offline, comes online), leveraging the existing Discord notification service
**Plans**: TBD

Plans:
- [ ] 33-01: TBD
- [ ] 33-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 30 -> 31 -> 32 -> 33

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 30. Instance Registry and State Machine | 0/3 | Planned | - |
| 31. Network Activity Logging | 0/TBD | Not started | - |
| 32. tRPC Network Router | 0/TBD | Not started | - |
| 33. Admin UI Network View | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-10*
*Last updated: 2026-02-10*
