---
phase: 30-instance-registry-and-state-machine
verified: 2026-02-10T22:45:00Z
status: passed
score: 5/5 must-haves verified
gaps: []
---

# Phase 30: Instance Registry and State Machine Verification Report

**Phase Goal:** Each Livermore API instance is a uniquely identifiable, self-reporting node in Redis with validated state transitions and automatic dead-instance detection
**Verified:** 2026-02-10T22:45:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When instance starts/receives start command, exchange-scoped Redis key appears with full identity payload | VERIFIED | register() in instance-registry.service.ts builds 14-field InstanceStatus payload, writes via SET key value EX 45 NX. server.ts calls register() on autostart (line 264), control-channel calls register() in handleStart (line 516). Key pattern exchange:{exchangeId}:status via instanceStatusKey(). |
| 2 | Instance key TTL refreshes every heartbeat interval (15s) and auto-expires after 3x (45s) if heartbeating stops | VERIFIED | HEARTBEAT_INTERVAL_MS=15000, HEARTBEAT_TTL_SECONDS=45 in schema. startHeartbeat() uses setInterval at 15s (line 198), heartbeatTick() writes SET EX 45 XX (lines 212-218). Timer unref so dead process allows Node exit and key auto-expires. |
| 3 | Connection state progresses idle->starting->warming->active during startup, active->stopping->stopped during shutdown, invalid transitions rejected | VERIFIED | VALID_TRANSITIONS defines allowed transitions. StateMachineService.transition() validates and throws on invalid. server.ts: starting(269), warming(405), active(433). control-channel: starting(521), warming(540), active(589). handleStop: stopping(637), stopped(657). |
| 4 | Second instance claiming same exchange refused with error identifying holder (hostname, IP, connectedAt) | VERIFIED | register() lines 131-162: on NX failure reads existing key. If different host, throws error with existing.hostname, existing.ipAddress, existing.connectedAt, TTL remaining. Same-host reclaims via SET EX XX. |
| 5 | Three bugs resolved: FIX-01 heartbeat updates, FIX-02 errors persist, FIX-03 dead instances expire | VERIFIED | FIX-01: startHeartbeat() called on every register() success. FIX-02: recordError() writes from in-memory state via updateStatus(). FIX-03: Every redis.set() uses EX or KEEPTTL -- all 5 SET calls verified. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| packages/schemas/src/network/instance-status.schema.ts | ConnectionState, VALID_TRANSITIONS, heartbeat constants, InstanceStatus | VERIFIED (88 lines) | 6-state Zod enum, typed transition map, 3 constants, 14-field Zod schema. Exported via schemas index. |
| packages/cache/src/keys.ts | instanceStatusKey() builder | VERIFIED (305 lines) | Returns exchange:{exchangeId}:status. Imported by instance-registry and exchange-symbol router. |
| apps/api/src/utils/detect-public-ip.ts | IP detection via ipify.org | VERIFIED (35 lines) | Uses node:https, 3s timeout, never throws, returns string or null. Imported by instance-registry. |
| apps/api/src/services/state-machine.service.ts | StateMachineService | VERIFIED (140 lines) | transition() validates against VALID_TRANSITIONS. Capped history. Updates Redis via registry. Legacy state mapping via exhaustive switch. |
| apps/api/src/services/instance-registry.service.ts | InstanceRegistryService | VERIFIED (312 lines) | register() with SET NX EX, self-restart detection, conflict error. heartbeatTick() with SET EX XX. updateStatus() with KEEPTTL. recordError(), setAdminInfo(), setSymbolCount(), deregister(). |
| apps/api/src/services/types/service-registry.ts | instanceRegistry and stateMachine fields | VERIFIED (87 lines) | Both fields required (non-optional) on ServiceRegistry interface. |
| apps/api/src/services/runtime-state.ts | ConnectionState expanded | VERIFIED (90 lines) | Type union includes all 10 states: old 5 + new 5 (starting, warming, active, stopping, stopped). |
| apps/api/src/server.ts | Wiring in startup and shutdown | VERIFIED (571 lines) | Creates services (255-260). Autostart: register, transitions. Shutdown: stopping, deregister. ServiceRegistry includes both. |
| apps/api/src/services/control-channel.service.ts | Wiring in handleStart/handleStop | VERIFIED (1303 lines) | handleStart: fresh registry+SM, register, transitions. Error: recordError+resetToIdle. handleStop: stopping, stopped, deregister, resetToIdle. |
| apps/api/src/services/exchange/adapter-factory.ts | Prototype code REMOVED | VERIFIED (136 lines) | No ExchangeConnectionStatus, connectionStatusKey, setupConnectionTracking, updateHeartbeat, getConnectionStatus, setConnectionStatus, or private redis member. |
| apps/api/src/services/exchange/index.ts | Old exports REMOVED | VERIFIED (7 lines) | Only exports ExchangeAdapterFactory and AdapterFactoryConfig. |
| apps/api/src/routers/exchange-symbol.router.ts | Migrated to new key format | VERIFIED (354 lines) | Imports instanceStatusKey and InstanceStatus. exchangeStatuses query uses new key format. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| server.ts | InstanceRegistryService | constructor + register() | WIRED | Lines 255-264: creates service, calls register() on autostart |
| server.ts | StateMachineService | constructor + transition() | WIRED | Lines 260, 269, 405, 433: creates service, transitions at lifecycle points |
| server.ts shutdown | deregister() | shutdown handler | WIRED | Line 553: await instanceRegistry.deregister() |
| control-channel handleStart | InstanceRegistryService | new + register() | WIRED | Lines 508-516: creates fresh registry, calls register() |
| control-channel handleStart | StateMachineService | new + transition() | WIRED | Lines 514, 521, 540, 589: creates SM, transitions through all states |
| control-channel handleStop | transition + deregister | method calls | WIRED | Lines 637, 657-659: stopping, stopped, deregister, resetToIdle |
| control-channel error path | recordError + resetToIdle | catch block | WIRED | Lines 608-612: records error, resets state machine |
| InstanceRegistryService | instanceStatusKey | import | WIRED | Line 7: used in register, heartbeatTick, updateStatus, getStatus, deregister |
| InstanceRegistryService | detectPublicIp | import | WIRED | Line 10: called in register() success path (line 118) |
| InstanceRegistryService | HEARTBEAT constants | import | WIRED | Lines 4-6: used in setInterval and all SET EX calls |
| StateMachineService | VALID_TRANSITIONS | import | WIRED | Line 2: used in transition() validation (line 72-74) |
| StateMachineService | registry.updateStatus() | DI | WIRED | Line 98: calls this.registry.updateStatus() on transition |
| StateMachineService | updateRuntimeState | import | WIRED | Lines 4, 101-105: maps to legacy state and updates RuntimeState |
| exchange-symbol.router | instanceStatusKey + InstanceStatus | imports | WIRED | Lines 7-8: used in exchangeStatuses query |
| schemas index | instance-status.schema | re-export | WIRED | export * from ./network/instance-status.schema |
| initControlChannelService | setAdminInfo | method call | WIRED | server.ts line 120: instanceRegistry.setAdminInfo() |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REG-01: Exchange-scoped status key | SATISFIED | instanceStatusKey() returns exchange:{exchangeId}:status |
| REG-02: Full 14-field identity payload | SATISFIED | InstanceStatusSchema has all 14 fields |
| REG-03: 6-state ConnectionState enum | SATISFIED | z.enum([idle, starting, warming, active, stopping, stopped]) |
| REG-04: State transitions at lifecycle phases | SATISFIED | transition() called at starting, warming, active, stopping, stopped |
| REG-05: Public IP detection with timeout and fallback | SATISFIED | detectPublicIp(): ipify.org, 3s timeout, null fallback |
| REG-06: Hostname via os.hostname() | SATISFIED | this.host = hostname() from node:os |
| HB-01: Heartbeat refreshes TTL via SET EX | SATISFIED | heartbeatTick() uses SET EX 45 XX |
| HB-02: 15s interval, 45s TTL | SATISFIED | HEARTBEAT_INTERVAL_MS=15000, HEARTBEAT_TTL_SECONDS=45 |
| HB-03: lastHeartbeat ISO timestamp updated each tick | SATISFIED | Line 209: new Date().toISOString() before SET |
| HB-04: Graceful shutdown transitions and deregisters | SATISFIED | transition(stopping), deregister() in both shutdown paths |
| LOCK-01: Check if key exists before registering | SATISFIED | SET NX EX fails if key exists; on failure reads and checks |
| LOCK-02: Atomic SET NX EX | SATISFIED | redis.set(key, value, EX, 45, NX) -- single atomic command |
| LOCK-03: Expired key = exchange available | SATISFIED | NX succeeds on expired keys, race window handled with retry |
| LOCK-04: Conflict error includes hostname, IP, connectedAt | SATISFIED | Error message includes all three plus TTL remaining |
| FIX-01: Heartbeat actually runs | SATISFIED | startHeartbeat() called in every register() success path |
| FIX-02: Error persists to status key | SATISFIED | recordError() writes from in-memory state with KEEPTTL |
| FIX-03: Dead instances do not show as idle forever | SATISFIED | Every SET uses EX or KEEPTTL; dead process = key expires in 45s |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| server.ts | 397 | userId: 1, // TODO | Info | Pre-existing TODO, not from Phase 30 |
| adapter-factory.ts | 104-106 | // Future: Add other exchanges | Info | Pre-existing placeholder, not a stub |

