# Clerk Authentication Integration Research

**Project:** Livermore Trading Platform (v3.0)
**Researched:** 2026-01-26
**Confidence:** HIGH (based on official Clerk documentation)

---

## 1. Overview: How Clerk Works

Clerk is a developer-first authentication and user management solution. For Livermore's use case (Fastify + tRPC backend with admin UI):

### Authentication Flow

1. **Frontend (Admin UI)**: User signs in via Clerk's React components (Google OAuth)
2. **Token Generation**: Clerk generates a short-lived JWT session token
3. **API Requests**: Frontend includes token in `Authorization: Bearer <token>` header
4. **Backend Validation**: Fastify's `clerkPlugin` validates the JWT and attaches auth info to request
5. **tRPC Context**: `getAuth(req)` extracts user info, passed to tRPC procedures

### Session Token Structure

Clerk session tokens are JWTs containing:
- `sub`: User ID
- `sid`: Session ID
- `exp`: Expiration timestamp
- `iat`: Issued at timestamp
- `azp`: Authorized party (frontend origin)
- Organization claims (if using organizations)

Tokens are short-lived and automatically refreshed by Clerk's frontend SDK.

---

## 2. Fastify Integration

### Package

```bash
pnpm add @clerk/fastify
```

**Current Version:** 2.6.14 (supports Fastify v5)
**Compatibility:** `@clerk/fastify@^2.0.0` requires Fastify v5+. Livermore uses Fastify 5.2.2 - compatible.

### Critical: Import Order

```typescript
// CORRECT - dotenv MUST be imported before @clerk/fastify
import 'dotenv/config';
import Fastify from 'fastify';
import { clerkPlugin, getAuth } from '@clerk/fastify';

// WRONG - will cause initialization errors
import { clerkPlugin } from '@clerk/fastify';
import 'dotenv/config';  // Too late!
```

**Why:** Clerk instances are created during module import and rely on environment variables being loaded first.

### Plugin Registration

```typescript
import 'dotenv/config';
import Fastify from 'fastify';
import { clerkPlugin, getAuth } from '@clerk/fastify';

const fastify = Fastify({ logger: true });

// Register for all routes
fastify.register(clerkPlugin);

// OR register for specific routes only
const protectedRoutes = async (instance) => {
  instance.register(clerkPlugin);

  instance.get('/protected', async (request, reply) => {
    const { userId } = getAuth(request);
    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return { userId };
  });
};

fastify.register(protectedRoutes, { prefix: '/api' });
```

### getAuth() Function

```typescript
import { getAuth } from '@clerk/fastify';

fastify.get('/me', async (request, reply) => {
  const auth = getAuth(request);

  // Auth object properties:
  // - userId: string | null
  // - sessionId: string | null
  // - orgId: string | undefined
  // - orgRole: string | undefined
  // - sessionClaims: JwtPayload
  // - getToken(): Promise<string | null>

  if (!auth.userId) {
    return reply.code(401).send({ error: 'Not authenticated' });
  }

  return { userId: auth.userId, sessionId: auth.sessionId };
});
```

---

## 3. tRPC Integration

### Context Setup

Update `packages/trpc-config/src/context.ts`:

```typescript
import 'dotenv/config';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { getAuth } from '@clerk/fastify';
import { createLogger, type Logger } from '@livermore/utils';

// Auth object type from Clerk
interface ClerkAuth {
  userId: string | null;
  sessionId: string | null;
  orgId?: string;
  orgRole?: string;
  sessionClaims: Record<string, unknown>;
  getToken: () => Promise<string | null>;
}

export interface Context {
  logger: Logger;
  requestId: string;
  auth: ClerkAuth;
}

export function createContext({ req }: CreateFastifyContextOptions): Context {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  const logger = createLogger('trpc').child({ requestId });

  // Get Clerk auth from request (populated by clerkPlugin)
  const auth = getAuth(req);

  return {
    logger,
    requestId,
    auth,
  };
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
```

### Protected Procedures

Update `packages/trpc-config/src/trpc.ts`:

```typescript
import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import type { Context } from './context';

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

// Auth middleware - checks if user is authenticated
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be signed in to access this resource',
    });
  }

  // Narrow the type - userId is now guaranteed to be string
  return next({
    ctx: {
      ...ctx,
      auth: {
        ...ctx.auth,
        userId: ctx.auth.userId,  // Now typed as string, not string | null
      },
    },
  });
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);
export const middleware = t.middleware;
```

### Usage in Routers

