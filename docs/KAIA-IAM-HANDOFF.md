# Kaia IAM Handoff: PerseusWeb Integration with Livermore

**Created:** 2026-01-27
**For:** Kaia (AI assistant building PerseusWeb)
**Purpose:** Complete context for integrating PerseusWeb with Livermore API and database

## Overview

PerseusWeb is a trading UI that uses **Google OAuth directly** (not Clerk). It shares the same PostgreSQL database as Livermore for user management. This document covers:

1. Database setup with Drizzle ORM (same pattern as Livermore)
2. User sync via the `user.syncFromGoogle` API endpoint
3. Available tRPC endpoints for market data and analysis
4. Future WebSocket integration notes

## 1. Architecture

```
PerseusWeb (React + Google OAuth)
       |
       |  1. User signs in with Google
       |  2. Get googleId (sub claim from JWT)
       |
       v
  user.syncFromGoogle API call ──────────────> Livermore API
       |                                            |
       |                                            v
       |                                    PostgreSQL (shared)
       |                                    - users table
       |                                    - positions
       |                                    - alerts
       |                                            |
       |  3. User record returned                   |
       |<───────────────────────────────────────────|
       |
       v
  PerseusWeb has user.id for all operations
```

**Key insight:** The `identity_sub` (Google's user ID) is the linchpin that connects:
- PerseusWeb sessions to Livermore user records
- Future: user-specific symbol scanning
- Future: exchange connections per user
- Future: WebSocket sessions tied to user identity

## 2. Database Setup

### Connection Details

| Environment | Host | Port | Database | SSL |
|-------------|------|------|----------|-----|
| Local | `localhost` | `5432` | `Livermore` | No |
| Sandbox | Ask Mike for Azure hostname | `5432` | `livermore` | Required |

**Credentials:** Ask Mike for username/password.

### Using Drizzle ORM (Recommended)

PerseusWeb should use the same Drizzle pattern as Livermore. This ensures models stay in sync with the database automatically.

**Step 1: Install dependencies**
```bash
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
```

**Step 2: Create drizzle.config.ts**
```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './drizzle/schema.ts',
  dbCredentials: {
    host: process.env.DATABASE_HOST!,
    port: parseInt(process.env.DATABASE_PORT!),
    user: process.env.DATABASE_USERNAME!,
    password: process.env.DATABASE_PASSWORD!,
    database: process.env.DATABASE_NAME!,
    ssl: process.env.DATABASE_SSL === 'true',
  },
});
```

**Step 3: Pull schema from database**
```bash
pnpm drizzle-kit pull
```

This generates `drizzle/schema.ts` with all table definitions. Re-run this whenever Livermore updates the schema.

**Step 4: Create database client**
```typescript
// src/lib/db.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});

export const db = drizzle(pool, { schema });
```

### Key Tables

After running `drizzle-kit pull`, you'll have these tables (among others):

#### users
```typescript
export const users = pgTable("users", {
  id: serial().primaryKey(),
  username: varchar({ length: 50 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),

  // IAM columns - used for OAuth identity
  identityProvider: varchar("identity_provider", { length: 20 }),  // 'google' or 'clerk'
  identitySub: varchar("identity_sub", { length: 255 }),           // Google user ID
  displayName: varchar("display_name", { length: 100 }),
  identityPictureUrl: text("identity_picture_url"),
  role: varchar({ length: 20 }).default('user').notNull(),         // 'user', 'admin', etc.
  lastLoginAt: timestamp("last_login_at", { mode: 'string' }),

  createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});
```

#### positions
```typescript
export const positions = pgTable("positions", {
  id: serial().primaryKey(),
  userId: serial("user_id").notNull(),        // Foreign key to users.id
  exchangeId: serial("exchange_id").notNull(),
  symbol: varchar({ length: 20 }).notNull(),
  quantity: numeric({ precision: 20, scale: 8 }).notNull(),
  averageCost: numeric("average_cost", { precision: 20, scale: 8 }),
  currentPrice: numeric("current_price", { precision: 20, scale: 8 }),
  // ... more fields
});
```

#### userExchanges
```typescript
export const userExchanges = pgTable("user_exchanges", {
  id: serial().primaryKey(),
  userId: serial("user_id").notNull(),
  exchangeName: varchar("exchange_name", { length: 50 }).notNull(),
  apiKey: varchar("api_key", { length: 500 }).notNull(),
  apiSecret: text("api_secret").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  // ... more fields
});
```

## 3. User Login API (PerseusWeb)

### Important: Registration Flow

**Users must register via LivermoreAdmin first.**

PerseusWeb does NOT create new users. The flow is:
1. User signs in to **LivermoreAdmin** (Clerk) → account created
2. User can now use **PerseusWeb** (Google OAuth) → finds existing account by email

This ensures all users go through the proper onboarding in LivermoreAdmin where they can set up exchanges and symbols.

### Endpoint: `user.loginFromGoogle`

When a user signs in to PerseusWeb with Google OAuth, call this endpoint to authenticate against their existing Livermore user record.

**URL:** `POST /trpc/user.loginFromGoogle`

**Input:**
```typescript
{
  googleId: string;      // Google's 'sub' claim from JWT (for logging)
  email: string;         // User's email - THIS IS THE LOOKUP KEY
  displayName?: string;  // User's name (optional, updates profile)
  pictureUrl?: string;   // Profile picture URL (optional, updates profile)
}
```

**Success Response:**
```typescript
{
  result: {
    data: {
      id: number;                    // Livermore user ID
      username: string;
      email: string;
      identityProvider: string;      // 'clerk' (from LivermoreAdmin registration)
      identitySub: string;           // Clerk ID (preserved, not overwritten)
      displayName: string | null;
      identityPictureUrl: string | null;
      role: string;                  // 'user', 'admin', etc.
      lastLoginAt: string;           // ISO timestamp (updated)
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }
  }
}
```

**Error Response (user not registered):**
```typescript
{
  error: {
    message: "User not found. Please register via LivermoreAdmin first, then return to PerseusWeb.",
    code: "NOT_FOUND"
  }
}
```

**Example call from PerseusWeb:**
```typescript
// After Google OAuth sign-in
const googleUser = getGoogleUserFromJWT(idToken);

try {
  const response = await fetch('http://localhost:3002/trpc/user.loginFromGoogle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json: {
        googleId: googleUser.sub,
        email: googleUser.email,
        displayName: googleUser.name,
        pictureUrl: googleUser.picture,
      }
    }),
  });

  const data = await response.json();

  if (data.error) {
    // User not registered - redirect to LivermoreAdmin
    alert(data.error.message);
    window.location.href = 'https://livermore-admin.example.com';
    return;
  }

  const livermoreUser = data.result.data;
  // Store livermoreUser.id for subsequent API calls

} catch (error) {
  console.error('Login failed:', error);
}
```

### Endpoint: `user.getByEmail`

Check if a user exists before attempting login. Useful for showing appropriate UI.

**URL:** `POST /trpc/user.getByEmail`

**Input:**
```typescript
{ email: string }
```

**Response:** User object or `null`

**Example:**
```typescript
// Check if user can use PerseusWeb
const { result } = await fetch('/trpc/user.getByEmail', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ json: { email: googleUser.email } }),
}).then(r => r.json());

if (!result.data) {
  // Show "Please register via LivermoreAdmin first" message
} else {
  // Proceed with loginFromGoogle
}

## 4. Available tRPC Endpoints

### Base URL
- **Local:** `http://localhost:3002/trpc`
- **Sandbox:** Ask Mike

### Indicator Router (`indicator.*`)

| Procedure | Method | Description |
|-----------|--------|-------------|
| `getAnalysis` | Query | Full MACD-V analysis for symbol |
| `getMACDV` | Query | MACD-V values with stage |
| `getMACDVSeries` | Query | MACD-V data for charting |
| `getPortfolioAnalysis` | Query | Analysis for multiple symbols |
| `getCurrent` | Query | Cached indicator value |
| `getMetadata` | Query | Indicator metadata |

**Example:**
```typescript
// Get MACD-V analysis for BTC
const analysis = await fetch('/trpc/indicator.getAnalysis', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    json: { symbol: 'BTC-USD', timeframe: '1h' }
  }),
});
```

### Alert Router (`alert.*`)

| Procedure | Method | Description |
|-----------|--------|-------------|
| `recent` | Query | Recent alert triggers |
| `bySymbol` | Query | Alerts for specific symbol |
| `byType` | Query | Alerts by type |
| `byId` | Query | Single alert by ID |

### Position Router (`position.*`)

| Procedure | Method | Description |
|-----------|--------|-------------|
| `list` | Query | All positions |
| `portfolio` | Query | Portfolio summary |
| `bySymbol` | Query | Position for symbol |
| `sync` | Mutation | Sync from Coinbase |
| `updateCostBasis` | Mutation | Update cost basis |

### User Router (`user.*`)

| Procedure | Method | Description |
|-----------|--------|-------------|
| `loginFromGoogle` | Mutation | Login existing user via Google OAuth (PerseusWeb) - lookup by email |
| `syncFromClerk` | Mutation | Create/update user from Clerk OAuth (LivermoreAdmin) |
| `getByEmail` | Query | Check if user exists by email |
| `me` | Query | Get current user (requires Clerk auth) |

**Note:** `loginFromGoogle` does NOT create users. Users must register via LivermoreAdmin first.

### Logs Router (`logs.*`) - PROTECTED

Requires Clerk authentication (Admin UI only).

| Procedure | Method | Description |
|-----------|--------|-------------|
| `getRecent` | Query | Recent log entries |
| `getAvailableDates` | Query | Available log dates |

## 5. LivermoreAdmin User Onboarding

LivermoreAdmin (the Clerk-based admin UI) also onboards users seamlessly on login.

**How it works:**
1. User signs in via Clerk (Google OAuth through Clerk)
2. `UserSync` component calls `user.syncFromClerk` with Clerk user data
3. User record created/updated in PostgreSQL
4. User can now set up exchanges and symbols

**This means:**
- Both LivermoreAdmin (Clerk) and PerseusWeb (direct Google) create users in the same `users` table
- Users are differentiated by `identity_provider`: `'clerk'` vs `'google'`
- A user could theoretically have two records if they sign in via both apps (different providers)

**For Kaia:**
- You can sign in to LivermoreAdmin first to create your user record
- Then use that same database when building PerseusWeb
- The `identity_sub` (Clerk ID or Google ID) links sessions to user records

## 6. Running Livermore Locally

Kaia will need to run Livermore API locally for development.

### Environment Variables

Create a `.env` or use PowerShell environment variables:

```bash
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_LIVERMORE_USERNAME=Livermore
DATABASE_LIVERMORE_PASSWORD=<ask Mike>
LIVERMORE_DATABASE_NAME=Livermore

# Redis
REDIS_URL=redis://127.0.0.1:6400

# Coinbase (for market data)
Coinbase_ApiKeyId=<ask Mike>
Coinbase_EcPrivateKeyPem=<ask Mike>

# Discord (for alerts)
DISCORD_LIVERMORE_BOT=<ask Mike>

# Clerk (only needed for Admin UI, not PerseusWeb)
CLERK_PUBLISHABLE_KEY=<ask Mike>
CLERK_SECRET_KEY=<ask Mike>
# CLERK_WEBHOOK_SIGNING_SECRET is optional for local dev
```

### Start Command

```bash
# From Livermore root
pnpm --filter @livermore/api dev
```

Or use the PowerShell script:
```powershell
.\scripts\run-api-dev.ps1
```

The API runs on `http://localhost:3002` by default.

### Running Admin UI (optional)

If you want to test LivermoreAdmin:
```bash
pnpm --filter @livermore/admin dev
```

The Admin UI runs on `http://localhost:5173` by default.

## 7. Future: WebSocket Integration

A near-future milestone includes WebSocket connections between PerseusWeb and Livermore API.

**Planned features:**
- Real-time price updates
- Alert notifications pushed to PerseusWeb
- Live MACD-V indicator updates

**Architecture preview:**
```
PerseusWeb ──WebSocket──> Livermore API
                              |
                              v
                         Redis Pub/Sub
                              |
                              v
                      Coinbase WebSocket
```

The `identity_sub` will be used to authenticate WebSocket connections and route user-specific data.

## 8. Quick Start Checklist

1. [ ] Get database credentials from Mike
2. [ ] Set up Drizzle with `drizzle-kit pull`
3. [ ] Run Livermore API locally (`pnpm --filter @livermore/api dev`)
4. [ ] **Register via LivermoreAdmin first** (required before PerseusWeb works)
5. [ ] Implement Google OAuth in PerseusWeb
6. [ ] On sign-in, call `user.getByEmail` to check if user exists
7. [ ] If exists: call `user.loginFromGoogle` with Google JWT claims
8. [ ] If not exists: show "Please register via LivermoreAdmin first" message
9. [ ] Store returned `user.id` for session
10. [ ] Use tRPC endpoints for market data (`indicator.*`, `alert.*`, `position.*`)

## 9. Contact

For credentials, database access, or API questions:
- **Mike** - Project owner

---

*Document created: 2026-01-27*
*Livermore v3.0 - Admin UI + IAM Foundation*
