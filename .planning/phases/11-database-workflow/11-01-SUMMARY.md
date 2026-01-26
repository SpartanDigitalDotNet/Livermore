---
phase: 11-database-workflow
plan: 01
subsystem: database
tags: [atlas, postgresql, azure, configuration]

dependency_graph:
  requires: []
  provides:
    - "Atlas sandbox environment configuration"
    - "PG_SANDBOX_* variable integration"
  affects:
    - "11-02 (sandbox deployment script uses --env sandbox)"

tech_stack:
  added: []
  patterns:
    - "Environment-based Atlas configuration"
    - "SSL-required cloud database connections"

file_tracking:
  key_files:
    modified:
      - packages/database/atlas.hcl

decisions:
  - id: "sandbox-ssl"
    choice: "sslmode=require for Azure PostgreSQL"
    reason: "Azure PostgreSQL enforces SSL connections"
  - id: "drop-protection"
    choice: "skip drop_schema (same as local, less strict than production)"
    reason: "Sandbox is for testing, need flexibility while protecting against accidental drops"

metrics:
  duration: "4 minutes"
  completed: "2026-01-26"
---

# Phase 11 Plan 01: Add Sandbox Environment to Atlas Summary

**One-liner:** Atlas configuration extended with sandbox environment using PG_SANDBOX_* variables, SSL enabled, and drop_schema protection.

## What Was Done

Added sandbox environment to `atlas.hcl` for Azure PostgreSQL deployment.

### Changes Made

1. **Added three new variable blocks** (lines 9-22):
   - `pg_sandbox_host` - from `getenv("PG_SANDBOX_HOST")`
   - `pg_sandbox_user` - from `getenv("PG_SANDBOX_USER")`
   - `pg_sandbox_password` - from `getenv("PG_SANDBOX_PASSWORD")`

2. **Added sandbox environment block** (lines 59-75):
   - `src = "file://schema.sql"` - same source of truth as other envs
   - Connection URL built from variables with `sslmode=require`
   - `schemas = ["public"]`
   - `diff { skip { drop_schema = true } }` - same protection as local

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SSL mode | `sslmode=require` | Azure PostgreSQL requires SSL for all connections |
| Drop protection | Skip `drop_schema` only | Same as local; sandbox needs flexibility but prevents accidental schema drops |
| Port | Hardcoded 5432 | Standard PostgreSQL port, Azure uses this default |

## Verification

- [x] `atlas.exe schema fmt atlas.hcl` - config is valid HCL
- [x] `atlas.exe schema inspect --env sandbox` - environment recognized (fails on connection as expected without credentials)
- [x] Variables use `getenv()` for all three PG_SANDBOX_* variables
- [x] URL includes `sslmode=require`
- [x] Diff policy skips `drop_schema`

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 2ace5e3 | feat | Add sandbox environment to Atlas configuration |

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

**Ready for Plan 11-02:** The sandbox environment is now configured. The deployment script (Plan 11-02) can use `atlas schema apply --env sandbox` to target Azure PostgreSQL.

**Required before use:** Set environment variables:
- `PG_SANDBOX_HOST` - Azure PostgreSQL hostname
- `PG_SANDBOX_USER` - Database username
- `PG_SANDBOX_PASSWORD` - Database password

---

*Generated: 2026-01-26T22:53:26Z*
