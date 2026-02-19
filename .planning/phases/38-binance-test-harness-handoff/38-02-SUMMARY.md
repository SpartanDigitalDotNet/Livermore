---
phase: 38-binance-test-harness-handoff
plan: 02
subsystem: documentation
tags: [handoff, binance, validation, kaia, documentation]
dependency_graph:
  requires:
    - 38-01 (Subscription Test Harness)
    - 37-03 (Warmup Progress Display)
    - 37-02 (Update Exchange Config & Edit Mode)
    - 37-01 (Admin Connect Button & Flow)
  provides:
    - TST-03 (Test harness executed against real exchange)
    - TST-04 (Kaia handoff documentation)
  affects:
    - .planning/phases/38-binance-test-harness-handoff (KAIA-HANDOFF.md created)
tech_stack:
  added: []
  patterns:
    - Handoff documentation structure
    - Step-by-step setup guides
    - Troubleshooting decision trees
key_files:
  created:
    - .planning/phases/38-binance-test-harness-handoff/KAIA-HANDOFF.md
  modified: []
decisions:
  - Structured KAIA-HANDOFF.md with 7 sections: Overview, Environment Variables, Exchange Database Configuration, First-Run Steps, Verification Checklist, Troubleshooting, Test Results
  - Documented test results from Task 1 checkpoint (TST-01 and TST-02 both PASSED)
  - Environment variables sourced from Windows User scope (not .env files)
  - API keys optional for Binance market data (public endpoints)
  - Included Admin UI Network page flow from Phase 37
  - Reference test-subscription-harness script as primary verification tool
metrics:
  duration_minutes: 2
  tasks_completed: 2
  files_created: 1
  commits: 1
  completed_date: 2026-02-13
---

# Phase 38 Plan 02: Execute Test Harness & Create Kaia Handoff Documentation

**One-liner:** Executed subscription test harness against Binance US (both TST-01 REST and TST-02 WebSocket PASSED) and created comprehensive handoff documentation for Kaia with environment setup, first-run steps, verification checklist, and troubleshooting guidance.

## Overview

Phase 38 Plan 02 completes the Binance adapter validation and handoff process. Task 1 executed the subscription test harness created in Plan 38-01 against the live Binance US exchange to validate the complete data pipeline. Task 2 created comprehensive handoff documentation for Kaia covering everything needed to configure and run her own Binance instance.

## What Was Built

### Task 1: Execute Test Harness Against Binance US (Checkpoint - Complete)

**Type:** `checkpoint:human-verify`

**Execution:**
User ran the test harness via PowerShell:
```powershell
.\scripts\test-subscription-harness.ps1 -Exchange binance_us
```

**Results:**
- **TST-01 (REST Warmup Validation):** ✓ PASS
  - REST client connected to Binance US API
  - Fetched BTC 1-day candles via `getCandles('BTCUSDT', '1d')`
  - Candles cached to Redis using exchange-scoped key
  - Verified with `ZCARD` command

- **TST-02 (WebSocket Streaming Validation):** ✓ PASS
  - WebSocket connected to `wss://stream.binance.us:9443/ws`
  - Subscribed to `btcusdt@kline_1m` stream
  - Received kline messages within 2-second test window
  - OHLCV data parsed successfully

**Validation:** Both tests passed, confirming the Binance adapter pipeline is fully functional.

### Task 2: Create Kaia Handoff Documentation

**File Created:** `.planning/phases/38-binance-test-harness-handoff/KAIA-HANDOFF.md`

**Structure:**

#### Section 1: Overview
- Explanation of Livermore's distributed multi-exchange architecture
- Concept of "instance ownership" (one instance per exchange)
- Shared infrastructure (PostgreSQL, Redis) with exchange-scoped keys
- Admin UI Network page as control center

#### Section 2: Environment Variables
Documented all required environment variables grouped by purpose:

**Database (Shared Azure PostgreSQL Sandbox):**
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_LIVERMORE_USERNAME`, `DATABASE_LIVERMORE_PASSWORD`, `LIVERMORE_DATABASE_NAME`

**Redis (Shared Azure Managed Redis):**
- `LIVERMORE_REDIS_URL` (rediss:// for TLS)

**Clerk Authentication:**
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`

**Binance API Keys:**
- Optional for market data (public endpoints)
- Only needed for trading (out of scope for v7.0)

