---
phase: 17-settings-infrastructure
plan: 02
subsystem: api
tags: [trpc, settings, crud, jsonb, postgresql, clerk-auth]
dependency-graph:
  requires: [phase-17-01]
  provides: [settings-endpoints, settings-get, settings-update, settings-patch]
  affects: [phase-18, phase-21]
tech-stack:
  added: []
  patterns: [protectedProcedure, jsonb_set, atomic-partial-update]
key-files:
  created:
    - apps/api/src/routers/settings.router.ts
  modified:
    - apps/api/src/routers/index.ts
decisions:
  - id: combined-router-implementation
    choice: "Implement all three endpoints in single router file"
    reason: "All endpoints share same structure, imports, and patterns"
  - id: user-lookup-pattern
    choice: "Lookup user by Clerk identity before operations"
    reason: "Consistent with existing user.router.ts me() pattern"
  - id: patch-returns-settings
    choice: "Patch endpoint returns full settings after update"
    reason: "Client can verify update without additional request"
metrics:
  duration: "~14 minutes"
  completed: "2026-01-31"
---

# Phase 17 Plan 02: Settings tRPC Endpoints Summary

**One-liner:** Three protectedProcedure tRPC endpoints for settings CRUD using jsonb_set for atomic partial updates

## What Was Built

### API Layer
- Created `settings.router.ts` with three endpoints:
  - `settings.get` - Retrieve user settings (or default `{version: 1}`)
  - `settings.update` - Replace entire settings document
  - `settings.patch` - Atomic partial update via PostgreSQL `jsonb_set`

### Key Features
1. **Authentication**: All endpoints use `protectedProcedure` requiring Clerk JWT
2. **User Lookup**: Consistent pattern - lookup by `identityProvider='clerk'` + `identitySub=clerkId`
3. **Validation**: `UserSettingsSchema` for full updates, `UserSettingsPatchSchema` for patches
4. **Atomic Updates**: `jsonb_set` with `COALESCE(settings, '{}')` handles null settings
5. **Logging**: Debug/info logs at key points for observability

## Key Technical Decisions

### 1. Patch Endpoint Design
Uses PostgreSQL native `jsonb_set` instead of read-modify-write:
```typescript
await db.execute(sql`
  UPDATE users
  SET settings = jsonb_set(COALESCE(settings, '{}'), ${pathStr}::text[], ${valueJson}::jsonb, true),
      updated_at = NOW()
  WHERE id = ${user.id}
`);
```
The `true` parameter creates missing intermediate keys automatically.

### 2. Update vs Patch Distinction
- **update()**: Full document replacement - for import/reset scenarios
- **patch()**: Atomic path-based update - for UI changes to single fields

### 3. Error Handling
All endpoints throw `TRPCError` with `code: 'NOT_FOUND'` if user doesn't exist (not just return null).

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 3e1fa03 | feat | Add settings tRPC router with get/update/patch endpoints |

## Files Changed

### Created
- `apps/api/src/routers/settings.router.ts` - Complete settings router (181 lines)

### Modified
- `apps/api/src/routers/index.ts` - Added settingsRouter to appRouter

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All success criteria met:

- [x] settings.get returns user settings or default `{ version: 1 }`
- [x] settings.update replaces entire settings document with validation
- [x] settings.patch uses PostgreSQL jsonb_set for atomic partial updates
- [x] All endpoints use protectedProcedure (require Clerk auth)
- [x] All endpoints lookup user by Clerk identity (identityProvider + identitySub)
- [x] settingsRouter registered in appRouter
- [x] TypeScript compiles without errors (`pnpm --filter api build`)
- [x] Requirements SET-03, SET-04, SET-05 satisfied

## Requirements Satisfied

| Requirement | Description | Status |
|-------------|-------------|--------|
| SET-03 | Get user settings via tRPC | Done |
| SET-04 | Update (full replace) settings | Done |
| SET-05 | Patch (partial update) settings via jsonb_set | Done |

## Next Phase Readiness

**Immediately unblocked:**
- Plan 17-03 (if exists): Export/import endpoints
- Phase 18: Control channel can call settings.get for runtime config
- Phase 21: Admin UI can call all settings endpoints

**No blockers or concerns.**

---
*Completed: 2026-01-31 | Duration: ~14 minutes | Tasks: 3/3*