```typescript
import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '@livermore/trpc-config';

export const userRouter = router({
  // Public - no auth required
  healthCheck: publicProcedure.query(() => ({ status: 'ok' })),

  // Protected - requires authentication
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    // ctx.auth.userId is guaranteed to be string here
    const userId = ctx.auth.userId;

    // Fetch user from database
    return { userId };
  }),

  // Protected with additional authorization
  updateSettings: protectedProcedure
    .input(z.object({ theme: z.enum(['light', 'dark']) }))
    .mutation(async ({ ctx, input }) => {
      // Only allow specific users (e.g., admin check)
      // Could also use ctx.auth.orgRole for org-based permissions
      return { success: true };
    }),
});
```

---

## 4. Google OAuth Setup

### Clerk Dashboard Configuration

1. **Navigate to:** Clerk Dashboard > Configure > SSO Connections
2. **Add connection:** Select "For all users" > Choose "Google"
3. **Development mode:** Uses shared credentials (no Google Cloud setup needed)
4. **Production mode:** Requires custom Google OAuth credentials

### Google Cloud Console Setup (Production)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Navigate to APIs & Services > Credentials
4. Create OAuth 2.0 Client ID:
   - Application type: Web application
   - Authorized redirect URIs: Copy from Clerk Dashboard
5. Copy Client ID and Client Secret back to Clerk Dashboard

### Publishing Status Warning

Google OAuth apps default to "Testing" status:
- Limited to 100 test users
- Requires explicit user approval
- For production, submit for verification to Google

### Security Note

Clerk blocks email addresses containing `+`, `=`, or `#` by default. This prevents the Google email alias attack (`user+alias@gmail.com`).

---

## 5. Environment Variables

### Required Variables

```env
# Clerk API Keys (from Dashboard > API Keys)
CLERK_PUBLISHABLE_KEY=pk_test_...   # or pk_live_... for production
CLERK_SECRET_KEY=sk_test_...        # or sk_live_... for production
```

### Optional Variables

```env
# For networkless JWT verification (better performance)
CLERK_JWT_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----

# For multi-domain setups
CLERK_DOMAIN=your-app.clerk.accounts.dev
```

### Frontend Variables

The admin UI will need:
```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...  # or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
```

### Getting the Keys

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your application
3. Navigate to API Keys
4. Copy Publishable Key (frontend) and Secret Key (backend)
5. For JWT public key: Show JWT public key > PEM Public Key

---

## 6. Pitfalls to Avoid

### Critical Pitfalls

| Pitfall | Consequence | Prevention |
|---------|-------------|------------|
| **Import order wrong** | Clerk fails to initialize, cryptic errors | Always import `dotenv/config` before `@clerk/fastify` |
| **Missing ESM config** | Module resolution errors | Ensure `"type": "module"` in package.json (Livermore already has this) |
| **Using Fastify v4 with @clerk/fastify v2** | Incompatible versions | Use @clerk/fastify v1 for Fastify v4, v2+ for Fastify v5 |
| **Exposing CLERK_SECRET_KEY** | Security breach | Never include in frontend code or commit to repo |

### Common Mistakes

| Mistake | Fix |
|---------|-----|
| Not awaiting `getToken()` on frontend | Always `await getToken()` - it returns a Promise |
| Forgetting Bearer prefix | Use `Authorization: Bearer ${token}`, not just the token |
| Not handling token expiration | Clerk SDK auto-refreshes, but handle 401s gracefully |
| Calling `getAuth()` before `clerkPlugin` runs | Register clerkPlugin before routes that use getAuth |

### tRPC-Specific Pitfalls

| Pitfall | Prevention |
|---------|------------|
| Not passing auth to context | Always call `getAuth(req)` in createContext |
| Type narrowing issues | Use middleware to narrow `userId: string \| null` to `string` |
| Mixing public/protected procedures | Be explicit - use `publicProcedure` or `protectedProcedure` |

---

## 7. Code Examples

### Complete Server Setup

```typescript
// apps/api/src/server.ts
import 'dotenv/config';  // MUST be first
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { clerkPlugin } from '@clerk/fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { createContext } from '@livermore/trpc-config';
import { appRouter } from './routers';

async function start() {
  const fastify = Fastify({ logger: false });

  // CORS - allow your frontend origin
  await fastify.register(cors, {
    origin: ['http://localhost:5173', 'https://your-admin-ui.com'],
    credentials: true,  // Important for cookies
  });

  await fastify.register(websocket);

  // Register Clerk plugin for all routes
  await fastify.register(clerkPlugin);

  // Register tRPC - context will have auth from Clerk
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }) {
        console.error(`tRPC error on ${path}:`, error);
      },
    },
  });

  // Health check (public, no auth)
  fastify.get('/health', async () => ({ status: 'ok' }));

  await fastify.listen({ port: 3000, host: '0.0.0.0' });
}

start();
```

