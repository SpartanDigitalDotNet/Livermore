---
phase: 15-admin-ui
plan: 01
subsystem: frontend
tags: [react, vite, clerk, trpc, tanstack-query, tailwindcss]
dependency_graph:
  requires: [phase-13-clerk-auth, phase-14-webhooks]
  provides: [admin-app-foundation, clerk-react-auth, trpc-client]
  affects: [15-02, 15-03]
tech_stack:
  added:
    - "@clerk/clerk-react@5.20.1"
    - "@tanstack/react-query@5.64.2"
    - "@tanstack/react-table@8.21.2"
    - "@trpc/client@11.0.2"
    - "@trpc/tanstack-react-query@11.0.2"
    - "react@19.0.0"
    - "react-dom@19.0.0"
    - "tailwindcss@4.0.0"
    - "@tailwindcss/vite@4.0.0"
    - "vite@6.0.7"
  patterns:
    - "ClerkProvider for frontend auth"
    - "tRPC queryOptions pattern with TanStack Query"
    - "Hash-based SPA routing"
decisions:
  - id: trpc-options-proxy
    choice: "createTRPCOptionsProxy with queryClient"
    rationale: "tRPC v11 requires queryClient passed to options proxy"
  - id: drizzle-types-fix
    choice: "Add @types/pg to both API and database packages"
    rationale: "pnpm was creating duplicate drizzle-orm instances due to peer dep mismatch"
  - id: shared-query-client
    choice: "Export queryClient from trpc.ts for use in main.tsx"
    rationale: "Single QueryClient instance shared between tRPC and React Query"
key_files:
  created:
    - apps/admin/package.json
    - apps/admin/tsconfig.json
    - apps/admin/vite.config.ts
    - apps/admin/index.html
    - apps/admin/src/main.tsx
    - apps/admin/src/App.tsx
    - apps/admin/src/index.css
    - apps/admin/src/lib/trpc.ts
    - apps/admin/src/lib/utils.ts
    - apps/admin/src/vite-env.d.ts
    - apps/admin/.env.example
  modified:
    - apps/api/package.json
    - packages/database/package.json
    - pnpm-lock.yaml
metrics:
  duration: ~30min
  completed: 2026-01-27
---

# Phase 15 Plan 01: Admin App Foundation Summary

**One-liner:** Vite+React admin app with Clerk auth and tRPC client using v11 queryOptions pattern

## What Was Built

### Admin App Structure
Created `apps/admin/` with:
- Vite 6.x build system with React 19 and TypeScript
- TailwindCSS v4 with @tailwindcss/vite plugin
- Path aliases configured (@/* maps to ./src/*)

### Authentication
- ClerkProvider wrapping app in main.tsx
- SignIn component for unauthenticated users (hash routing)
- SignedIn/SignedOut conditional rendering
- UserButton in header showing user avatar

### tRPC Integration
- tRPC client with httpBatchLink
- Clerk token injection via async headers
- createTRPCOptionsProxy for TanStack Query integration
- Shared QueryClient between tRPC and QueryClientProvider

### UI Foundation
- Header with navigation (Portfolio, Signals, Logs)
- Simple hash-based router (no external library needed for 3 pages)
- Placeholder content for each route
- CSS custom properties for theming

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed drizzle-orm type conflicts**
- **Found during:** Task 2
- **Issue:** TypeScript errors about incompatible drizzle-orm types when importing AppRouter from API package
- **Root cause:** pnpm creating duplicate drizzle-orm instances due to @types/pg peer dependency mismatch
- **Fix:** Added @types/pg as devDependency to both @livermore/api and @livermore/database packages, then rebuilt database package with `tsup --dts`
- **Files modified:** apps/api/package.json, packages/database/package.json, pnpm-lock.yaml
- **Commits:** a5f7ba4

## Verification Results

| Check | Status |
|-------|--------|
| pnpm --filter @livermore/admin type-check | PASS |
| pnpm --filter @livermore/admin dev | PASS (starts on port 5173/5174) |
| Clerk SignIn displays | PASS |
| Hash routing works | PASS |

## User Setup Required

Before running the admin app, the user must:

1. **Create `.env` file** in `apps/admin/`:
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:3002/trpc
```

2. **Get the publishable key** from Clerk Dashboard -> API Keys (same key used for backend)

Note: A `.env` file was created during development using the existing `CLERK_PUBLISHABLE_KEY` from user environment variables.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 0fffc3a | feat | Create admin app with Vite and React |
| a5f7ba4 | feat | Add tRPC client with Clerk auth headers |
| 5fd8c60 | feat | Add Clerk auth with SignIn/SignedIn/SignedOut |

## Next Phase Readiness

**Ready for 15-02 (Portfolio/Signals):**
- tRPC client ready for `indicator.getPortfolioAnalysis` and `alert.recent` calls
- TanStack Table installed for data display
- Header navigation in place

**Ready for 15-03 (Logs):**
- Foundation for log viewer page
- Will need new tRPC endpoint for log file reading (as noted in 15-RESEARCH.md)
