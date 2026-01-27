# Phase 15: Admin UI - Research

**Researched:** 2026-01-26
**Domain:** React admin dashboard with Clerk authentication, tRPC client, and shadcn/ui components
**Confidence:** HIGH

## Summary

This phase creates a local admin UI for monitoring the Livermore trading system. The UI will be a new `apps/admin` package in the existing Turborepo monorepo, built with:
- **Vite + React + TypeScript** - Fast development, consistent with modern React patterns
- **@clerk/clerk-react** - Client-side authentication matching the existing Clerk backend integration
- **@trpc/tanstack-react-query** - Type-safe API calls to the existing tRPC backend (v11)
- **shadcn/ui + TailwindCSS v4** - Component library for tables, cards, and forms
- **TanStack Table** - Data table library for portfolio and log viewers

The existing backend already has:
- Clerk authentication configured (Phase 13) with `@clerk/fastify` v2.6.17
- tRPC routers exposing `indicator.getPortfolioAnalysis`, `alert.recent`, `position.list`
- JSON log files in `./logs/` directory with structured logging
- AppRouter type exported from `apps/api/src/routers/index.ts`

**Primary recommendation:** Create a minimal Vite React app that imports the `AppRouter` type from the API package. Use the new tRPC v11 TanStack Query integration with `queryOptions()` pattern for cleaner hooks.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vite | ^6.x | Build tool | Fast HMR, native ESM, Turborepo compatible |
| react | ^19.x | UI framework | Standard for modern web apps |
| @clerk/clerk-react | ^5.x | Frontend auth | Official Clerk React SDK, matches backend |
| @trpc/client | ^11.x | API client | Matches existing @trpc/server v11 |
| @trpc/tanstack-react-query | ^11.x | React hooks | v11 native React Query integration |
| @tanstack/react-query | ^5.x | Data fetching | Required by tRPC React integration |
| tailwindcss | ^4.x | Styling | Latest version with Vite plugin |
| @tanstack/react-table | ^8.x | Data tables | Headless table library for shadcn |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node | ^22.x | Node types | Path alias resolution in Vite |
| shadcn/ui | latest | Component library | Tables, buttons, cards |
| lucide-react | latest | Icons | UI icons (shadcn dependency) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vite | Next.js | Vite is simpler for SPA, no SSR needed |
| shadcn/ui | MUI, Chakra | shadcn is lighter, TailwindCSS native |
| TanStack Table | AG Grid | TanStack is free, lighter, sufficient for admin |

**Installation:**
```bash
# Create admin app in apps/admin
pnpm create vite@latest apps/admin --template react-ts
cd apps/admin
pnpm add @clerk/clerk-react @trpc/client @trpc/tanstack-react-query @tanstack/react-query @tanstack/react-table tailwindcss @tailwindcss/vite
pnpm add -D @types/node
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add table button card input
```

## Architecture Patterns

### Recommended Project Structure
```
apps/admin/
├── src/
│   ├── main.tsx                 # Entry point with ClerkProvider
│   ├── App.tsx                  # Router and layout
│   ├── index.css                # Tailwind imports
│   ├── lib/
│   │   ├── trpc.ts              # tRPC client setup
│   │   └── utils.ts             # shadcn cn() utility
│   ├── components/
│   │   ├── ui/                  # shadcn components (auto-generated)
│   │   ├── auth/
│   │   │   └── AuthGuard.tsx    # SignedIn/SignedOut wrapper
│   │   ├── layout/
│   │   │   ├── Header.tsx       # UserButton, nav
│   │   │   └── Layout.tsx       # Page wrapper
│   │   ├── portfolio/
│   │   │   ├── PortfolioTable.tsx
│   │   │   └── columns.tsx      # TanStack Table columns
│   │   ├── logs/
│   │   │   └── LogViewer.tsx
│   │   └── signals/
│   │       └── SignalsTable.tsx
│   └── pages/
│       ├── Dashboard.tsx        # Portfolio viewer (UI-01)
│       ├── Logs.tsx             # Log viewer (UI-02)
│       └── Signals.tsx          # Trade signals (UI-03)
├── vite.config.ts
├── tsconfig.json
├── components.json              # shadcn config
└── package.json
```

