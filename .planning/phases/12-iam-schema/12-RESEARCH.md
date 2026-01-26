# Phase 12: IAM Schema - Research

**Researched:** 2026-01-26
**Domain:** PostgreSQL schema extension for OAuth identity storage
**Confidence:** HIGH

## Summary

This phase extends the existing `users` table to support OAuth identity storage from Clerk authentication, role-based access control, and login tracking. The research confirms the current schema structure, identifies no conflicts with proposed columns, and documents the correct data types based on Clerk's user object structure.

The approach is additive-only: six new columns added to the existing `users` table. No separate federated identities table is needed since Livermore uses Clerk as the sole identity provider (users cannot link multiple OAuth accounts - Clerk manages that internally).

**Primary recommendation:** Add all six columns with appropriate constraints, including a unique index on `(identity_provider, identity_sub)` for efficient webhook user lookups, and use `VARCHAR` with specified lengths matching Clerk's data constraints.

## Standard Stack

This phase uses the established database-first workflow from Phase 11.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Atlas | 0.30+ | Schema deployment | State-based migrations, already configured |
| Drizzle Kit | 0.22+ | Type generation | Pull-based workflow established |
| PostgreSQL | 15+ | Database | Already deployed locally and sandbox |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `sync-schema.ps1` | Local deployment + type regen | After editing schema.sql |
| `apply-schema-sandbox.ps1` | Azure sandbox deployment | After local verification |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single users table | Separate federated_identities table | More flexible for multi-provider, but overkill when Clerk handles OAuth federation internally |
| VARCHAR columns | JSONB blob | Flexible but loses type safety in Drizzle, harder to query |

## Architecture Patterns

### Existing Schema Structure

Current `users` table (from `schema.sql`):
```sql
CREATE TABLE "users" (
  "id" serial NOT NULL,
  "username" character varying(50) NOT NULL,
  "email" character varying(255) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "users_email_unique" UNIQUE ("email"),
  CONSTRAINT "users_username_unique" UNIQUE ("username")
);
```

### Proposed Column Additions

All columns are nullable except `role` (has default). This allows existing users to remain valid and supports gradual migration.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `identity_provider` | VARCHAR(20) | NULL | OAuth provider (e.g., "google", "clerk") |
| `identity_sub` | VARCHAR(255) | NULL | Provider's unique user ID (Clerk's `id` or Google's `sub`) |
| `display_name` | VARCHAR(100) | NULL | User's display name from OAuth profile |
| `identity_picture_url` | TEXT | NULL | Profile picture URL (can be long CDN URLs) |
| `role` | VARCHAR(20) | DEFAULT 'user' NOT NULL | Authorization role |
| `last_login_at` | TIMESTAMP | NULL | Last authentication timestamp |

### Index Strategy

```sql
-- Primary lookup for webhook user sync
-- When Clerk webhook fires, we look up: WHERE identity_provider = 'clerk' AND identity_sub = 'user_xxx'
CREATE UNIQUE INDEX "users_identity_provider_sub_idx" ON "users" ("identity_provider", "identity_sub")
  WHERE identity_provider IS NOT NULL;
```

**Why UNIQUE partial index:**
1. Prevents duplicate OAuth identities (same provider + sub should never map to two users)
2. Partial index (WHERE NOT NULL) allows multiple NULL values (existing users without OAuth)
3. Efficient lookups for webhook sync operations

### Role Values

Per requirements, four roles are defined:

| Role | Purpose |
|------|---------|
| `user` | Default for all users |
| `admin` | Full administrative access |
| `subscriber_basic` | Basic subscription tier |
| `subscriber_pro` | Professional subscription tier |

**Note:** No ENUM type used - VARCHAR allows adding roles without migrations.

### Anti-Patterns to Avoid

