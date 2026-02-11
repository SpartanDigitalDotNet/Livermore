# Phase 33: Admin UI Network View - Research

**Researched:** 2026-02-10
**Domain:** React Admin UI - Perseus Network Dashboard
**Confidence:** HIGH

## Summary

Phase 33 adds a "Network" page to the existing Livermore Admin UI (`apps/admin/`) that displays live status of all Perseus Network exchange instances. The Admin UI is a React 19 + Vite SPA using hash-based routing, TanStack Query v5 for data fetching, tRPC v11 for API calls, Tailwind CSS v4 for styling, and shadcn/ui-style components (Radix + CVA).

The backend API already has the `network` tRPC router fully implemented (`apps/api/src/routers/network.router.ts`) with three procedures: `getInstances`, `getActivityLog`, and `getExchangeStatus`. The schemas for `InstanceStatus` and `NetworkActivityEntry` are also complete. The front-end work is purely UI construction using established codebase patterns.

**Primary recommendation:** Follow the exact patterns from ControlPanel.tsx (polling with `refetchInterval`, tRPC options proxy, Card/Badge components) to build the Network page. All data structures and API endpoints already exist -- this is a UI-only phase.

## Standard Stack

The stack is already established in the codebase. No new libraries are needed.

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.0.0 | UI framework | Already in use |
| @tanstack/react-query | 5.64.2 | Server state, polling | Already in use, provides refetchInterval |
| @trpc/client | 11.0.2 | Type-safe API client | Already in use |
| @trpc/tanstack-react-query | 11.0.2 | tRPC + TanStack Query integration | Already in use |
| Tailwind CSS | 4.0.0 | Utility-first CSS | Already in use |
| lucide-react | 0.474.0 | Icons | Already in use throughout admin |
| class-variance-authority | 0.7.1 | Component variants (Badge) | Already in use |

### Supporting (Already Installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @radix-ui/react-tooltip | 1.2.8 | Tooltip for heartbeat/IP details | Already available |
| sonner | 2.0.7 | Toast notifications | Already available for error toasts |
| clsx + tailwind-merge | 2.1.1 / 3.0.1 | Conditional class merging via `cn()` | Already available at `@/lib/utils` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling (refetchInterval) | WebSocket/SSE | Polling matches existing ControlPanel pattern; WS would be over-engineered for 5s refresh |
| No new deps | date-fns for uptime formatting | Hand-roll `formatUptime` like RuntimeStatus.tsx already does |

**Installation:** No new packages needed. Zero `npm install` required.

## Architecture Patterns

### Recommended Project Structure
```
apps/admin/src/
  pages/
    Network.tsx              # Main page component (new)
  components/
    network/
      index.ts               # Barrel exports (new)
      InstanceCard.tsx        # Per-exchange instance card (new)
      ActivityFeed.tsx        # Scrollable activity log (new)
```

### Pattern 1: Hash-Based Routing (Existing)

**What:** The admin app uses `window.location.hash` for routing. No React Router.
**When to use:** Adding the Network page.
**How it works:**

