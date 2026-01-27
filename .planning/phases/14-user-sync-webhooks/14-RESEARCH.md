# Phase 14: User Sync Webhooks - Research

**Researched:** 2026-01-26
**Domain:** Clerk webhooks, svix signature verification, Fastify raw body handling
**Confidence:** HIGH

## Summary

This phase implements Clerk webhook integration to automatically sync user data to the PostgreSQL users table when Clerk users are created or updated. The codebase already has:
- Clerk authentication registered in `apps/api/src/server.ts` (Phase 13)
- IAM columns in users table: `identity_provider`, `identity_sub`, `display_name`, `identity_picture_url`, `role`, `last_login_at` (Phase 12)
- Environment variables for Clerk configured in `packages/schemas/src/env/config.schema.ts`

The implementation requires:
1. Adding `CLERK_WEBHOOK_SIGNING_SECRET` environment variable
2. Using `@clerk/fastify/webhooks` built-in `verifyWebhook()` helper (avoids manual svix handling)
3. Creating a webhook route at `/webhooks/clerk` that bypasses auth middleware
4. Implementing upsert logic for idempotent user sync

**Primary recommendation:** Use Clerk's official `verifyWebhook()` function from `@clerk/fastify/webhooks` - it handles raw body parsing and svix signature verification internally. Do NOT use the raw `svix` package directly.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @clerk/fastify | 2.6.17 | Webhook verification via `verifyWebhook()` | Already installed, official helper handles raw body + svix |
| drizzle-orm | 0.36.4 | Database upsert operations | Already installed, onConflictDoUpdate |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| svix | 1.64.1 | Raw webhook signature verification | NOT NEEDED - Clerk helper uses it internally |
| fastify-raw-body | 4.2.0 | Access raw request body | NOT NEEDED - Clerk helper handles internally |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| verifyWebhook() | Raw svix + fastify-raw-body | Much more complex, error-prone raw body handling |
| Drizzle upsert | Raw SQL ON CONFLICT | Less type safety, Drizzle already in use |

**Installation:**
```bash
# No new packages needed - @clerk/fastify already installed
```

## Architecture Patterns

### Webhook Route Registration Pattern
```
apps/api/
├── src/
│   ├── server.ts           # Register webhook route BEFORE clerkPlugin
│   └── routes/
│       └── webhooks/
│           └── clerk.ts    # Webhook handler
```

### Pattern 1: Webhook Route Outside Auth Scope
**What:** Register webhook route BEFORE clerkPlugin to bypass JWT validation
**When to use:** Webhooks are server-to-server, no user JWT token
**Example:**
```typescript
// apps/api/src/server.ts
// Source: Clerk Fastify docs

async function start() {
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  // WEBHOOK ROUTE FIRST - before clerkPlugin
  // This ensures the route doesn't require JWT auth
  fastify.post('/webhooks/clerk', clerkWebhookHandler);

  // THEN register clerkPlugin for other routes
  await fastify.register(clerkPlugin);

  // ... rest of setup
}
```