- **Storing Clerk session data:** Session tokens are short-lived and managed by Clerk. Never store session IDs in your database.
- **Storing sensitive OAuth tokens:** Clerk manages access/refresh tokens. Your database only stores identity claims.
- **Using email as foreign key to Clerk:** Emails can change. Use `identity_sub` (Clerk's user ID) as the stable identifier.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth flow | Custom OAuth2 implementation | Clerk | Clerk handles OAuth complexity, token refresh, session management |
| Profile picture storage | Download and store images | Store URL from Clerk | URLs update automatically, no storage costs |
| Role validation | String comparisons everywhere | TypeScript union type + Drizzle inference | Type safety at compile time |

## Common Pitfalls

### Pitfall 1: Nullable vs Default for role

**What goes wrong:** Using `NULL` default for role causes authorization checks to fail.
**Why it happens:** Forgetting that existing users need a role value.
**How to avoid:** Use `DEFAULT 'user' NOT NULL` - every user has a role.
**Warning signs:** Authorization middleware checking `if (!user.role)` fails for new OAuth users.

### Pitfall 2: Using email for Clerk user lookup

**What goes wrong:** User changes email in Clerk, webhook sync creates duplicate user.
**Why it happens:** Email is not a stable identifier in OAuth systems.
**How to avoid:** Always look up by `(identity_provider, identity_sub)`.
**Warning signs:** Duplicate users with same Clerk ID but different emails.

### Pitfall 3: VARCHAR too short for Clerk IDs

**What goes wrong:** Clerk user IDs truncated, lookups fail.
**Why it happens:** Clerk user IDs are ~30-35 characters (`user_29w83sxmDNGwOuEthce5gg56FcC`).
**How to avoid:** Use VARCHAR(255) for identity_sub - future-proof against ID format changes.
**Warning signs:** Database constraint violations on INSERT, partial IDs in data.

### Pitfall 4: Missing partial index WHERE clause

**What goes wrong:** UNIQUE constraint prevents multiple NULL values.
**Why it happens:** Standard UNIQUE allows only one NULL per column combination.
**How to avoid:** Use partial unique index: `WHERE identity_provider IS NOT NULL`.
**Warning signs:** Constraint violation when adding second user without OAuth identity.

## Code Examples

### Final schema.sql Addition

```sql
-- Extend "users" table for IAM (Phase 12)
-- Add after existing users table definition

-- Add OAuth identity columns
ALTER TABLE "users" ADD COLUMN "identity_provider" character varying(20) NULL;
ALTER TABLE "users" ADD COLUMN "identity_sub" character varying(255) NULL;
ALTER TABLE "users" ADD COLUMN "display_name" character varying(100) NULL;
ALTER TABLE "users" ADD COLUMN "identity_picture_url" text NULL;
ALTER TABLE "users" ADD COLUMN "role" character varying(20) NOT NULL DEFAULT 'user';
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp NULL;

-- Create unique partial index for OAuth identity lookup
CREATE UNIQUE INDEX "users_identity_provider_sub_idx" ON "users" ("identity_provider", "identity_sub")
  WHERE identity_provider IS NOT NULL;
```

**Important:** For Atlas state-based migrations, integrate columns directly into the CREATE TABLE statement, not as ALTER statements. The schema.sql should represent the desired end state:

```sql
-- Create "users" table (updated for IAM)
CREATE TABLE "users" (
  "id" serial NOT NULL,
  "username" character varying(50) NOT NULL,
  "email" character varying(255) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "identity_provider" character varying(20) NULL,
  "identity_sub" character varying(255) NULL,
  "display_name" character varying(100) NULL,
  "identity_picture_url" text NULL,
  "role" character varying(20) NOT NULL DEFAULT 'user',
  "last_login_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "users_email_unique" UNIQUE ("email"),
  CONSTRAINT "users_username_unique" UNIQUE ("username")
);

-- Unique partial index for OAuth identity lookup
CREATE UNIQUE INDEX "users_identity_provider_sub_idx" ON "users" ("identity_provider", "identity_sub")
  WHERE identity_provider IS NOT NULL;
```

### Expected Drizzle Type (after pull)

```typescript
// packages/database/src/schema/users.ts (generated by drizzle-kit pull)
import { pgTable, serial, varchar, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  identityProvider: varchar('identity_provider', { length: 20 }),
  identitySub: varchar('identity_sub', { length: 255 }),
  displayName: varchar('display_name', { length: 100 }),
  identityPictureUrl: text('identity_picture_url'),
  role: varchar('role', { length: 20 }).default('user').notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

### TypeScript Role Type (for application code)

```typescript
// packages/database/src/types/role.ts
export const USER_ROLES = ['user', 'admin', 'subscriber_basic', 'subscriber_pro'] as const;
export type UserRole = typeof USER_ROLES[number];

// Type guard
export function isValidRole(role: string): role is UserRole {
  return USER_ROLES.includes(role as UserRole);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Store full OAuth profile | Store minimal identity + fetch from Clerk | Clerk v4+ (2024) | Reduces data staleness, simplifies sync |
| Separate identities table | Single table with Clerk as sole provider | N/A (project decision) | Simpler schema for single-provider setup |
| Email-based user lookup | Provider+sub compound key | OAuth best practice | Stable user identity across email changes |

## Open Questions

1. **Existing user migration**
   - What we know: Existing users have NULL OAuth columns (valid due to nullable design)
   - What's unclear: Should existing users be linked to Clerk accounts?
   - Recommendation: Phase 14 (User Sync Webhooks) will handle linking existing users by email match

2. **Role assignment for new OAuth users**
   - What we know: New users get 'user' role by default
   - What's unclear: Should admins be auto-assigned based on email domain?
   - Recommendation: Start with manual admin assignment; add automation later if needed

## Sources

### Primary (HIGH confidence)
- `packages/database/schema.sql` - Current users table structure verified
- `packages/database/src/schema/users.ts` - Current Drizzle types verified
- `.planning/research/CLERK-INTEGRATION.md` - Clerk webhook structure confirmed

### Secondary (MEDIUM confidence)
- [Clerk Webhooks Overview](https://clerk.com/docs/guides/development/webhooks/overview) - User object fields
- [Clerk ExternalAccount Reference](https://clerk.com/docs/reference/javascript/types/external-account) - OAuth provider fields
- [Clerk User Sync Article](https://clerk.com/docs/users/sync-data) - Selective sync recommendation

### Tertiary (LOW confidence)
- [Vertabelo User Authentication Best Practices](https://vertabelo.com/blog/user-authentication-module/) - General schema design patterns

## Metadata

**Confidence breakdown:**
- Schema extension approach: HIGH - Verified against existing schema.sql
- Data types and constraints: HIGH - Based on Clerk documentation
- Index strategy: HIGH - Standard PostgreSQL partial index pattern
- Role system: HIGH - Requirements explicitly specify values

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (stable domain, unlikely to change)
