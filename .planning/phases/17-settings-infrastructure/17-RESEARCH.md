# Phase 17: Settings Infrastructure - Research

**Researched:** 2026-01-31
**Domain:** PostgreSQL JSONB settings, Drizzle ORM, tRPC CRUD endpoints, JSON export/import
**Confidence:** HIGH

## Summary

Phase 17 implements the foundation for user-specific settings storage. This involves adding a `settings` JSONB column to the existing `users` table (via Atlas migration), creating a Zod schema matching the existing file-based settings structure, and exposing CRUD endpoints via tRPC.

The existing codebase already uses JSONB columns (indicators, alert_history, user_settings tables) and provides established patterns for Drizzle ORM. The architecture decision to store settings as JSONB on users (not a separate key-value table) is already locked in from V4-ARCHITECTURE.md research.

**Primary recommendation:** Add `settings JSONB DEFAULT '{"version":1}'::jsonb` column to users table, create UserSettingsSchema in `@livermore/schemas`, implement settings.router.ts with get/update/patch/export/import endpoints.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.36.4 | Database ORM with JSONB support | Already in use, `$type<T>()` for type inference |
| zod | 3.23.x | Schema validation | Already in use throughout codebase |
| @trpc/server | 10.45.x | API endpoints | Already in use, router pattern established |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| postgres-js | 3.4.x | PostgreSQL client | Already in use via createDbClient() |
| Atlas | latest | Schema migrations | Source of truth: schema.sql |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSONB on users | Separate settings table | More tables, more joins, but queryable fields |
| Full replace | JSON Patch (RFC 6902) | Complex, overkill for this use case |

**Installation:**
```bash
# No new dependencies required - all libraries already installed
```

## Architecture Patterns

### Recommended Project Structure
```
packages/
  schemas/
    src/
      settings/
        user-settings.schema.ts    # Zod schema + TypeScript types
apps/
  api/
    src/
      routers/
        settings.router.ts         # tRPC endpoints
      services/
        settings.service.ts        # Optional: service layer
packages/
  database/
    schema.sql                     # ADD settings column here
    src/schema/
      users.ts                     # ADD settings column to Drizzle schema
```

### Pattern 1: JSONB Column with Type Inference

**What:** Use Drizzle's `$type<T>()` for compile-time type safety on JSONB columns
**When to use:** Any JSONB column where you want TypeScript inference
**Example:**
```typescript
// Source: https://orm.drizzle.team/docs/column-types/pg
import { pgTable, serial, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import type { UserSettings } from '@livermore/schemas';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  // ... existing columns ...
  settings: jsonb('settings').$type<UserSettings>().default({ version: 1 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### Pattern 2: JSONB Partial Update via jsonb_set

**What:** Update specific nested paths without replacing entire JSONB
**When to use:** SET-05: `settings.patch` endpoint for section updates
**Example:**
```typescript
// Source: https://neon.com/postgresql/postgresql-json-functions/postgresql-jsonb_set
import { sql } from 'drizzle-orm';

// Update nested path: settings.perseus_profile.timezone
await db.execute(sql`
  UPDATE users
  SET settings = jsonb_set(settings, '{perseus_profile,timezone}', '"America/New_York"'::jsonb)
  WHERE id = ${userId}
`);

// Update top-level section: settings.exchanges
await db.execute(sql`
  UPDATE users
  SET settings = jsonb_set(settings, '{exchanges}', ${JSON.stringify(newExchanges)}::jsonb)
  WHERE id = ${userId}
`);
```

### Pattern 3: Settings Version Field for Schema Evolution

**What:** Include `version: number` in settings for migration support
**When to use:** Always - enables future schema changes without breaking old data
**Example:**
```typescript
// Source: V4-PITFALLS.md - Pitfall 4
interface UserSettingsV1 {
  version: 1;
  // ... fields
}

interface UserSettingsV2 {
  version: 2;
  // ... fields + new field
  newField: string;
}