### Pattern 1: tRPC Client Setup (v11 TanStack Query)
**What:** Create type-safe tRPC client using the new queryOptions pattern
**When to use:** All API calls in the admin UI
**Example:**
```typescript
// src/lib/trpc.ts
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '@livermore/api/routers';

// For SPA (client-side only), use singleton pattern
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3002/trpc',
      headers: async () => {
        // Get Clerk token for authenticated requests
        const token = await window.Clerk?.session?.getToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

// Create options proxy for queryOptions/mutationOptions factories
export const trpc = createTRPCOptionsProxy<AppRouter>(trpcClient);
```

### Pattern 2: Clerk Provider Setup
**What:** Wrap app with ClerkProvider for authentication
**When to use:** Entry point (main.tsx)
**Source:** [Clerk React Quickstart](https://clerk.com/docs/quickstarts/react)
```typescript
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000, // 5 seconds
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>
);
```

### Pattern 3: Auth Guard Component
**What:** Protect routes and show sign-in for unauthenticated users
**When to use:** Wrap all protected pages
**Source:** [Clerk Components](https://clerk.com/docs/react/reference/components/authentication/sign-in)
```typescript
// src/components/auth/AuthGuard.tsx
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import type { ReactNode } from 'react';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
    </>
  );
}
```

### Pattern 4: Portfolio Table with TanStack Table
**What:** Display MACD-V portfolio data in a sortable table
**When to use:** Dashboard/Portfolio page (UI-01)
**Source:** [shadcn Data Table](https://ui.shadcn.com/docs/components/data-table)
```typescript
// src/components/portfolio/columns.tsx
import { ColumnDef } from '@tanstack/react-table';

interface PortfolioSymbol {
  symbol: string;
  price: number | null;
  values: Record<string, number | null>;
  signal: string;
  stage: string;
  liquidity: string;
}

export const columns: ColumnDef<PortfolioSymbol>[] = [
  { accessorKey: 'symbol', header: 'Symbol' },
  {
    accessorKey: 'price',
    header: 'Price',
    cell: ({ row }) => formatPrice(row.getValue('price')),
  },
  { accessorKey: 'values.1h', header: '1h' },
  { accessorKey: 'values.4h', header: '4h' },
  { accessorKey: 'values.1d', header: '1d' },
  { accessorKey: 'signal', header: 'Signal' },
  { accessorKey: 'stage', header: 'Stage' },
  { accessorKey: 'liquidity', header: 'Liquidity' },
];
```

### Pattern 5: Using tRPC with React Query
**What:** Fetch data using tRPC queryOptions
**When to use:** All data fetching in components
```typescript
// src/pages/Dashboard.tsx
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { PortfolioTable } from '@/components/portfolio/PortfolioTable';

const PORTFOLIO_SYMBOLS = [
  'BTC-USD', 'ETH-USD', 'XRP-USD', 'LINK-USD', // ... etc
];

export function Dashboard() {
  const { data, isLoading, error } = useQuery(
    trpc.indicator.getPortfolioAnalysis.queryOptions({
      symbols: PORTFOLIO_SYMBOLS
    })
  );

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <PortfolioTable data={data?.symbols ?? []} />;
}
```

### Anti-Patterns to Avoid
- **Using VITE_CLERK_SECRET_KEY:** Never expose secret key in frontend - only PUBLISHABLE_KEY
- **Importing server code:** Use `import type` for AppRouter to avoid bundling server code
- **Manual query keys:** Use tRPC's queryOptions() which handles keys automatically
- **Skipping auth headers:** All tRPC calls need Clerk token in Authorization header

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Data tables | Custom table component | TanStack Table + shadcn | Sorting, filtering, pagination already solved |
| Auth state | Custom auth context | Clerk useAuth/useUser hooks | Session management, token refresh handled |
| API typing | Manual type definitions | tRPC AppRouter import | End-to-end type safety from server |
| Token refresh | Manual token management | Clerk SDK + httpBatchLink headers | Clerk handles refresh automatically |
| Log parsing | Custom JSON parser | Built-in JSON.parse | Logs are already structured JSON |

**Key insight:** The existing tRPC routers already return the data shapes needed. The admin UI just needs to call them and display the results.

## Common Pitfalls

### Pitfall 1: Missing Clerk Token in API Requests
**What goes wrong:** tRPC calls return 401 Unauthorized
**Why it happens:** Clerk token not passed in Authorization header
**How to avoid:** Configure httpBatchLink with async headers function that gets token from Clerk
**Warning signs:** All API calls fail after signing in successfully

### Pitfall 2: AppRouter Type Import Issues
**What goes wrong:** TypeScript errors about missing types, or server code bundled in client
**Why it happens:** Wrong import syntax or path resolution
**How to avoid:**
1. Use `import type { AppRouter }` (type-only import)
2. Configure TypeScript path alias to reference API package
3. Add `@livermore/api` as a workspace dependency
**Warning signs:** Build includes server code, or type errors about AppRouter

### Pitfall 3: CORS Errors
**What goes wrong:** Browser blocks API requests with CORS error
**Why it happens:** Frontend origin not allowed by API server
**How to avoid:** API already has `origin: true` in CORS config (allows all origins in dev)
**Warning signs:** Network tab shows "CORS error" on preflight requests

### Pitfall 4: TailwindCSS v4 Configuration
**What goes wrong:** Styles not applied, CSS not processing
**Why it happens:** Using v3 config format with v4
**How to avoid:** Use `@import "tailwindcss"` in CSS, not v3 directives. Use @tailwindcss/vite plugin.
**Warning signs:** Utility classes have no effect, no CSS output

### Pitfall 5: Log File Access
**What goes wrong:** Frontend cannot read log files directly
**Why it happens:** Browser cannot access filesystem
**How to avoid:** Create a new tRPC endpoint to serve log data, or use a simple Express endpoint
**Warning signs:** 404 or CORS errors when trying to fetch log files

## Code Examples

Verified patterns from official sources:

### Complete main.tsx
```typescript
// apps/admin/src/main.tsx
// Source: Clerk React Quickstart + TanStack Query docs
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to .env');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>
);
```

### Complete tRPC Client Setup
```typescript
// apps/admin/src/lib/trpc.ts
// Source: tRPC v11 TanStack React Query docs
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../api/src/routers';

const getAuthToken = async (): Promise<string | null> => {
  // Clerk exposes session on window after initialization
  if (typeof window !== 'undefined' && window.Clerk?.session) {
    return window.Clerk.session.getToken();
  }
  return null;
};

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: import.meta.env.VITE_API_URL ?? 'http://localhost:3002/trpc',
      headers: async () => {
        const token = await getAuthToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>(trpcClient);
```

### Complete App.tsx with Routing
```typescript
// apps/admin/src/App.tsx
// Source: Clerk React Quickstart
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import { Dashboard } from './pages/Dashboard';
import { Logs } from './pages/Logs';
import { Signals } from './pages/Signals';

function App() {
  return (
    <>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center bg-gray-100">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <div className="min-h-screen bg-gray-100">
          <header className="bg-white shadow">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
              <h1 className="text-xl font-bold">Livermore Admin</h1>
              <nav className="flex items-center gap-4">
                <a href="#/" className="hover:underline">Portfolio</a>
                <a href="#/logs" className="hover:underline">Logs</a>
                <a href="#/signals" className="hover:underline">Signals</a>
                <UserButton />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8">
            <HashRouter />
          </main>
        </div>
      </SignedIn>
    </>
  );
}

// Simple hash-based router for SPA
function HashRouter() {
  const hash = window.location.hash || '#/';

  switch (hash) {
    case '#/logs':
      return <Logs />;
    case '#/signals':
      return <Signals />;
    default:
      return <Dashboard />;
  }
}

export default App;
```

### vite.config.ts
```typescript
// apps/admin/vite.config.ts
// Source: shadcn Vite docs
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Create React App | Vite | 2023+ | CRA is deprecated, Vite is standard |
| tRPC v10 useQuery | tRPC v11 queryOptions | 2024 | Cleaner API, better TanStack Query alignment |
| TailwindCSS v3 | TailwindCSS v4 | 2025 | Simpler config, Vite plugin, @import syntax |
| Manual token handling | Clerk SDK hooks | N/A | Clerk handles token lifecycle |

**Deprecated/outdated:**
- Create React App: Use Vite instead
- @trpc/react-query classic hooks: Use new queryOptions pattern in v11
- TailwindCSS v3 config: v4 uses different setup (@tailwindcss/vite plugin)

## Open Questions

Things that couldn't be fully resolved:

1. **Log file access from frontend**
   - What we know: Logs are JSON files in `./logs/` directory
   - What's unclear: Frontend cannot access filesystem directly
   - Recommendation: Create a new tRPC endpoint `logs.getRecent` that reads and parses log files server-side, filtering by level (error/warning)

2. **Real-time updates**
   - What we know: tRPC v11 supports SSE subscriptions
   - What's unclear: Whether real-time updates are needed for admin UI
   - Recommendation: Start with polling (refetch every 30s), add subscriptions later if needed

3. **Portfolio symbol list**
   - What we know: Scripts hardcode symbol list, server reads from Coinbase account
   - What's unclear: Should admin UI hardcode symbols or fetch from API?
   - Recommendation: Add a `position.getSymbols` endpoint that returns monitored symbols

## Data Sources Mapping

| UI Requirement | Existing Data Source | tRPC Endpoint |
|----------------|---------------------|---------------|
| UI-01: Portfolio viewer | Redis (indicator cache) | `indicator.getPortfolioAnalysis` |
| UI-02: Log viewer | `./logs/*.log` files | **NEW: needs endpoint** |
| UI-03: Trade signals | PostgreSQL (alert_history) | `alert.recent` |
| UI-04: Sign-in | Clerk | `@clerk/clerk-react` components |

### Required New Endpoint for Logs (UI-02)

The current codebase has no endpoint for reading logs. The log viewer will need a new tRPC endpoint:

```typescript
// apps/api/src/routers/logs.router.ts (NEW FILE)
import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');

export const logsRouter = router({
  getRecent: protectedProcedure
    .input(z.object({
      level: z.enum(['ERROR', 'WARN', 'INFO']).optional(),
      limit: z.number().int().positive().max(500).default(100),
    }))
    .query(async ({ input }) => {
      const { level, limit } = input;
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(LOG_DIR, `livermore-${today}.log`);

      // Read and parse log file
      const content = readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n');

      let entries = lines.map(line => JSON.parse(line));

      // Filter by level if specified
      if (level) {
        entries = entries.filter(e => e.level === level ||
          (level === 'WARN' && e.level === 'ERROR'));
      }

      // Return most recent entries
      return entries.slice(-limit).reverse();
    }),
});
```

## Sources

### Primary (HIGH confidence)
- [Clerk React Quickstart](https://clerk.com/docs/quickstarts/react) - ClerkProvider, SignIn, UserButton setup
- [tRPC React Query Setup](https://trpc.io/docs/client/react/setup) - createTRPCReact, httpBatchLink
- [tRPC TanStack React Query](https://trpc.io/docs/client/tanstack-react-query/setup) - v11 queryOptions pattern
- [shadcn/ui Vite](https://ui.shadcn.com/docs/installation/vite) - Installation and configuration
- [shadcn/ui Data Table](https://ui.shadcn.com/docs/components/data-table) - TanStack Table integration

### Secondary (MEDIUM confidence)
- [TailwindCSS v4 Vite](https://tailwindcss.com/docs/installation/framework-guides) - v4 configuration
- [TanStack Table Docs](https://tanstack.com/table/latest) - Column definitions, sorting, filtering

### Tertiary (LOW confidence)
- WebSearch results for monorepo patterns - Community templates, may vary

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official docs for all libraries, versions verified
- Architecture: HIGH - Patterns from official sources, existing codebase analyzed
- Pitfalls: HIGH - Based on official docs warnings and codebase analysis
- Data sources: HIGH - Existing tRPC routers analyzed, schema verified

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - Clerk and tRPC are stable)
