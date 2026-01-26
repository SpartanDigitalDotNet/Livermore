---
phase: 11-database-workflow
plan: 03
subsystem: database
tags: [powershell, atlas, drizzle, postgresql, workflow]

dependency-graph:
  requires: [atlas.hcl-local-env]
  provides: [local-schema-sync-script]
  affects: [local-development-workflow]

tech-stack:
  added: []
  patterns: [combined-workflow-script, two-step-execution]

key-files:
  created:
    - scripts/sync-schema.ps1
  modified: []

decisions:
  - id: "11-03-D1"
    summary: "Use try/finally to restore working directory after execution"
    why: "Ensures script doesn't leave user in unexpected directory on success or failure"

metrics:
  duration: "3 minutes"
  completed: "2026-01-26"
---

# Phase 11 Plan 03: Local Schema Sync Script Summary

PowerShell script combining Atlas apply and Drizzle pull for one-command local schema sync with env var validation, password masking, and sequential error handling.

## What Was Built

### scripts/sync-schema.ps1

One-command local development workflow for schema changes:

```powershell
powershell -File scripts/sync-schema.ps1
```

**Features:**
- Loads `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_LIVERMORE_USERNAME`, `DATABASE_LIVERMORE_PASSWORD`, `LIVERMORE_DATABASE_NAME` from Windows User environment
- Validates all five variables present (exits 1 with clear error message if missing)
- Builds connection URL with `sslmode=disable` for local PostgreSQL
- Step 1: Runs `atlas.exe schema apply --env local --auto-approve`
- Step 2: Runs `pnpm drizzle-kit pull` to regenerate TypeScript types
- Exits with code 1 on any failure (doesn't continue to Step 2 if Step 1 fails)
- Displays verbose output with masked password throughout

**Output example:**
```
=== Local Schema Sync ===

=== Step 1: Applying Schema via Atlas ===

Target: postgresql://Livermore:****@localhost:5432/Livermore

Schema is synced, no changes to be made

Atlas apply completed

=== Step 2: Regenerating Drizzle Types ===

[drizzle-kit pull output]

Drizzle types regenerated

=== Schema Sync Complete ===

- Schema applied to local PostgreSQL
- Drizzle types regenerated in packages/database/drizzle
```

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create sync-schema.ps1 script | 4d8a7a7 | scripts/sync-schema.ps1 |

## Verification Results

- [x] Script loads local DATABASE_* variables from Windows User environment
- [x] Script validates all required variables present
- [x] Password is masked in output (shows **** not actual password)
- [x] Script runs Atlas apply with --env local first
- [x] Script runs drizzle-kit pull second
- [x] Script exits with code 1 if Atlas fails (doesn't continue to Drizzle)
- [x] Script exits with code 1 if Drizzle fails
- [x] Final output summarizes what was done

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 11-03-D1 | Use try/finally to restore working directory | Ensures script doesn't leave user in unexpected directory on success or failure |

## Next Phase Readiness

**Blockers:** None

**Prerequisites for using this script:**
1. Local PostgreSQL must be running
2. `atlas.hcl` must have a `local` environment configured (existing)
3. Database credentials must be set in Windows User environment:
   ```powershell
   [Environment]::SetEnvironmentVariable("DATABASE_HOST", "localhost", "User")
   [Environment]::SetEnvironmentVariable("DATABASE_PORT", "5432", "User")
   [Environment]::SetEnvironmentVariable("DATABASE_LIVERMORE_USERNAME", "your-username", "User")
   [Environment]::SetEnvironmentVariable("DATABASE_LIVERMORE_PASSWORD", "your-password", "User")
   [Environment]::SetEnvironmentVariable("LIVERMORE_DATABASE_NAME", "your-database", "User")
   ```

---

*Plan completed: 2026-01-26*
*Duration: 3 minutes*