### Frontend Token Passing (React)

```typescript
// In admin UI (React + @clerk/clerk-react)
import { useAuth } from '@clerk/clerk-react';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@livermore/api';

function App() {
  const { getToken } = useAuth();

  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: 'http://localhost:3000/trpc',
        async headers() {
          const token = await getToken();
          return {
            Authorization: token ? `Bearer ${token}` : '',
          };
        },
      }),
    ],
  });

  // Use trpc client...
}
```

### Webhook for User Sync (Optional)

If you need to sync Clerk users to your PostgreSQL database:

```typescript
// apps/api/src/routes/webhooks/clerk.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Webhook } from 'svix';

export async function clerkWebhook(req: FastifyRequest, reply: FastifyReply) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    return reply.code(500).send({ error: 'Webhook secret not configured' });
  }

  const svix = new Webhook(WEBHOOK_SECRET);
  const payload = req.body as string;
  const headers = {
    'svix-id': req.headers['svix-id'] as string,
    'svix-timestamp': req.headers['svix-timestamp'] as string,
    'svix-signature': req.headers['svix-signature'] as string,
  };

  try {
    const event = svix.verify(payload, headers) as { type: string; data: any };

    switch (event.type) {
      case 'user.created':
        // Create user in your database
        break;
      case 'user.updated':
        // Update user in your database
        break;
      case 'user.deleted':
        // Delete/deactivate user in your database
        break;
    }

    return reply.send({ received: true });
  } catch (err) {
    return reply.code(400).send({ error: 'Invalid webhook signature' });
  }
}
```

---

## 8. Sources

### Official Clerk Documentation (HIGH Confidence)
- [Fastify Quickstart](https://clerk.com/docs/quickstarts/fastify) - Primary setup guide
- [clerkPlugin() Reference](https://clerk.com/docs/reference/fastify/clerk-plugin) - Plugin configuration
- [getAuth() Reference](https://clerk.com/docs/reference/fastify/get-auth) - Auth extraction
- [Clerk Fastify SDK Overview](https://clerk.com/docs/reference/fastify/overview) - SDK features
- [Session Tokens](https://clerk.com/docs/guides/sessions/session-tokens) - JWT structure
- [Cross-Origin Requests](https://clerk.com/docs/backend-requests/making/cross-origin) - Frontend token passing
- [Google OAuth Setup](https://clerk.com/docs/authentication/social-connections/google) - Google configuration
- [Environment Variables](https://clerk.com/docs/guides/development/clerk-environment-variables) - Required env vars
- [tRPC Integration (Next.js)](https://clerk.com/docs/guides/development/trpc) - tRPC patterns (adapted for Fastify)

### NPM Package (HIGH Confidence)
- [@clerk/fastify on npm](https://www.npmjs.com/package/@clerk/fastify) - Version 2.6.14, Fastify v5 support

### Official Repository (HIGH Confidence)
- [clerk-fastify-quickstart on GitHub](https://github.com/clerk/clerk-fastify-quickstart) - Reference implementation

### tRPC Documentation (HIGH Confidence)
- [tRPC Fastify Adapter](https://trpc.io/docs/server/adapters/fastify) - Context creation pattern

### Changelog (MEDIUM Confidence)
- [Fastify SDK 2.0 Changelog](https://clerk.com/changelog/2024-10-10-fastify-v5-support) - Fastify v5 support announcement

---

## Summary for Requirements Definition

### Install These Packages
```bash
pnpm add @clerk/fastify
```

### Required Environment Variables
```env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### Key Integration Points
1. Register `clerkPlugin` in Fastify before tRPC routes
2. Call `getAuth(req)` in `createContext` to pass auth to tRPC
3. Create `protectedProcedure` middleware that checks `ctx.auth.userId`
4. Frontend passes token via `Authorization: Bearer` header

### What to Tell Kaia (PerseusWeb)
If Kaia's PerseusWeb needs to call Livermore's API:
- Share the same Clerk application (same publishable key)
- Her frontend uses `getToken()` from Clerk React SDK
- Passes token in `Authorization: Bearer ${token}` header
- Both UIs share user identity through Clerk
