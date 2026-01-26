# Roadmap: v3.0 Admin UI + IAM Foundation

**Milestone:** v3.0
**Created:** 2026-01-26
**Depth:** Standard
**Starting Phase:** 11 (continues from v2.0 which ended at Phase 10)

## Overview

Establishes the database-first workflow with Atlas migrations, extends the users table for OAuth identity management, integrates Clerk authentication for the admin UI, and builds monitoring dashboards for MACD-V portfolio analysis, logs, and trade signals. Concludes with handoff documentation for Kaia's PerseusWeb development.

## Phases

---

### Phase 11: Database Workflow

**Goal:** Developers can deploy schema changes to Sandbox via a single command

**Dependencies:** None (foundation phase)

**Plans:** 4 plans

Plans:
- [ ] 11-01-PLAN.md - Atlas sandbox environment configuration
- [ ] 11-02-PLAN.md - apply-schema-sandbox.ps1 script
- [ ] 11-03-PLAN.md - sync-schema.ps1 script
- [ ] 11-04-PLAN.md - ARCHITECTURE.md documentation update

**Requirements:**
- DB-01: Atlas `sandbox` environment configured in `atlas.hcl` with PG_SANDBOX_* variables
- DB-02: `apply-schema-sandbox.ps1` script deploys schema to Azure PostgreSQL (Sandbox)
- DB-03: `sync-schema.ps1` runs Atlas apply then Drizzle pull (single command workflow)
- DB-04: ARCHITECTURE.md updated to reflect Atlas-only migrations (Drizzle migrations banned)

**Success Criteria:**
1. Developer can run `sync-schema.ps1` and see schema applied to local database with Drizzle types regenerated
2. Developer can run `apply-schema-sandbox.ps1` and see schema applied to Azure PostgreSQL Sandbox
3. ARCHITECTURE.md clearly states Drizzle migrations are banned and explains the Atlas-first workflow
4. Both scripts exit with error code 1 on failure (proper error handling)

---

### Phase 12: IAM Schema

**Goal:** Users table supports OAuth identity storage and role-based access

**Dependencies:** Phase 11 (needs deployment scripts to apply schema)

**Requirements:**
- IAM-01: Users table extended with `identity_provider` VARCHAR(20)
- IAM-02: Users table extended with `identity_sub` VARCHAR(255)
- IAM-03: Users table extended with `display_name` VARCHAR(100)
- IAM-04: Users table extended with `identity_picture_url` TEXT
- IAM-05: Users table extended with `role` VARCHAR(20) DEFAULT 'user'
- IAM-06: Users table extended with `last_login_at` TIMESTAMP

**Success Criteria:**
1. User record can store Google OAuth identity (provider, sub, display name, picture URL)
2. User role can be queried for authorization decisions (admin, user, subscriber_basic, subscriber_pro)
3. Last login timestamp updates when user authenticates
4. Schema deployed to both local PostgreSQL and Azure Sandbox
5. Drizzle types reflect new columns (TypeScript can access `user.identity_provider`, etc.)

---

### Phase 13: Clerk Authentication

**Goal:** Fastify server validates Clerk tokens and tRPC procedures can require authentication

**Dependencies:** Phase 12 (IAM columns exist for user sync)

**Requirements:**
- AUTH-01: `@clerk/fastify` plugin registered in Fastify server (import order: dotenv first)
- AUTH-02: tRPC context includes auth object from `getAuth(req)`
- AUTH-03: `protectedProcedure` middleware created, checks `ctx.auth.userId`

**Success Criteria:**
1. Unauthenticated request to protected procedure returns 401 UNAUTHORIZED
2. Request with valid Clerk Bearer token to protected procedure succeeds
3. `ctx.auth.userId` is available as string (not null) in protected procedure handlers
4. Server starts without Clerk initialization errors (correct import order verified)

---

### Phase 14: User Sync Webhooks

**Goal:** Clerk user events automatically sync to PostgreSQL users table

**Dependencies:** Phase 13 (Clerk plugin registered, IAM columns exist)

**Requirements:**
- AUTH-04: Clerk webhook endpoint `/webhooks/clerk` syncs users on `user.created`
- AUTH-05: Clerk webhook syncs user data on `user.updated` events

**Success Criteria:**
1. New Clerk user triggers webhook, creates row in users table with OAuth fields populated
2. Updated Clerk user triggers webhook, updates corresponding users row
3. Webhook validates svix signature (rejects invalid/tampered requests)
4. Duplicate webhooks for same user are idempotent (no duplicate rows, no errors)

---

### Phase 15: Admin UI

**Goal:** Authenticated users can view portfolio analysis, logs, and trade signals

**Dependencies:** Phase 14 (authentication complete, user sync working)

**Requirements:**
- UI-01: MACD-V portfolio viewer (symbols, prices, MACD-V values, signals)
- UI-02: Log viewer (error/warning logs from Livermore)
- UI-03: Trade signals viewer (triggered alerts with timestamp, symbol, signal type)
- UI-04: Clerk sign-in component with Google OAuth

**Success Criteria:**
1. User can sign in with Google OAuth and see their identity in the UI
2. User can view table of portfolio symbols with current price and MACD-V indicator values
3. User can view filtered log entries (errors, warnings) from Livermore services
4. User can view list of triggered trade signals with timestamp, symbol, and signal type
5. Unauthenticated access redirects to sign-in page

---

### Phase 16: Kaia Handoff Documentation

**Goal:** Kaia has full context to build PerseusWeb authentication against Livermore

**Dependencies:** Phase 15 (all features implemented and tested)

**Requirements:**
- DOC-01: `docs/KAIA-IAM-HANDOFF.md` - full context document for Kaia's AI workflow

**Success Criteria:**
1. Document explains shared Clerk application setup (same publishable key)
2. Document shows how to pass Bearer token from React frontend to Livermore API
3. Document lists API endpoints/procedures available and their auth requirements
4. Document includes Sandbox database connection details for IAM tables
5. Kaia can understand the integration without additional context from Mike

---

## Progress

| Phase | Name | Status | Requirements | Completion |
|-------|------|--------|--------------|------------|
| 11 | Database Workflow | Planned | 4 | 0% |
| 12 | IAM Schema | Pending | 6 | 0% |
| 13 | Clerk Authentication | Pending | 3 | 0% |
| 14 | User Sync Webhooks | Pending | 2 | 0% |
| 15 | Admin UI | Pending | 4 | 0% |
| 16 | Kaia Handoff | Pending | 1 | 0% |

**Milestone Progress:** 0/20 requirements complete (0%)

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | 11 | Pending |
| DB-02 | 11 | Pending |
| DB-03 | 11 | Pending |
| DB-04 | 11 | Pending |
| IAM-01 | 12 | Pending |
| IAM-02 | 12 | Pending |
| IAM-03 | 12 | Pending |
| IAM-04 | 12 | Pending |
| IAM-05 | 12 | Pending |
| IAM-06 | 12 | Pending |
| AUTH-01 | 13 | Pending |
| AUTH-02 | 13 | Pending |
| AUTH-03 | 13 | Pending |
| AUTH-04 | 14 | Pending |
| AUTH-05 | 14 | Pending |
| UI-01 | 15 | Pending |
| UI-02 | 15 | Pending |
| UI-03 | 15 | Pending |
| UI-04 | 15 | Pending |
| DOC-01 | 16 | Pending |

**Coverage:** 20/20 v3.0 requirements mapped (100%)

---
*Roadmap created: 2026-01-26*
*Last updated: 2026-01-26*
