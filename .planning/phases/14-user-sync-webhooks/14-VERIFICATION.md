---
phase: 14-user-sync-webhooks
verified: 2026-01-26T23:20:45-06:00
status: passed
score: 4/4 must-haves verified
---

# Phase 14: User Sync Webhooks Verification Report

**Phase Goal:** Clerk user events automatically sync to PostgreSQL users table
**Verified:** 2026-01-26T23:20:45-06:00
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New Clerk user triggers webhook, creates row in users table with OAuth fields populated | VERIFIED | `syncUser()` in clerk.ts inserts with identityProvider='clerk', identitySub, displayName, identityPictureUrl (lines 92-106) |
| 2 | Updated Clerk user triggers webhook, updates corresponding users row | VERIFIED | `syncUser()` uses check-then-update pattern; updates email, displayName, identityPictureUrl, lastLoginAt (lines 74-89) |
| 3 | Webhook rejects requests with invalid svix signature (400) | VERIFIED | `verifyWebhook(request)` called in try block; catch returns 400 with error (lines 119, 133-135) |
| 4 | Duplicate webhooks for same user are idempotent (no duplicate rows, no errors) | VERIFIED | Check by identityProvider+identitySub before insert; existing users get UPDATE not INSERT (lines 63-72) |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/schemas/src/env/config.schema.ts` | CLERK_WEBHOOK_SIGNING_SECRET validation | VERIFIED | Line 39: `z.string().min(1, 'Clerk webhook signing secret is required')` |
| `packages/database/src/schema/users.ts` | Users table with IAM columns | VERIFIED | Lines 16-21: identityProvider, identitySub, displayName, identityPictureUrl, role, lastLoginAt |
| `apps/api/src/routes/webhooks/clerk.ts` | Webhook handler with signature verification | VERIFIED | 137 lines; exports `clerkWebhookHandler`; uses `verifyWebhook` from @clerk/fastify/webhooks |
| `apps/api/src/server.ts` | Route registration before clerkPlugin | VERIFIED | Line 168: webhook route; Line 172: clerkPlugin registration (correct order) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| clerk.ts | @clerk/fastify/webhooks | verifyWebhook import | WIRED | Line 1: `import { verifyWebhook, type WebhookEvent } from '@clerk/fastify/webhooks'` |
| clerk.ts | @livermore/database | getDbClient + users | WIRED | Line 3: `import { getDbClient, users } from '@livermore/database'`; used in syncUser() |
| server.ts | clerk.ts | route registration | WIRED | Line 18: import; Line 168: `fastify.post('/webhooks/clerk', clerkWebhookHandler)` |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| AUTH-04: Clerk webhook endpoint `/webhooks/clerk` syncs users on `user.created` | SATISFIED | switch case handles 'user.created' (line 124), calls syncUser() |
| AUTH-05: Clerk webhook syncs user data on `user.updated` events | SATISFIED | switch case handles 'user.updated' (line 125), calls syncUser() |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No stub patterns found |

### Human Verification Required

#### 1. End-to-End Webhook Test

**Test:** Trigger a real webhook from Clerk (create/update user in Clerk Dashboard)
**Expected:** Row appears/updates in PostgreSQL users table with correct OAuth fields
**Why human:** Requires Clerk Dashboard access and CLERK_WEBHOOK_SIGNING_SECRET configured

#### 2. Signature Rejection Test

**Test:** Send POST to /webhooks/clerk with missing/invalid svix headers
**Expected:** 400 response with `{ error: 'Webhook verification failed' }`
**Why human:** Requires running server and making HTTP request

### Gaps Summary

No gaps found. All must-haves verified:

1. **ENV Config:** CLERK_WEBHOOK_SIGNING_SECRET added to schema validation
2. **Users Schema:** IAM columns present (identityProvider, identitySub, displayName, identityPictureUrl, role, lastLoginAt)
3. **Webhook Handler:** Substantive implementation (137 lines) with verifyWebhook(), syncUser(), error handling
4. **Route Registration:** Webhook route at line 168 BEFORE clerkPlugin at line 172 (critical for bypassing JWT auth)

The phase goal "Clerk user events automatically sync to PostgreSQL users table" is achievable with the implemented code.

---

_Verified: 2026-01-26T23:20:45-06:00_
_Verifier: Claude (gsd-verifier)_