No blockers. No stub patterns in Phase 30 artifacts. TypeScript compiles with zero errors. Zero remaining references to old prototype exports.

### Human Verification Required

#### 1. Full Lifecycle Round-Trip

**Test:** Start API with --autostart coinbase, verify Redis key appears, wait 20s for heartbeat, send stop, verify key deleted.
**Expected:** Key created with all 14 fields, lastHeartbeat refreshes every 15s, key deleted on stop.
**Why human:** Requires running server against live Redis.

#### 2. Conflict Detection

**Test:** Start two instances targeting the same exchange simultaneously.
**Expected:** Second instance throws error with hostname/IP/connectedAt of first instance.
**Why human:** Requires two running processes.

#### 3. Dead Instance Auto-Expiry

**Test:** Start instance, kill with kill -9 (no graceful shutdown), wait 50s, verify key gone.
**Expected:** Key auto-expires after 45s TTL with no heartbeat.
**Why human:** Requires forcefully killing process and observing Redis TTL.

#### 4. State Machine Transition Rejection

**Test:** Send stop command when instance is in idle state.
**Expected:** State machine rejects idle->stopping transition.
**Why human:** Requires sending commands and observing rejection in logs.

### Gaps Summary

No gaps found. All 17 Phase 30 requirements are satisfied with substantive implementations. All 12 key artifacts exist, are non-trivial (7-1303 lines each), contain no stub patterns, and are fully wired into the server lifecycle. Prototype code has been completely removed from adapter-factory.ts. TypeScript compiles cleanly with zero errors.

---

*Verified: 2026-02-10T22:45:00Z*
*Verifier: Claude (gsd-verifier)*
