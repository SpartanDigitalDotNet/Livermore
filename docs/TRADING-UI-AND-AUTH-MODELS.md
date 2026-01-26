# PerseusWeb: Trading UI Components & Identity Models

This document describes the trading UI components and Google/Auth identity models used in the PerseusWeb project (a cryptocurrency trading platform called "Cryptoon").

---

## Table of Contents

1. [Trading UI Components](#trading-ui-components)
   - [Dashboard Pages](#dashboard-pages)
   - [Navigation Components](#navigation-components)
   - [Routes](#routes)
   - [Technology Stack](#technology-stack)
2. [Authentication & Identity Models](#authentication--identity-models)
   - [Google OAuth Implementation](#google-oauth-implementation)
   - [Authentication Middleware](#authentication-middleware)
   - [Identity Data Models](#identity-data-models)
   - [RBAC System](#rbac-system)
   - [JWT Token Structure](#jwt-token-structure)
3. [File Reference](#file-reference)

---

## Trading UI Components

The trading UI is a cryptocurrency trading platform with exchange, wallet, and market functionality.

### Dashboard Pages

All dashboard pages are EJS templates located in `src/views/pages/dashboard/`.

#### Exchange Page (`exchange.ejs`)

The main trading interface for buying/selling cryptocurrencies.

**Features:**
- Trading pair selection (BTC/USDT, ETH/USDT, BNB/USDT, SOL/USDT)
- Current price display with 24h high/low
- Buy/Sell order forms with price, amount, and total calculation
- Order book display (buy orders in green, sell orders in red)
- Recent trades table with timestamps, pairs, type, price, amount, total, and status

**Layout Structure:**
```
┌─────────────────────────────────────────────────┐
│  Trading Pair Selector  │  Current Price Info   │
├─────────────────────────┼───────────────────────┤
│                         │                       │
│     Buy/Sell Forms      │      Order Book       │
│                         │                       │
├─────────────────────────┴───────────────────────┤
│              Recent Trades Table                │
└─────────────────────────────────────────────────┘
```

#### Wallet Page (`wallet.ejs`)

Cryptocurrency wallet management interface.

**Features:**
- Multi-currency wallet balances (BTC, ETH, USDT)
- USD equivalent display for each holding
- Deposit and Withdraw buttons per currency
- Transaction history table (ID, Type, Currency, Amount, Status, Date)
- Transaction status indicators (Confirmed/Pending)

**Data Structure:**
```typescript
interface WalletBalance {
  currency: string;      // "Bitcoin", "Ethereum", "Tether"
  symbol: string;        // "BTC", "ETH", "USDT"
  amount: number;        // Crypto amount
  usdValue: number;      // USD equivalent
}

interface Transaction {
  id: string;            // Transaction ID
  type: "Deposit" | "Withdraw";
  currency: string;
  amount: number;
  status: "Confirmed" | "Pending";
  date: Date;
}
```

#### Market Page (`market.ejs`)

Market data and cryptocurrency price information.

**Features:**
- Market statistics cards (Total Market Cap, 24h Volume, BTC Dominance)
- Trending cryptocurrencies with price cards
- Price change percentages (green for gains, red for losses)
- Full cryptocurrency table with rank, name, price, 24h change, volume, market cap
- Trade button for each cryptocurrency

#### Dashboard Home (`index.ejs`)

Main overview/landing page after login.

**Features:**
- Stats cards (Total Balance, BTC Balance, ETH Balance, Transaction Count)
- Recent transactions summary
- Quick action cards linking to Exchange, Wallet, Market
- Portfolio overview

### Navigation Components

#### Sidebar (`partials/sidebar.ejs`)

Main navigation with trading section access:
- Dashboard (Analytics Report)
- Wallet (Crypto Wallet)
- Exchange (Crypto Asset Exchange)
- Market (Market CryptoPrice)

#### Header (`partials/header.ejs`)

Top navigation bar with:
- Wallet quick-access button
- Cryptoon platform branding
- Settings/profile access

### Routes

Defined in `src/server/routes/pages.routes.ts`:

| Route | Page | Description |
|-------|------|-------------|
| `GET /` | Dashboard | Main overview page |
| `GET /wallet` | Wallet | Asset management |
| `GET /exchange` | Exchange | Trading interface |
| `GET /market` | Market | Price data |

### Technology Stack

| Technology | Purpose |
|------------|---------|
| **EJS** | Server-side template rendering |
| **Tailwind CSS** | Styling with dark mode support |
| **Alpine.js** | Reactive UI components |
| **Fastify** | Backend server framework |
| **Font Awesome** | Navigation icons |
| **Custom SVGs** | Trading-specific icons |

---

## Authentication & Identity Models

### Google OAuth Implementation

The project uses Google OAuth 2.0 with both traditional redirect flow and popup modal flow.

#### Plugin: `src/server/plugins/google-auth.plugin.ts`

**Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/google` | GET | Initiates OAuth redirect to Google |
| `/auth/google/callback` | GET | Handles authorization code exchange |
| `/auth/google/callback` | POST | Handles JWT from popup modal |

**OAuth Flow (Traditional):**
```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │────▶│ /auth/   │────▶│  Google  │
│          │     │  google  │     │  OAuth   │
└──────────┘     └──────────┘     └────┬─────┘
                                       │
┌──────────┐     ┌──────────┐          │
│  Client  │◀────│ /auth/   │◀─────────┘
│ (logged  │     │ google/  │  (auth code)
│   in)    │     │ callback │
└──────────┘     └──────────┘
```

**Popup Modal Flow:**
```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Login   │────▶│  Google  │────▶│  Google  │
│  Page    │     │  One Tap │     │  Auth    │
└──────────┘     └──────────┘     └────┬─────┘
                                       │ JWT
┌──────────┐     ┌──────────┐          │
│  Client  │◀────│  POST    │◀─────────┘
│ (logged  │     │ /auth/   │
│   in)    │     │ google/  │
└──────────┘     │ callback │
                 └──────────┘
```

**Environment Variables:**
```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

### Authentication Middleware

Located at `src/server/middleware/auth.middleware.ts`.

**Public Routes (no auth required):**
- `/auth/login`
- `/auth/signup`
- `/auth/password-reset`
- `/auth/2fa`
- `/auth/google`
- `/auth/google/callback`
- `/public`
- `/assets`
- `/`

**Auth Check Logic:**
1. Check for `auth_token` cookie
2. Check for `Authorization: Bearer <token>` header
3. If no token found, redirect to `/auth/login`
4. (TODO) Verify JWT token signature and expiration

### Identity Data Models

#### User Model (Planned)

Provider-agnostic user representation:

```typescript
interface User {
  id: string;              // UUID
  email: string;           // User's email
  provider_type: ProviderType;  // OAuth provider
  provider_id: string;     // Provider-specific user ID
  display_name: string;    // User's display name
  avatar_url?: string;     // Profile picture URL
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
}

type ProviderType = "google" | "github" | "microsoft" | "apple";
```

#### OAuth Provider Adapter Interface

```typescript
interface OAuthProvider {
  // Verify JWT token from provider
  verifyToken(token: string): Promise<TokenPayload>;

  // Exchange authorization code for tokens
  exchangeCodeForToken(code: string): Promise<TokenResponse>;

  // Fetch user profile from provider
  getProfile(token: string): Promise<UserProfile>;
}
```

### RBAC System

Simplified Role-Based Access Control with 3 roles:

```typescript
enum Role {
  ADMIN = "admin",   // Full system access
  USER = "user",     // Standard user access
  GUEST = "guest"    // Public access only
}

enum Permission {
  MANAGE_USERS = "manage-users",
  EDIT_PROFILE = "edit-profile",
  MANAGE_ROLES = "manage-roles",
  ACCESS_DASHBOARD = "access-dashboard",
  EXPORT_DATA = "export-data"
}
```

**Role-Permission Matrix:**

| Permission | ADMIN | USER | GUEST |
|------------|-------|------|-------|
| manage-users | Yes | No | No |
| edit-profile | Yes | Yes | No |
| manage-roles | Yes | No | No |
| access-dashboard | Yes | Yes | No |
| export-data | Yes | Yes | No |

### JWT Token Structure

Session management uses JWT tokens stored client-side (localStorage).

```typescript
interface JWTPayload {
  userId: string;          // User's UUID
  email: string;           // User's email
  role: Role;              // User's role
  permissions: Permission[]; // Granted permissions
  iat: number;             // Issued at (Unix timestamp)
  exp: number;             // Expiration (15 minutes from iat)
}
```

**Token Lifecycle:**
- **Issued**: On successful authentication
- **Expires**: 15 minutes (900 seconds)
- **Storage**: Client-side localStorage
- **Refresh**: (TODO) Token refresh mechanism not yet implemented

### Auth Pages

| Route | Page | Description |
|-------|------|-------------|
| `/auth/login` | Login | Email/password + Google OAuth |
| `/auth/signup` | Signup | User registration |
| `/auth/password-reset` | Password Reset | Recovery flow |
| `/auth/2fa` | 2FA | Two-factor authentication |

---

## File Reference

### Trading UI Files

| File | Purpose |
|------|---------|
| `src/views/pages/dashboard/exchange.ejs` | Trading interface |
| `src/views/pages/dashboard/wallet.ejs` | Wallet management |
| `src/views/pages/dashboard/market.ejs` | Market data |
| `src/views/pages/dashboard/index.ejs` | Dashboard home |
| `src/views/partials/sidebar.ejs` | Navigation sidebar |
| `src/views/partials/header.ejs` | Top header |
| `src/server/routes/pages.routes.ts` | Page route definitions |

### Authentication Files

| File | Purpose |
|------|---------|
| `src/server/plugins/google-auth.plugin.ts` | Google OAuth plugin |
| `src/server/middleware/auth.middleware.ts` | Auth middleware |
| `src/server/config/environment.ts` | Environment config |
| `src/server/config/environment.database.json` | DB/OAuth config mapping |
| `src/views/pages/auth/login.ejs` | Login page |
| `src/views/pages/auth/signup.ejs` | Signup page |
| `src/views/pages/auth/password-reset.ejs` | Password reset page |
| `src/views/pages/auth/2fa.ejs` | 2FA page |

### Planning Documents

| File | Purpose |
|------|---------|
| `.planning/02-REVISED-ARCHITECTURE.md` | Architecture overview |
| `.planning/02-database-iam-revised-PLAN.md` | Database/IAM plan |
| `.planning/IMPLEMENTATION-BREAKDOWN.md` | Task breakdown |

### Test Files

| File | Purpose |
|------|---------|
| `tests/e2e/auth-pages.spec.ts` | Auth page tests |
| `tests/e2e/auth-navigation.spec.ts` | Auth navigation tests |

---

## Implementation Status

### Implemented

- [x] Google OAuth basic flow
- [x] Google Sign-In popup modal
- [x] Authentication middleware structure
- [x] Login, signup, password reset, 2FA pages
- [x] Environment variable configuration
- [x] Trading UI pages (exchange, wallet, market)
- [x] Navigation components


## TODO

- [ ] JWT verification with Google's public keys
- [ ] Database connection pool
- [ ] IAM schema creation (users, roles, permissions tables)
- [ ] User persistence to database
- [ ] RBAC middleware implementation
- [ ] Token refresh mechanism
- [ ] Password hashing and storage
- [ ] Email verification flow

---

*Last Updated: 2026-01-26*