In `App.tsx`, add to the header nav:
```typescript
<a
  href="#/network"
  className={`${hash === '#/network' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
>
  Network
</a>
```

In the `HashRouter` switch:
```typescript
case '#/network':
  return <Network />;
```

### Pattern 2: tRPC Query with Polling (Existing ControlPanel Pattern)

**What:** Use `useQuery` with `refetchInterval` for periodic data refresh.
**When to use:** Fetching instance status every 5 seconds.
**Example (from ControlPanel.tsx):**
```typescript
const { data, isLoading, error } = useQuery({
  ...trpc.network.getInstances.queryOptions(),
  refetchInterval: 5000,
});
```

The tRPC options proxy pattern used throughout the codebase:
```typescript
// Import from lib/trpc.ts
import { trpc } from '@/lib/trpc';

// Use with useQuery (TanStack Query v5 syntax)
useQuery(trpc.network.getInstances.queryOptions())
useQuery(trpc.network.getActivityLog.queryOptions({ count: 50 }))
```

### Pattern 3: Card-Based Layout (Existing)

**What:** All pages use `Card`, `CardHeader`, `CardTitle`, `CardContent` from `@/components/ui/card`.
**When to use:** Instance cards and activity feed container.
**Example:**
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      Title
      <Badge variant="success">Online</Badge>
    </CardTitle>
  </CardHeader>
  <CardContent>
    {/* content */}
  </CardContent>
</Card>
```

### Pattern 4: Badge Variants for Status (Existing)

**What:** Badge component with `variant` prop for color-coded status.
**Available variants:** `default`, `secondary`, `destructive`, `outline`, `success`, `warning`
**Mapping for connection states:**

| ConnectionState | Badge Variant | Color |
|-----------------|---------------|-------|
| `active` | `success` | Green |
| `starting` | `outline` (custom blue) | Blue |
| `warming` | `warning` | Yellow |
| `stopping` | `warning` | Yellow |
| `stopped` | `secondary` | Gray |
| `idle` | `secondary` | Gray |
| Offline (no key) | `destructive` | Red |

### Pattern 5: Loading State (Existing)

**What:** Spinner shown while data loads.
**Example (used in every page):**
```typescript
if (isLoading) {
  return (
    <Card>
      <CardHeader><CardTitle>Network</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
        </div>
      </CardContent>
    </Card>
  );
}
```

### Pattern 6: Icon Usage (Existing)

**What:** lucide-react icons used inline with text.
**Common icons already imported elsewhere:**
- `Wifi`, `WifiOff` - connection status
- `Clock` - time/uptime
- `Loader2` - loading spinner
- `CheckCircle`, `XCircle` - success/error
- `AlertCircle` - warnings

**Relevant icons for Network page:**
- `Server` or `Monitor` - instance representation
- `Activity` - activity feed
- `Wifi` / `WifiOff` - online/offline
- `Clock` - uptime/heartbeat
- `AlertTriangle` - errors

### Anti-Patterns to Avoid
- **Do NOT use React Router:** The app uses hash-based routing with a switch statement. Do not add react-router-dom.
- **Do NOT use WebSocket for refresh:** The existing pattern is polling via `refetchInterval`. Stick with it for consistency.
- **Do NOT create a separate tRPC client:** Use the existing `trpc` options proxy from `@/lib/trpc`.
- **Do NOT use `trpcClient` directly for queries:** Use `useQuery(trpc.network.getInstances.queryOptions())` pattern, not `trpcClient.network.getInstances.query()`.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Uptime formatting | Custom date library | Copy `formatUptime()` from RuntimeStatus.tsx | Already exists, tested |
| Relative time display | Custom relative time | Copy `formatRelativeTime()` from CommandHistory.tsx | Already exists |
| Status color coding | Custom CSS classes | Badge component with variants | Already has success/warning/destructive |
| Tooltip for details | Custom hover popover | Radix Tooltip from `@/components/ui/tooltip` | Already installed |
| Loading states | Custom skeleton | Standard spinner pattern from other pages | Consistent UX |
| API data fetching | Custom fetch wrapper | tRPC options proxy + useQuery | Type-safe, handles caching |
| Class merging | String concatenation | `cn()` from `@/lib/utils` | Handles Tailwind conflicts |

**Key insight:** This phase is assembling existing components and patterns into a new page. The only truly new code is the InstanceCard and ActivityFeed components, and even those follow established patterns closely.

## Common Pitfalls

### Pitfall 1: Forgetting to Add Route AND Navigation Link
**What goes wrong:** Page component created but unreachable because either the nav link or the route case was missed.
**Why it happens:** Routing is split across two places in App.tsx (header nav and HashRouter switch).
**How to avoid:** Both the `<a href="#/network">` nav link AND the `case '#/network':` in HashRouter must be added.
**Warning signs:** Page renders at direct URL but clicking nav doesn't work, or vice versa.

### Pitfall 2: Polling Interval Continues When Tab is Hidden
**What goes wrong:** Unnecessary API calls when user is on a different tab.
**Why it happens:** `refetchInterval` keeps firing by default.
**How to avoid:** The existing `queryClient` has `refetchOnWindowFocus: false` set globally. TanStack Query v5 pauses refetch intervals for hidden tabs by default, so this is handled automatically.
**Warning signs:** High API load from idle tabs.

### Pitfall 3: Stale Heartbeat Calculation
**What goes wrong:** Heartbeat latency shows "NaN" or negative values.
**Why it happens:** `lastHeartbeat` is an ISO string from the server. Client clock may differ from server.
**How to avoid:** Calculate latency as `Date.now() - new Date(status.lastHeartbeat).getTime()`. Accept that clock skew might make values slightly off. Use generous thresholds (10s/30s per DIFF-02).
**Warning signs:** Heartbeat latency shows as negative or wildly large.

### Pitfall 4: Dead Instance Card Shows No Data
**What goes wrong:** Offline instances have `status: null` from the API, so the card is empty.
**Why it happens:** The `getInstances` endpoint returns `status: null` when the Redis key has expired.
**How to avoid:** For offline instances, still display the exchange name and display name from the DB data (always returned). Show "Offline" badge with `destructive` variant. For UI-03, note that the most recent stream entry can provide last-known info, but implementing this requires a separate `getActivityLog` call. The simplest approach: show exchange name + "Offline" + "Last seen: unknown" when status is null. A stretch goal is to fetch the most recent stream entry per exchange.
**Warning signs:** Blank cards with no information for offline exchanges.

### Pitfall 5: Activity Feed Entries Have String Fields
**What goes wrong:** Treating activity log entry fields as typed objects when they're flat string key-value maps.
**Why it happens:** Redis Streams store everything as strings. The network router's `parseStreamEntry` returns `Record<string, string> & { id: string }`.
**How to avoid:** Access fields directly as strings: `entry.event`, `entry.fromState`, `entry.toState`, `entry.error`, `entry.exchangeName`, etc. Do not try to parse nested objects.
**Warning signs:** `undefined` values when accessing entry properties.

### Pitfall 6: Discord Notification Integration Location
**What goes wrong:** Putting Discord notification logic in the tRPC router (frontend-triggered).
**Why it happens:** DIFF-04 says "Discord notifications for instance state changes" and this phase is about the UI.
**How to avoid:** Discord notifications for state changes should be triggered server-side, in the instance lifecycle code (where state transitions happen), NOT in the UI layer or the tRPC router. The `DiscordNotificationService` already exists as a singleton at `apps/api/src/services/discord-notification.service.ts`. Use `getDiscordService().sendSystemNotification()` in the state machine transition handler, not in the UI polling loop.
**Warning signs:** Duplicate notifications when multiple admins have the page open.

## Code Examples

### Example 1: Network Page (Main Component)
```typescript
// apps/admin/src/pages/Network.tsx
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InstanceCard } from '@/components/network/InstanceCard';
import { ActivityFeed } from '@/components/network/ActivityFeed';

export function Network() {
  const {
    data: instanceData,
    isLoading: instancesLoading,
    error: instancesError,
  } = useQuery({
    ...trpc.network.getInstances.queryOptions(),
    refetchInterval: 5000,
  });

  const {
    data: activityData,
    isLoading: activityLoading,
  } = useQuery({
    ...trpc.network.getActivityLog.queryOptions({ count: 50 }),
    refetchInterval: 5000,
  });

  // Loading state...
  // Error state...

  return (
    <div className="space-y-6">
      {/* Instance Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {instanceData?.instances.map((inst) => (
          <InstanceCard key={inst.exchangeId} instance={inst} />
        ))}
      </div>

      {/* Activity Feed */}
      <ActivityFeed entries={activityData?.entries ?? []} />
    </div>
  );
}
```

### Example 2: Instance Card Component
```typescript
// apps/admin/src/components/network/InstanceCard.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { InstanceStatus } from '@livermore/schemas';

interface InstanceCardProps {
  instance: {
    exchangeId: number;
    exchangeName: string;
    displayName: string;
    online: boolean;
    status: InstanceStatus | null;
  };
}

// Map connection states to badge variants
function getStateBadge(online: boolean, state?: string) {
  if (!online) return { variant: 'destructive' as const, label: 'Offline' };
  switch (state) {
    case 'active': return { variant: 'success' as const, label: 'Active' };
    case 'starting': return { variant: 'outline' as const, label: 'Starting' };
    case 'warming': return { variant: 'warning' as const, label: 'Warming' };
    case 'stopping': return { variant: 'warning' as const, label: 'Stopping' };
    case 'stopped': return { variant: 'secondary' as const, label: 'Stopped' };
    default: return { variant: 'secondary' as const, label: 'Idle' };
  }
}

// Calculate heartbeat age and return color class
function getHeartbeatColor(lastHeartbeat: string | undefined): string {
  if (!lastHeartbeat) return 'text-gray-400';
  const ageMs = Date.now() - new Date(lastHeartbeat).getTime();
  const ageSec = ageMs / 1000;
  if (ageSec < 10) return 'text-green-500';
  if (ageSec < 30) return 'text-yellow-500';
  return 'text-red-500';
}
```

### Example 3: Uptime Formatting (Reuse from RuntimeStatus)
```typescript
// Same pattern as RuntimeStatus.tsx formatUptime
function formatUptime(connectedAt: string | null): string {
  if (!connectedAt) return 'N/A';
  const seconds = Math.floor((Date.now() - new Date(connectedAt).getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `<1m`;
}
```

### Example 4: Activity Feed Entry Rendering
```typescript
// Activity entries are flat string maps from Redis Streams
function renderActivityEntry(entry: Record<string, string> & { id: string }) {
  const isError = entry.event === 'error';
  const isTransition = entry.event === 'state_transition';

  // Redis stream ID format: "1234567890123-0" where first part is ms timestamp
  const timestamp = new Date(parseInt(entry.id.split('-')[0]));

  if (isTransition) {
    return `${entry.exchangeName}: ${entry.fromState} -> ${entry.toState}`;
  }
  if (isError) {
    return `${entry.exchangeName}: Error - ${entry.error}`;
  }
}
```

### Example 5: Discord Notification for State Changes (Server-Side)
```typescript
// In the state machine / lifecycle handler (NOT in UI code)
import { getDiscordService } from './services/discord-notification.service';

const discord = getDiscordService();
await discord.sendSystemNotification(
  `Perseus Network: ${exchangeName}`,
  `State changed: ${fromState} -> ${toState} (${hostname})`
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tRPC v10 `trpc.useQuery()` | tRPC v11 `useQuery(trpc.xxx.queryOptions())` | tRPC v11 | Query options are composed separately from hooks |
| `createTRPCReact()` | `createTRPCOptionsProxy()` | tRPC v11 | Options proxy pattern used in this codebase |
| React Router v6 | Hash-based routing (custom) | Project decision | Keep using hash routing, do not add React Router |
| Tailwind v3 (config file) | Tailwind v4 (@import "tailwindcss") | Tailwind v4 | CSS-first config, import in index.css |

**Deprecated/outdated:**
- tRPC v10 hook patterns (`trpc.xxx.useQuery()`) -- this codebase uses v11 options proxy
- Global `queryClient.invalidateQueries()` with string keys -- use tRPC query key helpers

## API Contract Summary

### `network.getInstances` (no input)
Returns:
```typescript
{
  instances: Array<{
    exchangeId: number;
    exchangeName: string;
    displayName: string;
    online: boolean;          // false when Redis key expired
    status: InstanceStatus | null;  // null when offline
  }>;
}
```

### `network.getActivityLog` (input: { exchangeName?, count?, cursor? })
Returns:
```typescript
{
  entries: Array<Record<string, string> & { id: string }>;
  nextCursor: string | null;
}
```

Entry fields (flat strings from Redis Stream):
- `event`: "state_transition" | "error"
- `timestamp`: ISO string
- `exchangeId`, `exchangeName`, `hostname`, `ip`
- For state_transition: `fromState`, `toState`, `adminEmail`
- For error: `error`, `state`

### `network.getExchangeStatus` (input: { exchangeId: number })
Returns:
```typescript
{
  online: boolean;
  status: InstanceStatus | null;
}
```

## InstanceStatus Fields Reference

From `@livermore/schemas`:
```typescript
{
  exchangeId: number;
  exchangeName: string;
  hostname: string;
  ipAddress: string | null;
  adminEmail: string | null;
  adminDisplayName: string | null;
  connectionState: 'idle' | 'starting' | 'warming' | 'active' | 'stopping' | 'stopped';
  symbolCount: number;
  connectedAt: string | null;      // ISO - set when entering 'active'
  lastHeartbeat: string;           // ISO - updated every 15s
  lastStateChange: string;         // ISO
  registeredAt: string;            // ISO
  lastError: string | null;
  lastErrorAt: string | null;
}
```

Heartbeat constants:
- Interval: 15 seconds
- TTL: 45 seconds (3x interval)
- Key: `exchange:{exchangeId}:status`

## Open Questions

1. **Dead instance last-known info (UI-03)**
   - What we know: When a Redis key expires, `getInstances` returns `status: null`. The activity stream retains historical entries.
   - What's unclear: Should the UI make a separate `getActivityLog` call per offline exchange to show last-known data? Or is exchange name + "Offline" sufficient?
   - Recommendation: Start with exchange name + "Offline" badge from the DB data (always available). Optionally fetch last activity entry as a follow-up enhancement. The activity feed at the bottom already shows recent events globally.

2. **Discord notification trigger location (DIFF-04)**
   - What we know: `DiscordNotificationService` exists as a singleton with `sendSystemNotification()`. Server already sends Discord notifications for startup/shutdown.
   - What's unclear: Where exactly should state-change Discord notifications be triggered? The state machine transition code is not in the tRPC router -- it's in the instance lifecycle.
   - Recommendation: Add Discord notifications in the same server-side code that handles state transitions (wherever `VALID_TRANSITIONS` is checked and state is persisted to Redis). This is NOT a UI concern. If the state transition code is in a separate package or service, the Discord call should go there.

3. **Nav link ordering**
   - What we know: Current nav order: Portfolio, Signals, Logs, Control, Symbols, Exchange Symbols, Settings.
   - What's unclear: Where should "Network" go in the nav order?
   - Recommendation: Place "Network" after "Control" since they are both operational/monitoring concerns. Final order: Portfolio, Signals, Logs, Control, Network, Symbols, Exchange Symbols, Settings.

## Sources

### Primary (HIGH confidence)
- `apps/admin/src/App.tsx` - Hash routing, navigation, page structure
- `apps/admin/src/lib/trpc.ts` - tRPC v11 options proxy setup
- `apps/admin/src/pages/ControlPanel.tsx` - Polling pattern with refetchInterval
- `apps/admin/src/components/control/RuntimeStatus.tsx` - Status badges, uptime formatting, Card layout
- `apps/admin/src/components/control/CommandHistory.tsx` - Activity list pattern, relative time
- `apps/admin/src/components/ui/badge.tsx` - Badge variants (success, warning, destructive, etc.)
- `apps/admin/src/components/ui/card.tsx` - Card, CardHeader, CardTitle, CardContent
- `apps/admin/package.json` - All dependency versions confirmed
- `apps/api/src/routers/network.router.ts` - Full tRPC router implementation
- `apps/api/src/routers/index.ts` - Network router registered as `network`
- `packages/schemas/src/network/instance-status.schema.ts` - InstanceStatus type, ConnectionState enum, heartbeat constants
- `packages/schemas/src/network/activity-log.schema.ts` - Activity entry schemas
- `packages/cache/src/keys.ts` - Redis key builders for instance status and activity streams
- `apps/api/src/services/discord-notification.service.ts` - Discord webhook service with sendSystemNotification()

### Secondary (MEDIUM confidence)
- TanStack Query v5 refetchInterval behavior for hidden tabs (based on documented default behavior)

### Tertiary (LOW confidence)
- None. All findings are from direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies confirmed from package.json, all patterns confirmed from source code
- Architecture: HIGH - All patterns documented from existing page implementations in the same codebase
- Pitfalls: HIGH - Identified from direct code analysis of the API contract and existing component patterns
- API contract: HIGH - Read directly from network.router.ts and schema files

**Research date:** 2026-02-10
**Valid until:** Indefinite (all findings are from the local codebase, not external libraries)
