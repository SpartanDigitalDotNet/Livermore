---
phase: 17-settings-infrastructure
plan: 03
subsystem: api
tags: [trpc, settings, export, import, backup, validation, zod]
dependency-graph:
  requires: [phase-17-02]
  provides: [settings-export, settings-import]
  affects: [phase-21]
tech-stack:
  added: []
  patterns: [export-envelope, zod-validation, metadata-wrapping]
key-files:
  created: []
  modified:
    - apps/api/src/routers/settings.router.ts
decisions:
  - id: export-envelope-format
    choice: "Export includes exportedAt timestamp and exportVersion"
    reason: "Enables user to identify when backup was created, future version handling"
  - id: import-accepts-envelope
    choice: "Import accepts full export format (extracts settings field)"
    reason: "User can import exported file directly without manual editing"
  - id: optional-metadata-on-import
    choice: "exportedAt and exportVersion optional in import schema"
    reason: "Allows both direct settings import and full export envelope import"
metrics:
  duration: "~4 minutes"
  completed: "2026-01-31"
---

# Phase 17 Plan 03: Settings Export/Import Summary

**One-liner:** Export endpoint returns settings with timestamp metadata, import validates via Zod and replaces settings atomically

## What Was Built

### API Layer
- Added two new endpoints to `settings.router.ts`:
  - `settings.export` - Returns settings wrapped in export envelope with metadata
  - `settings.import` - Accepts export format, validates settings, replaces user settings

### Export Endpoint (SET-06)
```typescript
export: protectedProcedure.query(async ({ ctx }) => {
  // Returns:
  return {
    exportedAt: new Date().toISOString(),  // When backup was created
    exportVersion: '1.0',                   // Export format version
    settings: user.settings ?? { version: 1 },
  };
});
```

### Import Endpoint (SET-07)
```typescript
import: protectedProcedure
  .input(z.object({
    settings: UserSettingsSchema,           // Validated against schema
    exportedAt: z.string().optional(),      // Allowed but ignored
    exportVersion: z.string().optional(),   // Allowed but ignored
  }))
  .mutation(async ({ ctx, input }) => {
    // Replaces entire settings with input.settings
  });
```

## Key Technical Decisions

### 1. Export Envelope Format
Export includes metadata for user convenience:
- `exportedAt`: ISO timestamp of when export was created
- `exportVersion`: Format version for future compatibility
- `settings`: The actual settings data

### 2. Import Accepts Full Envelope
Import schema allows the optional metadata fields so users can import an exported file directly without editing. The metadata is accepted but ignored - only `settings` is extracted and saved.

### 3. Validation Flow
- Zod validation via `.input()` happens automatically
- Invalid JSON structure returns Zod validation errors
- User not found returns TRPCError NOT_FOUND
- Database errors bubble up as 500

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 9568c6c | feat | Add settings export and import endpoints |

## Files Changed

### Modified
- `apps/api/src/routers/settings.router.ts` - Added export and import endpoints (+104 lines)

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All success criteria met:

- [x] settings.export returns settings with exportedAt timestamp and exportVersion
- [x] settings.import accepts settings object and validates with UserSettingsSchema
- [x] Invalid import data rejected with clear Zod validation errors (automatic via .input())
- [x] Both endpoints use protectedProcedure
- [x] Import replaces entire settings (like update, but semantically for import)
- [x] TypeScript compiles without errors (`pnpm --filter api build`)
- [x] Requirements SET-06 and SET-07 satisfied

## Requirements Satisfied

| Requirement | Description | Status |
|-------------|-------------|--------|
| SET-06 | Export user settings as downloadable JSON with metadata | Done |
| SET-07 | Import settings from JSON with validation | Done |

## Next Phase Readiness

**Phase 17 Complete**

All settings infrastructure requirements (SET-01 through SET-07) now satisfied:
- SET-01, SET-02: Settings column and schema (17-01)
- SET-03, SET-04, SET-05: Get/update/patch endpoints (17-02)
- SET-06, SET-07: Export/import endpoints (17-03)

**Immediately unblocked:**
- Phase 18: Control Channel Foundation
- Phase 21: Admin UI can implement settings backup/restore UI

**No blockers or concerns.**

---
*Completed: 2026-01-31 | Duration: ~4 minutes | Tasks: 2/2*
