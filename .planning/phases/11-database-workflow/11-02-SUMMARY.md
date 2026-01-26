---
phase: 11-database-workflow
plan: 02
subsystem: database
tags: [powershell, atlas, azure, postgresql, deployment]

dependency-graph:
  requires: [atlas.hcl-sandbox-env]
  provides: [sandbox-schema-deployment-script]
  affects: [phase-12-iam-schema]

tech-stack:
  added: []
  patterns: [windows-env-var-loading, verbose-output-with-masking]

key-files:
  created:
    - scripts/apply-schema-sandbox.ps1
  modified: []

decisions:
  - id: "11-02-D1"
    summary: "Use try/finally to restore working directory after atlas execution"
    why: "Ensures script doesn't leave user in unexpected directory on success or failure"

metrics:
  duration: "2 minutes"
  completed: "2026-01-26"
---

# Phase 11 Plan 02: Sandbox Schema Deployment Script Summary

PowerShell script for deploying Atlas schema to Azure PostgreSQL Sandbox with env var validation, password masking, and proper error handling.

## What Was Built

### scripts/apply-schema-sandbox.ps1

One-command schema deployment to Azure PostgreSQL Sandbox:

```powershell
powershell -File scripts/apply-schema-sandbox.ps1
```

**Features:**
- Loads `PG_SANDBOX_HOST`, `PG_SANDBOX_USER`, `PG_SANDBOX_PASSWORD` from Windows User environment
- Validates all three variables present (exits 1 with clear error message if missing)
- Builds connection URL with `sslmode=require` for Azure
- Displays verbose output: target (with masked password), atlas progress, success/failure
- Runs `atlas.exe schema apply --env sandbox --auto-approve`
- Exits with code 1 on any failure

**Output example:**
```
=== Deploying Schema to Sandbox ===
Target: postgresql://admin:****@example.postgres.database.azure.com:5432/livermore

Running Atlas schema apply...
[atlas output]

=== Schema deployed successfully ===
```

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create apply-schema-sandbox.ps1 script | af67cac | scripts/apply-schema-sandbox.ps1 |

## Verification Results

- [x] Script loads PG_SANDBOX_* from Windows User environment
- [x] Script validates all required variables present
- [x] Password is masked in output (shows **** not actual password)
- [x] Script uses --env sandbox flag with atlas.exe
- [x] Script exits with code 1 on atlas failure
- [x] SSL mode is require (not disable)

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 11-02-D1 | Use try/finally to restore working directory | Ensures script doesn't leave user in unexpected directory on success or failure |

## Next Phase Readiness

**Blockers:** None

**Prerequisites for using this script:**
1. `atlas.hcl` must have a `sandbox` environment configured (Plan 11-01)
2. Azure PostgreSQL credentials must be set in Windows User environment:
   ```powershell
   [Environment]::SetEnvironmentVariable("PG_SANDBOX_HOST", "your-host.postgres.database.azure.com", "User")
   [Environment]::SetEnvironmentVariable("PG_SANDBOX_USER", "your-username", "User")
   [Environment]::SetEnvironmentVariable("PG_SANDBOX_PASSWORD", "your-password", "User")
   ```

---

*Plan completed: 2026-01-26*
*Duration: 2 minutes*
