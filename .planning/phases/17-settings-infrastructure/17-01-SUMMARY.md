---
phase: 17-settings-infrastructure
plan: 01
subsystem: database
tags: [jsonb, zod, typescript, settings, user-data]
dependency-graph:
  requires: [phase-12-iam]
  provides: [user-settings-column, user-settings-schema]
  affects: [phase-17-02, phase-18, phase-21]
tech-stack:
  added: []
  patterns: [typed-jsonb, zod-schema-validation, schema-versioning]
key-files:
  created:
    - packages/schemas/src/settings/user-settings.schema.ts
  modified:
    - packages/database/schema.sql
    - packages/database/src/schema/users.ts
    - packages/schemas/src/index.ts
decisions:
  - id: symbols-optional
    choice: "Make symbols field optional instead of default"
    reason: "Allows {version:1} to be valid TypeScript type for Drizzle default"
metrics:
  duration: "~10 minutes"
  completed: "2026-01-31"
---

# Phase 17 Plan 01: Settings Column and Schema Summary

**One-liner:** JSONB settings column on users table with typed Zod schema for version-controlled user preferences

## What Was Built

### Database Layer
- Added `settings` JSONB column to `users` table in `schema.sql`
- Default value: `{"version":1}` for schema evolution support
- Added typed column in Drizzle schema using `$type<UserSettings>()`

### Schema Layer
- Created `user-settings.schema.ts` with complete settings structure
- Hierarchical schemas: ExchangeConfig, PerseusProfile, LoggingConfig, LivermoreRuntime
- Main `UserSettingsSchema` with version field for migrations
- `UserSettingsPatchSchema` for partial updates via `jsonb_set()`
- All TypeScript types exported from `@livermore/schemas`

## Key Technical Decisions

### 1. Version Field for Schema Evolution
Settings include `version: number` (default 1) enabling future migrations:
```typescript
function migrateSettings(raw: unknown): CurrentSettings {
  if (parsed.version === 1) {
    return { ...parsed, version: 2, newField: 'default' };
  }
  return parsed;
}
```

### 2. Optional Symbols Field
Changed `symbols: z.array(z.string()).default([])` to `.optional()` to allow `{version:1}` as valid default value in Drizzle schema.

### 3. Credential Storage Pattern
Exchange credentials stored as environment variable names, not actual secrets:
```typescript
exchanges: {
  coinbase: {
    enabled: true,
    ApiKeyEnvironmentVariableName: "COINBASE_API_KEY",
    SecretEnvironmentVariableName: "COINBASE_SECRET"
  }
}
```

## Commits

| Hash | Type | Description |
|------|------|-------------|
| da8530e | feat | Add settings JSONB column to users table |
| d68fe4e | feat | Create UserSettings Zod schema |

## Files Changed

### Created
- `packages/schemas/src/settings/user-settings.schema.ts` - Complete Zod schema

### Modified
- `packages/database/schema.sql` - Added settings column DDL
- `packages/database/src/schema/users.ts` - Added typed Drizzle column
- `packages/schemas/src/index.ts` - Added settings export

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript type mismatch with Drizzle default**
- **Found during:** Task 2 build verification
- **Issue:** `symbols: z.array(z.string()).default([])` creates a required field in inferred type, but Drizzle default is `{version:1}` which lacks `symbols`
- **Fix:** Changed to `.optional()` so minimal default is valid
- **Files modified:** `packages/schemas/src/settings/user-settings.schema.ts`
- **Commit:** Included in d68fe4e

## Verification Results

All success criteria met:

- [x] schema.sql has `settings jsonb DEFAULT '{"version":1}'::jsonb` column
- [x] users.ts has `settings: jsonb('settings').$type<UserSettings>()` with default
- [x] UserSettingsSchema validates version, exchanges, symbols, runtime config
- [x] UserSettingsPatchSchema validates path + value for PATCH operations
- [x] All packages compile without TypeScript errors (`pnpm build` successful)
- [x] Requirements SET-01 and SET-02 satisfied

## Requirements Satisfied

| Requirement | Description | Status |
|-------------|-------------|--------|
| SET-01 | Settings JSONB column on users table | Done |
| SET-02 | UserSettings Zod schema with validation | Done |

## Next Phase Readiness

**Immediately unblocked:**
- Plan 17-02: Settings tRPC endpoints (get/update/patch/export/import)

**Dependencies satisfied for:**
- Phase 18: Control channel can read settings for runtime config
- Phase 21: Admin UI can call settings endpoints

**No blockers or concerns.**

---
*Completed: 2026-01-31 | Duration: ~10 minutes | Tasks: 2/2*
