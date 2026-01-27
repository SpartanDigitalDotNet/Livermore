---
phase: 14-user-sync-webhooks
plan: 01
title: Webhook Handler with User Sync
subsystem: authentication
tags: [clerk, webhooks, svix, user-sync, fastify]
requires:
  - phase-12  # IAM Schema (users table columns)
  - phase-13  # Clerk Authentication (@clerk/fastify plugin)
provides:
  - Clerk webhook endpoint at /webhooks/clerk
  - User sync on user.created and user.updated events
  - Svix signature verification via verifyWebhook()
  - Idempotent user upsert (no duplicate rows)
affects:
  - phase-15  # Admin UI (will query synced users)
tech-stack:
  added: []  # No new packages - @clerk/fastify already installed
  patterns:
    - "Webhook route before auth middleware"
    - "Check-then-update for idempotent sync"
    - "verifyWebhook() for svix signature validation"
key-files:
  created:
    - apps/api/src/routes/webhooks/clerk.ts
  modified:
    - packages/schemas/src/env/config.schema.ts
    - packages/database/src/schema/users.ts
    - apps/api/src/server.ts
decisions:
  - id: webhook-before-plugin
    choice: "Register webhook route BEFORE clerkPlugin"
    rationale: "Webhook is server-to-server, has no JWT token; routes after clerkPlugin require JWT"
  - id: check-then-update
    choice: "Use check-then-update instead of onConflictDoUpdate"
    rationale: "Partial unique index on identity_provider/identity_sub doesn't work with Drizzle's onConflictDoUpdate; check-then-update achieves same idempotency"
  - id: timestamp-mode-string
    choice: "Set timestamp mode to 'string' in users schema"
    rationale: "Ensures ISO string compatibility with lastLoginAt field from Clerk webhook"
metrics:
  duration: "5 minutes"
  completed: "2026-01-27"
---

# Phase 14 Plan 01: Webhook Handler with User Sync Summary

**One-liner:** Clerk webhook at /webhooks/clerk with svix verification, syncs user.created/user.updated to PostgreSQL users table via idempotent check-then-upsert.

## What Was Built

### 1. Environment Configuration

Added `CLERK_WEBHOOK_SIGNING_SECRET` to EnvConfigSchema for webhook signature verification.

### 2. Users Schema Update

Updated `packages/database/src/schema/users.ts` to include IAM columns that match the database structure deployed in Phase 12:
- `identityProvider` - OAuth provider (e.g., 'clerk')
- `identitySub` - Provider's user ID
- `displayName` - User's display name
- `identityPictureUrl` - Profile picture URL
- `role` - User role (default: 'user')
- `lastLoginAt` - Last sign-in timestamp

Added partial unique index on `(identity_provider, identity_sub)` for OAuth identity lookup.

### 3. Webhook Handler

Created `apps/api/src/routes/webhooks/clerk.ts` with:
- `clerkWebhookHandler()` - Main handler function
- `verifyWebhook()` - Svix signature validation from @clerk/fastify/webhooks
- `syncUser()` - Idempotent user sync via check-then-update
- `getPrimaryEmail()` - Extract primary email from Clerk user data
- `generateUsername()` - Generate unique username from email

### 4. Route Registration

Modified `apps/api/src/server.ts` to register webhook route BEFORE clerkPlugin:
```typescript
// WEBHOOK ROUTE - must be registered BEFORE clerkPlugin
fastify.post('/webhooks/clerk', clerkWebhookHandler);

// Clerk plugin for JWT validation on other routes
await fastify.register(clerkPlugin);
```

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| cc295bc | feat | Add webhook env var and IAM columns to users schema |
| 766bedf | feat | Create Clerk webhook handler with user sync |

## Files Changed

| File | Change |
|------|--------|
| packages/schemas/src/env/config.schema.ts | Added CLERK_WEBHOOK_SIGNING_SECRET |
| packages/database/src/schema/users.ts | Added IAM columns + partial unique index |
| apps/api/src/routes/webhooks/clerk.ts | Created webhook handler |
| apps/api/src/server.ts | Registered webhook route before clerkPlugin |

## Deviations from Plan

None - plan executed exactly as written.

## Requirements Covered

- **AUTH-04:** Clerk webhook endpoint `/webhooks/clerk` syncs users on `user.created`
- **AUTH-05:** Clerk webhook syncs user data on `user.updated` events

## User Setup Required

Before webhooks will work, the user must:

1. **Set environment variable:**
   - `CLERK_WEBHOOK_SIGNING_SECRET` - From Clerk Dashboard after creating webhook endpoint

2. **Configure Clerk Dashboard:**
   - Go to: Clerk Dashboard -> Webhooks -> Add Endpoint
   - Set endpoint URL: `https://your-domain/webhooks/clerk`
   - Subscribe to events: `user.created`, `user.updated`
   - Copy the Signing Secret to environment variable

## Next Phase Readiness

**Phase 15 (Admin UI) can proceed:**
- Users table has all IAM columns for display
- Webhook sync ensures Clerk users exist in database
- No blockers identified
