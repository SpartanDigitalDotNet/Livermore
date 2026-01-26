# Phase 11: Database Workflow - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the database-first workflow: Atlas for schema deployment, Drizzle pull for TypeScript type generation. Create deployment scripts for local and Sandbox (Azure PostgreSQL) environments. Update ARCHITECTURE.md to document the workflow and ban Drizzle migrations.

</domain>

<decisions>
## Implementation Decisions

### Script output behavior
- Verbose output — show what's happening at each step
- Display connection target (with password masked)
- Show Atlas command output
- Show drizzle-kit pull output
- Clear success/failure messages

### Error handling
- Stop on failure — scripts exit with code 1 immediately on any error
- No partial execution or rollback attempts
- Error messages should be clear about what failed

### Environment variables
- PG_SANDBOX_HOST, PG_SANDBOX_USER, PG_SANDBOX_PASSWORD — Sandbox credentials
- DATABASE_HOST, DATABASE_PORT, DATABASE_LIVERMORE_USERNAME, DATABASE_LIVERMORE_PASSWORD, LIVERMORE_DATABASE_NAME — Local credentials
- Variables retrieved from Windows User environment at runtime (existing pattern from apply-schema.ps1)
- NOT stored in .env file

### Workflow separation
- `sync-schema.ps1` — Local only (Atlas apply + Drizzle pull)
- `apply-schema-sandbox.ps1` — Sandbox only (Atlas apply)
- Separate scripts, not combined — user chooses which environment to target

### Atlas configuration
- Add `sandbox` environment to `atlas.hcl`
- Use same diff protections as `local` env (skip drop_schema)
- Connection string built from PG_SANDBOX_* variables

### Claude's Discretion
- Exact output formatting (colors, separators)
- How to mask passwords in output
- Temp file handling if any

</decisions>

<specifics>
## Specific Ideas

- Follow the existing `apply-schema.ps1` pattern — it already loads env vars correctly
- Scripts should feel consistent with existing Livermore tooling

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-database-workflow*
*Context gathered: 2026-01-26*
