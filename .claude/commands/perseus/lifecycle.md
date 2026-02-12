---
name: perseus:lifecycle
description: Test the 6-state instance lifecycle (idle->starting->warming->active->stopping->stopped)
argument-hint: "[kraken|full]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

<objective>
Test the Perseus instance lifecycle state machine by running a simulated exchange instance
and verifying all state transitions are recorded in Redis (both the instance status key and
the activity stream).
</objective>

<critical_rules>
- NEVER look for .env files. Inject LIVERMORE_REDIS_URL from Windows User scope.
- The state machine has 6 states: idle, starting, warming, active, stopping, stopped.
- Valid transitions:
    idle → starting
    starting → warming | stopping | idle (error recovery)
    warming → active | stopping | idle (error recovery)
    active → stopping
    stopping → stopped
    stopped → idle
- Instance status is stored at: `exchange:{exchangeId}:status` (TTL 45s)
- Activity stream is at: `logs:network:{exchangeName}` (Redis Stream)
- Heartbeat interval: 15s, TTL: 45s (3x interval)
</critical_rules>

<context>
## Test Script: test-v6-kraken.ts

**Location:** `scripts/test-v6-kraken.ts`
**Usage:** `npx tsx scripts/test-v6-kraken.ts`
**What it does:**
1. Claims exchange 4 (kraken) with SET NX, EX 60
2. Logs 3 state transitions to activity stream (200ms delays):
   - idle → starting
   - starting → warming
   - warming → active
3. Trims stream to 90 days retention
4. Waits 60s for TTL expiration

**Expected output:** "Exchange 4 (kraken) claimed with 3 activity entries. TTL: 60s"

## Test Script: test-v6-lock.ts

**Location:** `scripts/test-v6-lock.ts`
**Usage:** `npx tsx scripts/test-v6-lock.ts`
**What it does:**
1. TEST 1: Attempt SET NX on exchange 1 (already held) → null (conflict)
2. TEST 2: Claim unclaimed exchange 99 → 'OK'
3. TEST 3: Double-claim exchange 99 → null (conflict prevented)
4. TEST 4: Heartbeat XX on non-existent key → null

## Instance Status Payload (JSON in Redis)
```
{
  exchangeId, exchangeName, hostname, ipAddress,
  adminEmail, adminDisplayName, connectionState,
  symbolCount, connectedAt, lastHeartbeat,
  lastStateChange, registeredAt, lastError, lastErrorAt
}
```

## Verifying Shutdown Lifecycle
The graceful shutdown in `apps/api/src/server.ts` transitions:
1. `stopping` — after SIGINT/SIGTERM received
2. `stopped` — after all services shut down, before deregister

To verify: run the API, send SIGINT, check that both `stopping` and `stopped` appear in
the activity stream via `test-v6-redis.ts`.
</context>

<process>
Parse $ARGUMENTS to determine test scope.

## Mode: kraken (default)
Run the Kraken simulation test:
```bash
powershell -Command "$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User'); npx tsx scripts/test-v6-kraken.ts"
```

Verify output contains "claimed with 3 activity entries".

Then verify the activity stream has the transitions:
```bash
powershell -Command "$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User'); npx tsx scripts/test-v6-redis.ts"
```

Check that `logs:network:kraken` stream contains idle→starting, starting→warming, warming→active.

## Mode: full
Run both kraken and lock tests:
1. Run test-v6-kraken.ts (state transitions)
2. Run test-v6-lock.ts (lock claiming / conflict prevention)
3. Run test-v6-redis.ts (verify all state in Redis)

Report all results.

## Report
Summarize:
- Which transitions were recorded
- Lock claim results (success/conflict as expected)
- Instance status payload contents
- Activity stream entry count
</process>

<success_criteria>
- [ ] State transitions recorded in activity stream
- [ ] Lock claiming works (NX succeeds for unclaimed, fails for claimed)
- [ ] Instance status key contains valid JSON payload
- [ ] All 6 states documented and testable
</success_criteria>
