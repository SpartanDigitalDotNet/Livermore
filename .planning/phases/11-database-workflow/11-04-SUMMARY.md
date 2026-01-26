---
phase: 11-database-workflow
plan: 04
subsystem: documentation
tags: [architecture, atlas, drizzle, documentation, workflow]

dependency-graph:
  requires: [11-01-atlas-hcl-sandbox, 11-02-sandbox-script, 11-03-local-sync-script]
  provides: [database-workflow-documentation]
  affects: [developer-onboarding, future-schema-changes]

tech-stack:
  added: []
  patterns: [documentation-driven-workflow, anti-pattern-listing]

key-files:
  created: []
  modified:
    - .planning/codebase/ARCHITECTURE.md

decisions:
  - id: "11-04-D1"
    summary: "Include legacy apply-schema.ps1 in scripts table for completeness"
    why: "Existing script still works, documented for reference alongside new scripts"

metrics:
  duration: "2 minutes"
  completed: "2026-01-26"
---

# Phase 11 Plan 04: ARCHITECTURE.md Database Workflow Documentation Summary

Added comprehensive Database Workflow section to ARCHITECTURE.md documenting Atlas-only migrations, banning Drizzle migrations, and listing deployment scripts for local and sandbox environments.

## What Was Built

### ARCHITECTURE.md Updates

**Database Layer Section (lines 32-38):**
Updated to reflect Atlas for schema management, Drizzle for types only:
- Schema source of truth is now `schema.sql`
- Explicitly states "Schema management: Atlas (NOT Drizzle migrations)"

**Database Schema Management Entry Point (lines 111-114):**
Changed from `migrate.ts` and `drizzle-kit` to:
- Location: `packages/database/schema.sql` (source of truth)
- Triggers: `sync-schema.ps1` (local), `apply-schema-sandbox.ps1` (Azure)

**New Database Workflow Section (lines 126-180):**
Complete workflow documentation including:

1. **Why Atlas, Not Drizzle Table** - Comparison of schema source of truth, migration style, diff generation, and production safety

2. **Schema Change Workflow** - Step-by-step instructions:
   - Edit `schema.sql`
   - Run `sync-schema.ps1` for local (Atlas + Drizzle pull)
   - Run `apply-schema-sandbox.ps1` for Azure (Atlas only)

3. **Scripts Table** - Documents all three scripts:
   | Script | Environment | Actions |
   |--------|-------------|---------|
   | `sync-schema.ps1` | Local | Atlas apply + Drizzle pull |
   | `apply-schema-sandbox.ps1` | Azure Sandbox | Atlas apply only |
   | `apply-schema.ps1` | Local | Atlas apply only (legacy) |

4. **Environment Variables** - Lists required variables for local and sandbox

5. **Atlas Configuration** - Documents three environments in `atlas.hcl`

6. **Anti-Patterns (DO NOT)** - Explicit list of banned operations:
   - DO NOT use `drizzle-kit push` or `drizzle-kit generate`
   - DO NOT create migration files in `packages/database/migrations/`
   - DO NOT edit generated files in `packages/database/src/schema/`
   - DO edit only `schema.sql` for schema changes

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update ARCHITECTURE.md with database workflow | 4a40775 | .planning/codebase/ARCHITECTURE.md |

## Verification Results

- [x] "Drizzle migrations are BANNED" is explicitly stated
- [x] Schema change workflow is documented (edit schema.sql -> run script)
- [x] Both scripts (sync-schema.ps1, apply-schema-sandbox.ps1) are documented
- [x] Environment variables for both local and sandbox are listed
- [x] Anti-patterns section lists what NOT to do
- [x] Database Layer section updated to reflect Atlas, not Drizzle migrations

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 11-04-D1 | Include legacy apply-schema.ps1 in scripts table | Existing script still works, documented for reference alongside new scripts |

## Next Phase Readiness

**Blockers:** None

Phase 11 (Database Workflow) is now complete. All four plans delivered:
- 11-01: Atlas HCL sandbox environment configuration
- 11-02: Sandbox schema deployment script
- 11-03: Local sync schema script
- 11-04: ARCHITECTURE.md documentation

**Ready for Phase 12 (IAM Schema):**
- Database workflow is documented for future schema changes
- Scripts are ready for IAM table migrations
- Atlas will handle schema deployment to local and sandbox

---

*Plan completed: 2026-01-26*
*Duration: 2 minutes*