### Pattern 2: Using verifyWebhook() Helper
**What:** Clerk's built-in webhook verification function
**When to use:** All Clerk webhook endpoints
**Source:** [Clerk SDK Reference](https://clerk.com/docs/reference/backend/verify-webhook)
```typescript
// apps/api/src/routes/webhooks/clerk.ts
import { verifyWebhook } from '@clerk/fastify/webhooks';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WebhookEvent } from '@clerk/fastify/webhooks';

export async function clerkWebhookHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // verifyWebhook handles:
    // 1. Raw body extraction
    // 2. Svix header verification (svix-id, svix-timestamp, svix-signature)
    // 3. Signature validation using CLERK_WEBHOOK_SIGNING_SECRET
    const evt: WebhookEvent = await verifyWebhook(request);

    switch (evt.type) {
      case 'user.created':
      case 'user.updated':
        await syncUser(evt.data);
        break;
    }

    return reply.code(200).send({ received: true });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return reply.code(400).send({ error: 'Invalid webhook signature' });
  }
}
```

### Pattern 3: Idempotent Upsert
**What:** Use Drizzle's onConflictDoUpdate for duplicate webhook handling
**When to use:** Clerk uses at-least-once delivery, same event may arrive multiple times
**Source:** Drizzle ORM docs + Clerk webhook best practices
```typescript
// Database upsert for user sync
import { db, users, eq } from '@livermore/database';

async function syncUser(userData: UserData) {
  await db
    .insert(users)
    .values({
      // Map Clerk fields to IAM columns
      email: getPrimaryEmail(userData),
      username: generateUsername(userData),
      identityProvider: 'clerk',
      identitySub: userData.id,  // Clerk user ID
      displayName: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || null,
      identityPictureUrl: userData.image_url || null,
      lastLoginAt: userData.last_sign_in_at
        ? new Date(userData.last_sign_in_at).toISOString()
        : null,
    })
    .onConflictDoUpdate({
      target: [users.identityProvider, users.identitySub],
      set: {
        email: getPrimaryEmail(userData),
        displayName: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || null,
        identityPictureUrl: userData.image_url || null,
        lastLoginAt: userData.last_sign_in_at
          ? new Date(userData.last_sign_in_at).toISOString()
          : null,
        updatedAt: new Date().toISOString(),
      },
    });
}
```

### Anti-Patterns to Avoid
- **Registering webhook after clerkPlugin:** Webhook route will fail JWT validation
- **Using raw svix package:** Clerk's verifyWebhook handles this - no need for manual implementation
- **Using fastify-raw-body plugin:** verifyWebhook handles raw body internally
- **Separate INSERT then UPDATE logic:** Use upsert for idempotency
- **Trusting webhook without verification:** Always verify svix signature

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature verification | Manual HMAC-SHA256 with svix | `verifyWebhook()` | Handles timestamp validation, replay attack prevention |
| Raw body extraction in Fastify | Custom content parser | `verifyWebhook()` | Clerk helper reads raw body internally |
| Duplicate webhook handling | Track processed webhook IDs | Drizzle upsert | Simpler, database handles idempotency |
| Email extraction from Clerk | Iterate email_addresses | Helper function | Primary email ID lookup needed |

**Key insight:** Clerk provides `verifyWebhook()` specifically for Fastify - it eliminates the need for raw body plugins and manual svix usage. The helper was patched for security in v2.4.4.

## Common Pitfalls

### Pitfall 1: Webhook Route Behind Auth Middleware
**What goes wrong:** Webhook returns 401 Unauthorized
**Why it happens:** clerkPlugin validates JWT on all routes, webhooks have no JWT
**How to avoid:** Register webhook route BEFORE clerkPlugin registration
**Warning signs:** 401 errors in Clerk webhook delivery logs

### Pitfall 2: Missing CLERK_WEBHOOK_SIGNING_SECRET
**What goes wrong:** verifyWebhook() throws error about missing secret
**Why it happens:** Environment variable not configured
**How to avoid:** Add to EnvConfigSchema, set in environment (User scope)
**Warning signs:** "Missing signing secret" error on startup or first webhook

### Pitfall 3: Primary Email Extraction
**What goes wrong:** Storing wrong email or null
**Why it happens:** Clerk sends `email_addresses` array + `primary_email_address_id`, not direct email string
**How to avoid:** Find email in array by matching primary_email_address_id
**Warning signs:** Users have null or wrong email in database

### Pitfall 4: Timestamp Field Types
**What goes wrong:** Invalid date stored or type errors
**Why it happens:** Clerk sends timestamps as milliseconds since epoch, not ISO strings
**How to avoid:** Convert with `new Date(timestamp).toISOString()`
**Warning signs:** TypeScript errors or invalid dates in database

### Pitfall 5: Username Generation
**What goes wrong:** Duplicate username constraint violation
**Why it happens:** Clerk users may not have username, need to generate unique one
**How to avoid:** Generate from email prefix + random suffix if needed
**Warning signs:** Database constraint errors on user.created

## Code Examples

Verified patterns from official sources:

### Complete Webhook Handler
```typescript
// apps/api/src/routes/webhooks/clerk.ts
// Source: Clerk Fastify SDK docs

import { verifyWebhook, type WebhookEvent } from '@clerk/fastify/webhooks';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDbClient, users } from '@livermore/database';
import { logger } from '@livermore/utils';
import { eq, and } from 'drizzle-orm';

// Clerk User data structure from webhook payload
interface ClerkUserData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: Array<{
    id: string;
    email_address: string;
  }>;
  primary_email_address_id: string | null;
  image_url: string | null;
  last_sign_in_at: number | null;  // Milliseconds since epoch
  created_at: number;
  updated_at: number;
}

/**
 * Extract primary email from Clerk user data
 */
function getPrimaryEmail(userData: ClerkUserData): string {
  if (!userData.primary_email_address_id || !userData.email_addresses.length) {
    throw new Error('User has no primary email address');
  }

  const primary = userData.email_addresses.find(
    (e) => e.id === userData.primary_email_address_id
  );

  if (!primary) {
    // Fallback to first email
    return userData.email_addresses[0].email_address;
  }

  return primary.email_address;
}

/**
 * Generate username from email
 * Format: email prefix + random suffix for uniqueness
 */
function generateUsername(email: string): string {
  const prefix = email.split('@')[0].slice(0, 30);
  const suffix = Math.random().toString(36).substring(2, 7);
  return `${prefix}_${suffix}`;
}

/**
 * Sync Clerk user to PostgreSQL users table
 */
async function syncUser(userData: ClerkUserData): Promise<void> {
  const db = getDbClient();
  const email = getPrimaryEmail(userData);
  const displayName = [userData.first_name, userData.last_name]
    .filter(Boolean)
    .join(' ') || null;

  // Check if user exists by Clerk ID
  const existing = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(
      and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, userData.id)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // UPDATE existing user
    await db
      .update(users)
      .set({
        email,
        displayName,
        identityPictureUrl: userData.image_url,
        lastLoginAt: userData.last_sign_in_at
          ? new Date(userData.last_sign_in_at).toISOString()
          : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, existing[0].id));

    logger.info({ clerkId: userData.id, userId: existing[0].id }, 'Updated user from Clerk webhook');
  } else {
    // INSERT new user
    await db.insert(users).values({
      email,
      username: generateUsername(email),
      identityProvider: 'clerk',
      identitySub: userData.id,
      displayName,
      identityPictureUrl: userData.image_url,
      role: 'user',
      lastLoginAt: userData.last_sign_in_at
        ? new Date(userData.last_sign_in_at).toISOString()
        : null,
    });

    logger.info({ clerkId: userData.id, email }, 'Created user from Clerk webhook');
  }
}

/**
 * Clerk webhook handler
 * Processes user.created and user.updated events
 */
export async function clerkWebhookHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // verifyWebhook validates svix signature using CLERK_WEBHOOK_SIGNING_SECRET
    const evt = await verifyWebhook(request) as WebhookEvent;

    logger.debug({ eventType: evt.type }, 'Received Clerk webhook');

    switch (evt.type) {
      case 'user.created':
      case 'user.updated':
        await syncUser(evt.data as ClerkUserData);
        break;
      default:
        logger.debug({ eventType: evt.type }, 'Ignoring unhandled webhook event type');
    }

    reply.code(200).send({ received: true });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Clerk webhook error');
    reply.code(400).send({ error: 'Webhook verification failed' });
  }
}
```

### Server Registration
```typescript
// apps/api/src/server.ts (modification)
// Source: Clerk Fastify docs

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';
import { clerkWebhookHandler } from './routes/webhooks/clerk';
// ... other imports

async function start() {
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  // WEBHOOK ROUTE - must be registered BEFORE clerkPlugin
  // This route does NOT require JWT authentication
  fastify.post('/webhooks/clerk', clerkWebhookHandler);

  // Clerk plugin for JWT validation on other routes
  await fastify.register(clerkPlugin);

  // ... rest of existing setup (database, redis, tRPC, etc.)
}
```

### Environment Variable Schema Update
```typescript
// packages/schemas/src/env/config.schema.ts (addition)
export const EnvConfigSchema = z.object({
  // ... existing fields ...

  // Clerk Authentication
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'Clerk publishable key is required'),
  CLERK_SECRET_KEY: z.string().min(1, 'Clerk secret key is required'),

  // Clerk Webhook (NEW)
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'Clerk webhook signing secret is required'),
});
```

## Clerk Webhook Payload Structure

### user.created / user.updated Event Data

Source: [Clerk Webhooks Overview](https://clerk.com/docs/guides/development/webhooks/overview)

```typescript
interface ClerkWebhookPayload {
  type: 'user.created' | 'user.updated' | 'user.deleted';
  object: 'event';
  data: {
    // Core identification
    id: string;                    // e.g., 'user_29w83sxmDNGwOuEthce5gg56FcC'
    object: 'user';

    // Profile information
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    image_url: string;             // Always present, may be default avatar

    // Email addresses
    email_addresses: Array<{
      id: string;
      email_address: string;
      verification: { status: string; strategy: string };
    }>;
    primary_email_address_id: string | null;

    // OAuth/external accounts
    external_accounts: Array<{
      id: string;
      provider: string;           // e.g., 'oauth_google'
      email_address: string;
    }>;
    external_id: string | null;

    // Security flags
    password_enabled: boolean;
    two_factor_enabled: boolean;

    // Metadata
    public_metadata: Record<string, unknown>;
    private_metadata: Record<string, unknown>;
    unsafe_metadata: Record<string, unknown>;

    // Timestamps (milliseconds since epoch)
    created_at: number;
    updated_at: number;
    last_sign_in_at: number | null;
  };
}
```

### Field Mapping: Clerk to IAM Columns

| Clerk Field | IAM Column | Transformation |
|-------------|------------|----------------|
| `id` | `identity_sub` | Direct (VARCHAR 255) |
| N/A | `identity_provider` | Hardcoded 'clerk' |
| `first_name` + `last_name` | `display_name` | Join with space, trim, null if empty |
| `image_url` | `identity_picture_url` | Direct (TEXT) |
| `email_addresses[primary]` | `email` | Lookup by primary_email_address_id |
| `last_sign_in_at` | `last_login_at` | `new Date(ms).toISOString()` |
| N/A | `role` | Default 'user' on create |

## Svix Headers Reference

For documentation purposes - these are handled internally by `verifyWebhook()`:

| Header | Purpose | Example Value |
|--------|---------|---------------|
| `svix-id` | Unique message ID | `msg_p5jXN8AQM9LWM0D4loKWxJek` |
| `svix-timestamp` | Unix timestamp (seconds) | `1614265330` |
| `svix-signature` | HMAC-SHA256 signature | `v1,g0hM9SsE+...` |

The signature is computed from: `${svix_id}.${svix_timestamp}.${raw_body}`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual svix verification | verifyWebhook() helper | @clerk/fastify 2.0 | Simpler, less error-prone |
| Raw body plugin required | Built into verifyWebhook | @clerk/fastify 2.0 | No extra dependencies |
| @clerk/fastify v1 | @clerk/fastify v2+ | 2024-10 | Fastify v5 support |

**Security Note:** A webhook verification vulnerability was patched in @clerk/fastify 2.4.4. Current version 2.6.17 is safe.

**Deprecated/outdated:**
- Using raw `svix` package with Clerk - use Clerk's built-in helper
- Using `fastify-raw-body` for Clerk webhooks - unnecessary complexity

## Open Questions

Things that couldn't be fully resolved:

1. **Username uniqueness strategy**
   - What we know: Users table has unique constraint on username
   - What's unclear: What format should generated usernames take?
   - Recommendation: Use `email_prefix_xxxxx` format (prefix + 5 random chars)

2. **Handling user.deleted events**
   - What we know: Clerk can send user.deleted webhooks
   - What's unclear: Should we delete the row or just mark inactive?
   - Recommendation: Mark `is_active = false`, preserve data for foreign key integrity

3. **Webhook endpoint URL for Clerk Dashboard**
   - What we know: Route will be `/webhooks/clerk`
   - What's unclear: Production domain/URL for Clerk dashboard configuration
   - Recommendation: Document setup steps for Clerk dashboard configuration

## Sources

### Primary (HIGH confidence)
- [Clerk SDK Reference: verifyWebhook()](https://clerk.com/docs/reference/backend/verify-webhook) - Function signature, usage
- [Clerk Webhook Syncing Guide](https://clerk.com/docs/guides/development/webhooks/syncing) - Fastify example
- [Clerk Webhooks Overview](https://clerk.com/docs/guides/development/webhooks/overview) - Payload structure
- [@clerk/fastify npm](https://www.npmjs.com/package/@clerk/fastify) - Version 2.6.17

### Secondary (MEDIUM confidence)
- [Svix Verification Docs](https://docs.svix.com/receiving/verifying-payloads/how) - Header details, signature algorithm
- [Clerk User Object Reference](https://clerk.com/docs/reference/javascript/user) - Field types

### Tertiary (LOW confidence)
- [Fastify raw body GitHub issue](https://github.com/fastify/fastify/issues/5491) - Raw body patterns (not needed with Clerk helper)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using official Clerk helper, no new packages needed
- Architecture: HIGH - Pattern from official Clerk Fastify docs
- Pitfalls: HIGH - Well-documented auth bypass and email extraction issues

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - Clerk SDK is stable)