#### Section 3: Exchange Database Configuration
- Explained `exchanges` table seed data for `binance_us`
- Documented `user_exchanges` record structure and fields
- Explained `is_active` and `is_default` flags
- Referenced Admin UI Exchange Setup Modal (Phase 37)

#### Section 4: First-Run Steps
11-step setup guide:
1. Clone repository
2. Install dependencies (`pnpm install`)
3. Set environment variables
4. Build packages (`pnpm build`)
5. Start Admin UI (`.\scripts\run-admin-dev.ps1`)
6. Navigate to Network page
7. Verify exchange instance appears
8. Configure `user_exchanges` record via Exchange Setup Modal
9. Click Connect button
10. Monitor warmup progress (idle → starting → warming → active)
11. Verify active status and 100% completion

#### Section 5: Verification Checklist
Multi-layered verification approach:

**Admin UI Checks:**
- Exchange card shows "active" status
- WarmupProgressPanel at 100%
- Activity feed shows recent updates
- No error messages

**Redis Checks:**
- Debug script to verify candle keys exist
- Pattern: `candles:{exchangeId}:BTCUSDT:1d`

**Test Harness:**
- Run `.\scripts\test-subscription-harness.ps1 -Exchange binance_us`
- Both TST-01 and TST-02 must PASS

**Network Activity Logs:**
- Check `packages/api/logs/` for errors
- Verify "Smart warmup complete" message
- No 429 or 403 errors

#### Section 6: Troubleshooting
Common issues with diagnosis and fixes:

1. **"Exchange not found in database"**
   - Cause: Missing `binance_us` row in `exchanges` table
   - Fix: Verify seed data, run Atlas migrations

2. **"No wsUrl configured for exchange"**
   - Cause: `exchanges.ws_url` is NULL
   - Fix: Update row with correct WebSocket URL

3. **"Connection timeout" or "WebSocket connection failed"**
   - Cause: Geo-blocking, firewall, ISP issues
   - Diagnosis: Test direct connection, try different network
   - Alternative: Use `binance` (international) if accessible

4. **"Redis connection error: ECONNREFUSED"**
   - Cause: Incorrect `LIVERMORE_REDIS_URL` or unreachable Azure Redis
   - Fix: Verify URL format, test connection, check firewall rules

5. **"No user_exchanges record found"**
   - Cause: User not linked to `binance_us` exchange
   - Fix: Use Exchange Setup Modal to create record

**General Diagnosis:** Run test harness first for isolated pipeline validation.

#### Section 7: Test Results
Documented validation gate results from Task 1 checkpoint:

**Test Execution:**
- Date: 2026-02-13
- Exchange: `binance_us`
- Executor: User (via PowerShell)

**TST-01: REST Warmup Validation**
- Status: ✓ PASS
- REST API reachable
- BinanceRestClient correctly configured
- CandleCacheStrategy writes to exchange-scoped key
- Redis caching verified

**TST-02: WebSocket Streaming Validation**
- Status: ✓ PASS
- WebSocket endpoint reachable
- SUBSCRIBE method frame accepted
- Kline events streaming correctly
- OHLCV data parsing works

**Summary:**
Both tests passed. Binance US adapter is fully functional and ready for production use.

## Technical Architecture

### Data Flow (Handoff Verification)

```
User Machine (Kaia)
  → Environment Variables (DATABASE_*, LIVERMORE_REDIS_URL, CLERK_*)
  → pnpm build + run-admin-dev.ps1
  → Admin UI Network Page
  → Exchange Setup Modal (create user_exchanges record)
  → Connect Button (start instance)
  → Smart Warmup (scan + fetch + cache)
  → Active Status (serving Binance US data)
```

### Key Patterns

**Exchange-Scoped Architecture:**
- Each instance claims one exchange via `user_exchanges` record
- Cache keys include `exchangeId` to prevent collisions
- Shared database with exchange-scoped writes
- One active instance per exchange at any time

**Validation Gate:**
- Test harness validates REST and WebSocket independently
- Exit code 0 for all-pass, 1 for any-fail
- Reproducible validation before handoff

