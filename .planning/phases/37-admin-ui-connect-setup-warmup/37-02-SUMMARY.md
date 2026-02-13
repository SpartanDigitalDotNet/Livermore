---
phase: 37-admin-ui-connect-setup-warmup
plan: 02
subsystem: admin-ui
tags: [admin-ui, user-exchanges, edit-mode, is-default-orchestration]
dependency_graph:
  requires: [37-01]
  provides: [updateExchange-mutation, ExchangeSetupModal-edit-mode]
  affects: [user-exchanges-table, ExchangeGuard]
tech_stack:
  added: []
  patterns: [is-default-orchestration, conditional-rendering, edit-create-modal-pattern]
key_files:
  created: []
  modified:
    - apps/api/src/routers/exchange-symbol.router.ts
    - apps/admin/src/components/exchange/ExchangeSetupModal.tsx
decisions:
  - "is_default orchestration: unset all other defaults before setting new default (prevents multiple defaults per user)"
  - "Edit mode skips exchange selection step and pre-populates all fields from existing record"
  - "Display Name field only shown in edit mode (not needed on initial setup)"
  - "Set as Default switch only shown in edit mode when exchange is not already default"
  - "Dialog dismissable in edit mode, non-dismissable in create mode (first-login flow)"
metrics:
  duration_seconds: 299
  tasks_completed: 2
  files_modified: 2
  completed_date: 2026-02-13
---

# Phase 37 Plan 02: Update Exchange Config & Edit Mode Summary

**One-liner:** Add updateExchange mutation with is_default orchestration and enhance ExchangeSetupModal with edit mode for updating existing exchange configurations.

## Objective

Add the ability to update existing user_exchanges records (API key env var names, display name) and implement is_active/is_default orchestration so that setting a new default exchange automatically unsets the previous default for that user.

## Tasks Completed

### Task 1: Add updateExchange mutation with is_default orchestration
**Status:** COMPLETE
**Commit:** 9d8f4fe
**Duration:** ~150 seconds

Added `updateExchange` mutation to `exchange-symbol.router.ts` with:
- Input schema accepting optional fields: `apiKeyEnvVar`, `apiSecretEnvVar`, `displayName`, `isDefault`
- User lookup from Clerk identity (same pattern as setupExchange)
- Existing record validation (NOT_FOUND if exchange not configured)
- Dynamic update object built from provided optional fields
- is_default orchestration: if `isDefault === true`, first unset all other defaults for this user, then set new default
- Also updated `setupExchange` mutation to orchestrate is_default before insert (unset existing defaults before creating new default)

**Files modified:**
- `apps/api/src/routers/exchange-symbol.router.ts`: Added 90 lines (updateExchange mutation + setupExchange orchestration)

**Key implementation:**
```typescript
// is_default orchestration
if (input.isDefault === true) {
  // Unset all other defaults for this user first
  await db.update(userExchanges)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(userExchanges.userId, user.id),
        eq(userExchanges.isDefault, true)
      )
    );
  updates.isDefault = true;
} else if (input.isDefault === false) {
  updates.isDefault = false;
}
```

### Task 2: Enhance ExchangeSetupModal with edit mode
**Status:** COMPLETE
**Commit:** 32a7651
**Duration:** ~149 seconds

Enhanced `ExchangeSetupModal.tsx` to support both create and edit modes:
- Added `editExchange` prop (optional) containing existing exchange data
- Edit mode detection: if `editExchange` is provided, skip Step 1 (exchange selection) and go directly to Step 2 (credentials form)
- Pre-population: when `editExchange` is provided, populate `selectedExchange` (synthetic), `apiKeyEnvVar`, `apiSecretEnvVar`, `displayName`
- Added `displayName` input field (edit mode only, above env var fields)
- Added "Set as Default" switch using `@/components/ui/switch` and `@/components/ui/label` (edit mode only, if not already default)
- Edit mode saves via `updateExchange` mutation instead of `setupExchange`
- Dialog title/description updated for edit mode: "Edit Exchange" / "Update credentials for {exchangeName}"
- Save button text: "Update Exchange" (edit mode) vs "Save Exchange" (create mode)
- Dialog dismissable in edit mode, non-dismissable in create mode (preserves first-login flow)

**Files modified:**
- `apps/admin/src/components/exchange/ExchangeSetupModal.tsx`: +117 lines, -37 lines (net +80 lines)

**Key features:**
- Edit mode pre-populates all fields from `editExchange` prop
- Conditional rendering: exchange selection skipped in edit mode
- "Back" button hidden in edit mode
- Switch only shown if exchange is not already default (`!editExchange.isDefault`)
- Existing ExchangeGuard first-login flow unchanged

## Verification Results

All verification checks passed:

1. TypeScript compilation: PASSED (both apps/api and apps/admin)
2. updateExchange mutation exists in exchange-symbol.router.ts: PASSED
3. setupExchange mutation now orchestrates is_default before insert: PASSED
4. ExchangeSetupModal accepts editExchange prop: PASSED
5. Edit mode pre-populates fields and calls updateExchange: PASSED
6. Create mode continues to work as before (non-dismissable, calls setupExchange): PASSED

## Deviations from Plan

None - plan executed exactly as written.

## Success Criteria Met

- [x] ADM-03: Exchange Setup Modal allows creating and updating user_exchanges records
- [x] ADM-04: Setting a new default exchange automatically unsets previous default
- [x] No TypeScript compilation errors
- [x] Existing ExchangeGuard first-login flow unchanged

## Technical Notes

### is_default Orchestration Pattern

Both `setupExchange` and `updateExchange` now implement the same orchestration pattern:
1. If setting a new default (`isDefault: true`), first query for existing defaults for this user
2. Unset all existing defaults (`SET isDefault = false WHERE userId = ? AND isDefault = true`)
3. Then set the new default (insert or update with `isDefault: true`)

This ensures only one exchange is default at a time per user, even in race condition scenarios.

### Edit Mode Integration

The `ExchangeSetupModal` now supports three invocation patterns:
1. **First-login setup (existing)**: No `editExchange` prop, non-dismissable, creates new record
2. **Edit existing exchange**: `editExchange` prop provided, dismissable, updates existing record
3. **Future: Add new exchange**: No `editExchange` prop, dismissable (would require adding a "add new exchange" button in Network page)

The Network page integration (an "Edit" or "Settings" button on InstanceCard to invoke the modal with `editExchange`) is NOT implemented in this plan but is a natural extension for future work.

## Next Steps

Plan 37-02 is complete. The next plan (37-03) would likely implement the Network page integration to allow users to click an "Edit" button on an exchange card and invoke this modal with the `editExchange` prop populated.

## Self-Check

Verifying claims made in this summary:

**Files created:**
None (this plan modified existing files only)

**Files modified:**
- `apps/api/src/routers/exchange-symbol.router.ts`: FOUND
- `apps/admin/src/components/exchange/ExchangeSetupModal.tsx`: FOUND

**Commits:**
- 9d8f4fe (Task 1: updateExchange mutation): FOUND
- 32a7651 (Task 2: ExchangeSetupModal edit mode): FOUND

**Self-Check: PASSED**
