---
name: perseus:admin
description: Verify admin UI builds and key component data shapes are correct
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

<objective>
Smoke-test the admin UI by verifying it builds cleanly and that key component interfaces
match the API data shapes. This is a static analysis check — it doesn't require a running server.
</objective>

<critical_rules>
- The admin app is at `apps/admin/` and uses Vite + React + TypeScript.
- The admin dev server runs on port 5173.
- API dev server runs on port 4000 (must be running for admin to fetch data).
- tRPC is used for API communication — types flow from API router to admin client.
- To start admin: `powershell -File scripts/run-admin-dev.ps1`
- To build admin only: `pnpm turbo build --filter=@livermore/admin`
</critical_rules>

<context>
## Key Admin Components

### Network Page (`apps/admin/src/pages/Network.tsx`)
- Queries: `trpc.network.getInstances` and `trpc.network.getActivityLog`
- Refresh interval: 5 seconds
- Renders: InstanceCard grid + ActivityFeed

### InstanceCard (`apps/admin/src/components/network/InstanceCard.tsx`)
**Props:** Single `instance` object with:
- exchangeId, exchangeName, hostname, ipAddress
- connectionState (idle|starting|warming|active|stopping|stopped)
- online (boolean), symbolCount
- connectedAt, lastHeartbeat, lastStateChange, registeredAt
- lastError, lastErrorAt
- adminEmail, adminDisplayName

### ActivityFeed (`apps/admin/src/components/network/ActivityFeed.tsx`)
**Props:**
- `entries`: Array of activity stream entries with `id` (Redis stream ID), `event`, `exchangeName`, `fromState`, `toState`, `adminEmail`, `hostname`, `error`
- `exchanges`: Array of exchange name strings (for filter dropdown)
- `isLoading`: boolean

**Features:**
- Relative time display ("10h ago") + local timezone timestamp
- UTC timestamp on hover (tooltip)
- Exchange filter dropdown
- User filter dropdown
- UTC toggle switch
- Client-side filtering on the 50 fetched entries

### UI Components Used
- Card, CardHeader, CardTitle, CardContent (shadcn/ui)
- Select, SelectContent, SelectItem, SelectTrigger, SelectValue (radix)
- Switch (radix)
- Tooltip, TooltipContent, TooltipProvider, TooltipTrigger (radix)
- Label
- Badge
- lucide-react icons: Activity, CheckCircle, AlertTriangle
</context>

<process>
## 1. Build Check
Build the admin package and its dependencies:
```bash
pnpm turbo build --filter=@livermore/admin
```
Verify clean build with no errors.

## 2. Type Consistency Check
Verify that the tRPC router types match what the admin components expect:

- Read `apps/admin/src/pages/Network.tsx` — confirm it passes `entries`, `exchanges`, `isLoading` to ActivityFeed
- Read `apps/admin/src/components/network/ActivityFeed.tsx` — confirm the interface matches
- Read `apps/admin/src/components/network/InstanceCard.tsx` — confirm the instance shape

## 3. Component Inventory
Glob for all network components and verify they're exported from the barrel:
- `apps/admin/src/components/network/index.ts` should export InstanceCard and ActivityFeed

## 4. Report
- Build status: PASS/FAIL
- Type consistency: any mismatches found
- Component inventory: all expected components present
</process>

<success_criteria>
- [ ] Admin builds cleanly
- [ ] Network page passes correct props to child components
- [ ] ActivityFeed interface matches (entries, exchanges, isLoading)
- [ ] InstanceCard interface matches API data shape
- [ ] Barrel export includes all network components
</success_criteria>