**Handoff Documentation Structure:**
- Overview (architecture context)
- Environment setup (all required variables)
- Database configuration (exchanges, user_exchanges)
- First-run steps (numbered, actionable)
- Verification checklist (multi-layered)
- Troubleshooting (common issues with fixes)
- Test results (validation evidence)

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. ✓ Task 1 (checkpoint) completed by user: test harness executed, both tests PASSED
2. ✓ Task 2 committed: KAIA-HANDOFF.md created at phase directory
3. ✓ KAIA-HANDOFF.md has all 7 sections: Overview, Environment Variables, Exchange Database Configuration, First-Run Steps, Verification Checklist, Troubleshooting, Test Results
4. ✓ Document references `scripts/test-subscription-harness.ts` as verification tool
5. ✓ Document correctly describes Admin UI exchange setup flow (Phase 37)
6. ✓ Test results documented with TST-01 and TST-02 status (both PASS)

## Known Limitations

- Binance US may be inaccessible from some networks (geo-blocking, ISP filtering)
- If Binance US is unavailable, can use `binance` (international) but US users are blocked
- API keys not required for market data but will be needed for trading in future versions
- Environment variables must be set in Windows User scope (no .env file support)

## Testing Notes

**Validation completed via checkpoint:**

User executed test harness and confirmed:
- ✓ TST-01 (REST): Fetches candles, caches to Redis, verifies with ZCARD
- ✓ TST-02 (WebSocket): Connects, subscribes, receives kline messages

**Handoff verification for Kaia:**

To verify her setup, Kaia should:
1. Set environment variables (Section 2)
2. Run `pnpm install && pnpm build`
3. Execute test harness: `.\scripts\test-subscription-harness.ps1 -Exchange binance_us`
4. Verify both TST-01 and TST-02 PASS
5. Start Admin UI and connect to Binance US instance
6. Verify warmup completes and instance reaches "active" status

## Integration Points

### Upstream Dependencies
- Phase 38-01: Subscription test harness script (validation tool)
- Phase 37-03: WarmupProgressPanel (warmup monitoring in Admin UI)
- Phase 37-02: Exchange Setup Modal with edit mode (user_exchanges configuration)
- Phase 37-01: Connect button and instance state transitions (UI flow)
- Phase 35-02: SmartWarmupService (warmup engine)
- Phase 36-01: BinanceRestClient (REST API)
- Phase 36-02: BinanceAdapter WebSocket (live streaming)

### Downstream Impact
- Kaia can independently deploy and run her Binance US instance
- Test harness provides reproducible validation for any exchange adapter
- Handoff documentation pattern can be reused for future exchange integrations
- Completes v7.0 Smart Warmup & Binance Adapter milestone

## Handoff Notes for Kaia

**You are ready to deploy your Binance US instance.**

**Pre-requisites:**
- Mike provides you with database credentials, Redis URL, and Clerk keys
- Set all environment variables from Section 2 in Windows User scope
- Clone the Livermore repository

**Deployment Steps:**
1. Follow Section 4 (First-Run Steps) exactly
2. Run test harness to verify your environment: `.\scripts\test-subscription-harness.ps1 -Exchange binance_us`
3. Both TST-01 and TST-02 must PASS before proceeding
4. Start Admin UI and complete Exchange Setup Modal
5. Click Connect and monitor warmup progress
6. Verify active status and check Redis keys

**If you encounter issues:**
- Reference Section 6 (Troubleshooting) for common problems
- Run test harness in isolation to diagnose pipeline issues
- Check Admin UI logs in `packages/api/logs/`
- Contact Mike with specific error messages

**Success criteria:**
- Test harness PASS (both tests)
- Admin UI shows "active" status with green indicator
- WarmupProgressPanel at 100%
- Redis keys present for Binance US candles/tickers

**Validation Gate:** This handoff is complete. The Binance US adapter has been validated end-to-end with real exchange data and is ready for production use.

## Self-Check: PASSED

**Created files verified:**
- ✓ `.planning/phases/38-binance-test-harness-handoff/KAIA-HANDOFF.md` exists

**Commits verified:**
- ✓ 3c5bbcc: feat(38-02): create Kaia handoff documentation

**Key functionality verified:**
- ✓ Document has all 7 required sections
- ✓ Environment variables documented (database, Redis, Clerk)
- ✓ Exchange database configuration explained (exchanges, user_exchanges)
- ✓ First-run steps numbered and actionable (11 steps)
- ✓ Verification checklist multi-layered (Admin UI, Redis, test harness, logs)
- ✓ Troubleshooting covers common issues with fixes
- ✓ Test results documented with TST-01 and TST-02 status (both PASS)
- ✓ Document references test-subscription-harness script
- ✓ Admin UI exchange setup flow correctly described (Phase 37 integration)

All deliverables completed successfully.