function migrateSettings(raw: unknown): CurrentSettings {
  const parsed = raw as { version?: number };

  if (!parsed.version || parsed.version === 1) {
    return {
      ...parsed,
      version: 2,
      newField: 'default_value',
    } as CurrentSettings;
  }

  return parsed as CurrentSettings;
}
```

### Pattern 4: tRPC Router with Zod Validation

**What:** Define input/output schemas with Zod, use protectedProcedure for auth
**When to use:** All settings endpoints (require authenticated user)
**Example:**
```typescript
// Source: Existing user.router.ts pattern
import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { UserSettingsSchema, UserSettingsPatchSchema } from '@livermore/schemas';

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    // ctx.auth.userId is guaranteed string (protectedProcedure)
    return await getSettings(ctx.auth.userId);
  }),

  update: protectedProcedure
    .input(UserSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return await replaceSettings(ctx.auth.userId, input);
    }),

  patch: protectedProcedure
    .input(UserSettingsPatchSchema)
    .mutation(async ({ ctx, input }) => {
      // input.path: string[], input.value: unknown
      return await patchSettings(ctx.auth.userId, input.path, input.value);
    }),
});
```

### Anti-Patterns to Avoid
- **Untyped JSONB:** `jsonb().default({})` loses type safety - always use `.$type<T>()`
- **Full replace for partial updates:** Replacing entire settings to change one field risks race conditions
- **No version field:** Settings without version cause crashes when schema evolves
- **Querying JSONB internals:** Don't use JSONB fields in WHERE clauses without indexes (use top-level columns for frequently-queried fields)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema validation | Manual if/else checks | Zod schemas | Zod gives validation + type inference |
| Partial JSON updates | Read-modify-write in app | PostgreSQL `jsonb_set()` | Atomic, no race conditions |
| Type-safe JSONB | Manual type assertions | Drizzle `$type<T>()` | Compile-time checking |
| File download | Manual headers | Fastify reply.send() with headers | Built-in, handles edge cases |

**Key insight:** PostgreSQL has native JSONB operators (`jsonb_set`, `||`, `@>`) that are atomic and efficient. Don't pull data into Node.js, modify, and push back.

## Common Pitfalls

### Pitfall 1: JSONB Schema Evolution Without Version

**What goes wrong:** Settings structure changes, old data causes runtime crashes or undefined fields
**Why it happens:** JSONB is schema-less at DB level; TypeScript interface changes don't update stored data
**How to avoid:**
- Include `version: number` field from day one (SET-01)
- Write migration function that upgrades old versions on read
- Only add fields (never remove/rename) for backwards compatibility
**Warning signs:** TypeError on settings access after deployment; different behavior for old vs new users

### Pitfall 2: User ID Missing from Queries

**What goes wrong:** One user's settings returned/modified for another user
**Why it happens:** Copy-paste from single-user codebase with hardcoded `TEST_USER_ID = 1`
**How to avoid:**
- Always get userId from `ctx.auth.userId` (protectedProcedure guarantees it)
- Include `WHERE id = userId` or equivalent in all queries
- Never hardcode user IDs in Phase 17
**Warning signs:** Settings changes appear random; wrong data on Admin UI

### Pitfall 3: Full Replace Race Condition

**What goes wrong:** Two concurrent updates, one overwrites the other
**Why it happens:** Both read settings, both modify locally, both write full object
**How to avoid:**
- Use `jsonb_set()` for partial updates (SET-05)
- Full replace (SET-04) is intentional for import/reset scenarios
- Document that patch is preferred for section updates
**Warning signs:** Settings "reset" intermittently; user reports lost changes

### Pitfall 4: Forgetting Content-Type for Export

**What goes wrong:** Browser shows JSON instead of downloading file
**Why it happens:** Missing `Content-Disposition: attachment` header
**How to avoid:**
```typescript
// SET-06: Export endpoint
reply.header('Content-Type', 'application/json');
reply.header('Content-Disposition', 'attachment; filename="settings.json"');
return settings;
```
**Warning signs:** File opens in browser tab instead of Save dialog

### Pitfall 5: Import Without Validation

**What goes wrong:** Malformed JSON imported, crashes settings loader
**Why it happens:** Trust user-uploaded JSON without Zod validation
**How to avoid:**
- Parse with `JSON.parse()` (catches syntax errors)
- Validate with `UserSettingsSchema.safeParse()` (catches schema errors)
- Return detailed validation errors to user
**Warning signs:** Import "succeeds" but settings page crashes

## Code Examples

Verified patterns from official sources:

### Atlas Migration (schema.sql)
```sql
-- Source: Existing schema.sql pattern
-- Add settings column to users table
ALTER TABLE "users"
ADD COLUMN "settings" jsonb DEFAULT '{"version":1}'::jsonb;
```

### Drizzle Schema (users.ts)
```typescript
// Source: https://orm.drizzle.team/docs/column-types/pg
import { pgTable, serial, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import type { UserSettings } from '@livermore/schemas';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  // ... existing columns ...
  settings: jsonb('settings').$type<UserSettings>().default({ version: 1 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### Zod Schema (user-settings.schema.ts)
```typescript
// Source: Existing settings file structure + Zod patterns
import { z } from 'zod';

const ExchangeConfigSchema = z.object({
  enabled: z.boolean(),
  ApiKeyEnvironmentVariableName: z.string(),
  SecretEnvironmentVariableName: z.string(),
  PasswordEnvironmentVariableName: z.string().optional(),
});

const PerseusProfileSchema = z.object({
  public_name: z.string().optional(),
  description: z.string().optional(),
  primary_exchange: z.string(),
  trading_mode: z.enum(['paper', 'live']),
  currency: z.string().default('USD'),
  timezone: z.string().default('UTC'),
  locale: z.string().default('en-US'),
  // ... other fields from existing structure
});

export const UserSettingsSchema = z.object({
  version: z.number().default(1),
  sub: z.string().optional(), // Clerk identity
  perseus_profile: PerseusProfileSchema.optional(),
  livermore_runtime: z.object({
    auto_start: z.boolean().default(false),
    logging: z.object({
      data_directory: z.string().optional(),
      log_directory: z.string().optional(),
      verbosity_level: z.string().default('error'),
    }).optional(),
  }).optional(),
  exchanges: z.record(z.string(), ExchangeConfigSchema).optional(),
  symbols: z.array(z.string()).default([]),
  scanner_symbols_last_update: z.string().optional(),
  scanner_exchange: z.string().optional(),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;

// Patch input for partial updates
export const UserSettingsPatchSchema = z.object({
  path: z.array(z.string()).min(1), // e.g., ['perseus_profile', 'timezone']
  value: z.unknown(), // New value at that path
});

export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>;
```

### tRPC Router (settings.router.ts)
```typescript
// Source: Existing router patterns (user.router.ts, position.router.ts)
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, users } from '@livermore/database';
import { UserSettingsSchema, UserSettingsPatchSchema } from '@livermore/schemas';
import { eq, and, sql } from 'drizzle-orm';

export const settingsRouter = router({
  // SET-03: Get settings
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = getDbClient();
    const clerkId = ctx.auth.userId;

    const [user] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, clerkId)
      ))
      .limit(1);

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return user.settings ?? { version: 1 };
  }),

  // SET-04: Replace entire settings
  update: protectedProcedure
    .input(UserSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      const [updated] = await db
        .update(users)
        .set({
          settings: input,
          updatedAt: new Date().toISOString(),
        })
        .where(and(
          eq(users.identityProvider, 'clerk'),
          eq(users.identitySub, clerkId)
        ))
        .returning({ settings: users.settings });

      return updated.settings;
    }),

  // SET-05: Patch specific section via jsonb_set
  patch: protectedProcedure
    .input(UserSettingsPatchSchema)
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      // Build path for jsonb_set: ['a', 'b'] -> '{a,b}'
      const pathStr = `{${input.path.join(',')}}`;
      const valueJson = JSON.stringify(input.value);

      // Get user ID first (needed for raw SQL)
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.identityProvider, 'clerk'),
          eq(users.identitySub, clerkId)
        ))
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Use jsonb_set for atomic partial update
      await db.execute(sql`
        UPDATE users
        SET settings = jsonb_set(COALESCE(settings, '{}'), ${pathStr}::text[], ${valueJson}::jsonb, true),
            updated_at = NOW()
        WHERE id = ${user.id}
      `);

      // Return updated settings
      const [updated] = await db
        .select({ settings: users.settings })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      return updated.settings;
    }),

  // SET-06: Export as JSON file
  export: protectedProcedure.query(async ({ ctx }) => {
    const db = getDbClient();
    const clerkId = ctx.auth.userId;

    const [user] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, clerkId)
      ))
      .limit(1);

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    // Return settings with metadata for export
    return {
      exportedAt: new Date().toISOString(),
      settings: user.settings ?? { version: 1 },
    };
  }),

  // SET-07: Import from JSON
  import: protectedProcedure
    .input(z.object({
      settings: UserSettingsSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      const [updated] = await db
        .update(users)
        .set({
          settings: input.settings,
          updatedAt: new Date().toISOString(),
        })
        .where(and(
          eq(users.identityProvider, 'clerk'),
          eq(users.identitySub, clerkId)
        ))
        .returning({ settings: users.settings });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      return updated.settings;
    }),
});

export type SettingsRouter = typeof settingsRouter;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Key-value settings table | JSONB column on users | v4.0 decision | Simpler queries, no joins |
| Manual type assertions | Drizzle `$type<T>()` | Drizzle 0.30+ | Compile-time safety |
| Read-modify-write | `jsonb_set()` | Always available | Atomic, no race conditions |

**Deprecated/outdated:**
- `user_settings` table (existing): Key-value pattern superseded by JSONB on users - can be retained for backwards compatibility but new settings go on users.settings

## Open Questions

Things that couldn't be fully resolved:

1. **Export endpoint response format**
   - What we know: tRPC returns JSON automatically
   - What's unclear: How to trigger browser download from tRPC query (may need separate Fastify route)
   - Recommendation: Start with tRPC returning JSON; if download needed, add raw Fastify route `/api/settings/export`

2. **Import file size limits**
   - What we know: Settings JSON is typically small (<100KB)
   - What's unclear: Fastify body size limits, multipart vs JSON body
   - Recommendation: Use JSON body (not multipart) with 1MB limit; settings files are text, not binary

3. **Existing user_settings table migration**
   - What we know: Table exists with global key-value store
   - What's unclear: Is any data in it that needs migration?
   - Recommendation: Keep table for now, don't migrate data - new settings on users.settings column

## Sources

### Primary (HIGH confidence)
- [Drizzle ORM PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg) - JSONB with `$type<T>()`
- [PostgreSQL jsonb_set() Function](https://neon.com/postgresql/postgresql-json-functions/postgresql-jsonb_set) - Partial update syntax
- Existing codebase: `user.router.ts`, `position.router.ts`, `users.ts` schema

### Secondary (MEDIUM confidence)
- [Drizzle JSONB Type Safety Discussion](https://github.com/drizzle-team/drizzle-orm/discussions/386) - Community patterns
- V4-ARCHITECTURE.md - Locked architectural decisions
- V4-PITFALLS.md - JSONB versioning best practices

### Tertiary (LOW confidence)
- WebSearch results for tRPC file upload/download - patterns vary, need validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use
- Architecture patterns: HIGH - Follows existing codebase patterns
- JSONB operations: HIGH - PostgreSQL official documentation
- Export/import: MEDIUM - May need Fastify route for download trigger

**Research date:** 2026-01-31
**Valid until:** 60 days (stable domain, no fast-moving dependencies)

---

*Research for Phase 17: Settings Infrastructure - v4.0 milestone*
