---
status: complete
phase: 43-runtime-modes
source: 43-01-SUMMARY.md, 43-02-SUMMARY.md
started: 2026-02-19T20:00:00Z
updated: 2026-02-19T22:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. pw-host mode starts without exchange env vars
expected: Set LIVERMORE_MODE=pw-host and start the server WITHOUT Coinbase API keys, Clerk keys, or Discord webhook env vars. Server should start successfully, bind to API_HOST:API_PORT, and log mode: 'pw-host'.
result: pass

### 2. pw-host health endpoint
expected: GET /health returns JSON with mode: 'pw-host', status: 'ok', and services showing database: 'connected' and redis: 'connected'. No exchange or Discord status fields.
result: pass

### 3. pw-host serves public API routes
expected: GET /public/v1/exchanges returns exchange metadata from database. GET /public/v1/candles/:exchange/:symbol/:timeframe returns candle data from Redis cache. Public API works identically to exchange mode.
result: pass

### 4. Exchange mode unchanged (no LIVERMORE_MODE set)
expected: Without LIVERMORE_MODE env var, server starts with full exchange pipeline as before — Clerk, tRPC, exchange adapter, indicators, alerts, Discord all initialize normally. Zero behavioral regression.
result: pass

### 5. Exchange health shows mode field
expected: In exchange mode, GET /health returns mode: 'exchange' alongside existing service status (database, redis, discord, exchange connection state).
result: pass

### 6. Invalid mode rejected at startup
expected: Set LIVERMORE_MODE=invalid-mode and start server. Should throw error: "Invalid LIVERMORE_MODE: 'invalid-mode'. Must be 'exchange' or 'pw-host'." and exit.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
