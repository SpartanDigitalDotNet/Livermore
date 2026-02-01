# Phase 22: Admin UI - Control Panel + Symbols - Research

**Researched:** 2026-02-01
**Domain:** React control panel UI, real-time status display, symbol management
**Confidence:** HIGH

## Summary

Phase 22 builds two Admin UI pages: a **Control Panel** for monitoring/controlling the API runtime, and a **Symbols** page for managing the user's watchlist. The existing infrastructure is comprehensive:

1. **Command infrastructure is complete** - `ControlChannelService` handles all runtime commands (pause, resume, reload-settings, switch-mode, force-backfill, clear-cache, add-symbol, remove-symbol, bulk-add-symbols) via Redis pub/sub with ACK/result flow
2. **Symbol management API is complete** - `symbolRouter` provides search, validate, metrics, and bulkValidate endpoints
3. **Settings UI patterns established** - Phase 21 created Settings page with form/JSON split view, toast notifications, mutation patterns
4. **User settings schema has all fields** - Symbols array, scanner metadata, runtime config already in schema

The key challenge is **real-time status display**: the API's runtime state (paused, running, mode, uptime) is not currently exposed via tRPC. The Admin UI also needs a mechanism to publish commands to Redis (via tRPC mutation) and subscribe to responses.

**Primary recommendation:** Create a new `controlRouter` with endpoints for status polling and command execution. Use polling (5s interval) for status display rather than WebSocket subscriptions - simpler implementation, sufficient for admin dashboard use case. Commands execute via tRPC mutation which publishes to Redis and subscribes to response channel.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Codebase)
| Component | Location | Purpose |
|-----------|----------|---------|
| `ControlChannelService` | `apps/api/src/services/control-channel.service.ts` | Command handling, pub/sub |
| `symbolRouter` | `apps/api/src/routers/symbol.router.ts` | Symbol search, validate, metrics |
| `settingsRouter` | `apps/api/src/routers/settings.router.ts` | Settings CRUD patterns |
| `CommandSchema` | `packages/schemas/src/control/command.schema.ts` | Command/response types |
| `UserSettingsSchema` | `packages/schemas/src/settings/user-settings.schema.ts` | Symbols, scanner fields |

### Supporting (Already in Admin App)
| Library | Version | Purpose |
|---------|---------|---------|
| `@tanstack/react-query` | via tRPC | Data fetching, caching, mutations |
| `sonner` | existing | Toast notifications |
| `@monaco-editor/react` | existing | JSON preview for bulk import |
| `lucide-react` | existing | Icons for status, controls |
| `react-hook-form` | existing | Form handling |

### UI Components to Add (via shadcn)
| Component | Purpose | shadcn Command |
|-----------|---------|----------------|
| Badge | Status indicators (Running, Paused) | `pnpm dlx shadcn@latest add badge` |
| Dialog | Confirmation dialogs, bulk import modal | `pnpm dlx shadcn@latest add dialog` |
| Alert | Warning/info messages | `pnpm dlx shadcn@latest add alert` |
| Tooltip | Symbol metrics on hover | `pnpm dlx shadcn@latest add tooltip` |
| Progress | Backfill/operation progress | `pnpm dlx shadcn@latest add progress` |
| Separator | Section dividers | `pnpm dlx shadcn@latest add separator` |

**Installation:**
```bash
pnpm dlx shadcn@latest add badge dialog alert tooltip progress separator
```

## Architecture Patterns

### Recommended Component Structure
```
apps/admin/src/
├── pages/
│   ├── ControlPanel.tsx       # Main control panel page
│   └── Symbols.tsx            # Symbol management page
├── components/
│   ├── control/
│   │   ├── RuntimeStatus.tsx      # Status card (running/paused, mode, uptime)
│   │   ├── ControlButtons.tsx     # Pause/Resume/Mode buttons
│   │   ├── ActiveSymbols.tsx      # Symbol count and list preview
│   │   ├── ExchangeStatus.tsx     # Exchange connection indicators
│   │   ├── CommandHistory.tsx     # Recent commands panel
│   │   └── ConfirmationDialog.tsx # Destructive command confirmation
│   └── symbols/
│       ├── SymbolWatchlist.tsx    # Main watchlist with enable/disable
│       ├── AddSymbolForm.tsx      # Search + validate + add
│       ├── SymbolRow.tsx          # Individual symbol with metrics
│       ├── BulkImportModal.tsx    # JSON paste, validate, preview
│       ├── ScannerStatus.tsx      # Scanner enabled, last run
│       └── SymbolMetrics.tsx      # Expandable metrics display
```

### Pattern 1: Command Execution via tRPC Mutation

**What:** Admin UI sends commands via tRPC mutation, which publishes to Redis and waits for response
**When to use:** All control commands (pause, resume, clear-cache, etc.)
**Why:** Admin UI cannot connect directly to Redis; tRPC mutation provides type safety and auth

```typescript
// apps/api/src/routers/control.router.ts
export const controlRouter = router({
  /**
   * Execute a control command via Redis pub/sub
   * Publishes to command channel, subscribes to response, returns when complete
   */
  executeCommand: protectedProcedure
    .input(z.object({
      type: CommandTypeSchema,
      payload: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const correlationId = crypto.randomUUID();
      const command: Command = {
        correlationId,
        type: input.type,
        payload: input.payload,
        timestamp: Date.now(),
        priority: PRIORITY[input.type] ?? 50,
      };

      // Create subscriber for response
      const redis = getRedisClient();
      const subscriber = redis.duplicate();
      const responseChannelKey = responseChannel(ctx.auth.userId);

      return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          subscriber.unsubscribe();
          subscriber.quit();
          reject(new TRPCError({ code: 'TIMEOUT', message: 'Command timed out' }));
        }, 30_000);

        subscriber.on('message', (_channel, message) => {
          const response = JSON.parse(message) as CommandResponse;
          if (response.correlationId === correlationId) {
            if (response.status === 'success') {
              clearTimeout(timeout);
              subscriber.unsubscribe();
              subscriber.quit();
              resolve(response);
            } else if (response.status === 'error') {
              clearTimeout(timeout);
              subscriber.unsubscribe();
              subscriber.quit();
              reject(new TRPCError({ code: 'BAD_REQUEST', message: response.message }));
            }
            // 'ack' status is ignored, wait for final status
          }
        });

        await subscriber.subscribe(responseChannelKey);

        // Publish command
        const commandChannelKey = commandChannel(ctx.auth.userId);
        await redis.publish(commandChannelKey, JSON.stringify(command));
      });
    }),
});
```

### Pattern 2: Status Polling with React Query

**What:** Poll API for runtime status every 5 seconds
**When to use:** Runtime status display (UI-CTL-01)
**Why:** Simpler than WebSocket, sufficient refresh rate for admin dashboard

```typescript
// apps/admin/src/pages/ControlPanel.tsx
function ControlPanel() {
  const { data: status, isLoading } = useQuery({
    ...trpc.control.getStatus.queryOptions(),
    refetchInterval: 5000, // Poll every 5 seconds
  });

  // ...
}

// apps/api/src/routers/control.router.ts
getStatus: protectedProcedure.query(async ({ ctx }) => {
  // Access ControlChannelService via server context
  const controlService = getControlChannelService(ctx.auth.userId);

  return {
    isPaused: controlService.paused,
    mode: controlService.currentMode,
    uptime: process.uptime(), // Seconds since API started
    startTime: controlService.startTime,
    monitoredSymbols: controlService.monitoredSymbols,
    exchangeConnected: controlService.isExchangeConnected(),
    queueDepth: await controlService.getQueueDepth(),
  };
}),
```

### Pattern 3: Symbol Watchlist with Optimistic Updates

**What:** Update UI immediately when adding/removing symbols, rollback on error
**When to use:** Symbol add/remove operations
**Why:** Better UX - don't wait for backfill to complete before showing symbol

```typescript
// apps/admin/src/components/symbols/SymbolWatchlist.tsx
const addSymbolMutation = useMutation({
  mutationFn: async (symbol: string) => {
    // First validate
    const validation = await trpcClient.symbol.validate.query({ symbol });
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    // Then execute command
    return trpcClient.control.executeCommand.mutate({
      type: 'add-symbol',
      payload: { symbol: validation.symbol },
    });
  },
  onMutate: async (symbol) => {
    // Cancel in-flight queries
    await queryClient.cancelQueries({ queryKey: ['settings'] });
    // Snapshot
    const previous = queryClient.getQueryData<UserSettings>(['settings']);
    // Optimistically add symbol
    if (previous) {
      queryClient.setQueryData(['settings'], {
        ...previous,
        symbols: [...(previous.symbols ?? []), symbol.toUpperCase()],
      });
    }
    return { previous };
  },
  onError: (err, symbol, context) => {
    // Rollback
    queryClient.setQueryData(['settings'], context?.previous);
    toast.error(`Failed to add symbol: ${err.message}`);
  },
  onSuccess: (data) => {
    toast.success(`Symbol added (backfilling ${data.backfilled ? 'started' : 'pending'})`);
    queryClient.invalidateQueries({ queryKey: ['settings'] });
  },
});
```

### Pattern 4: Confirmation Dialog for Destructive Commands

**What:** Require explicit confirmation before clear-cache and remove-symbol
**When to use:** UI-CTL-07, UI-SYM-03
**Why:** Prevent accidental data loss

```typescript
// apps/admin/src/components/control/ConfirmationDialog.tsx
interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  isLoading?: boolean;
  variant?: 'default' | 'destructive';
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  isLoading = false,
  variant = 'destructive',
}: ConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Pattern 5: Bulk Import with Preview

**What:** Paste JSON array, validate all symbols, show preview, then bulk add
**When to use:** UI-SYM-04
**Why:** Efficient way to add multiple symbols at once

```typescript
// apps/admin/src/components/symbols/BulkImportModal.tsx
function BulkImportModal({ open, onOpenChange }: Props) {
  const [jsonInput, setJsonInput] = useState('');
  const [validationResults, setValidationResults] = useState<ValidationResult[] | null>(null);

  const validateMutation = useMutation({
    mutationFn: (symbols: string[]) =>
      trpcClient.symbol.bulkValidate.query({ symbols }),
    onSuccess: (data) => {
      setValidationResults(data.results);
    },
  });

  const importMutation = useMutation({
    mutationFn: (symbols: string[]) =>
      trpcClient.control.executeCommand.mutate({
        type: 'bulk-add-symbols',
        payload: { symbols },
      }),
    onSuccess: (data) => {
      toast.success(`Added ${data.added} symbols (${data.skipped} skipped)`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const handleValidate = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (!Array.isArray(parsed)) {
        toast.error('Input must be a JSON array');
        return;
      }
      validateMutation.mutate(parsed);
    } catch {
      toast.error('Invalid JSON');
    }
  };

  const handleImport = () => {
    const validSymbols = validationResults
      ?.filter((r) => r.status === 'valid')
      .map((r) => r.symbol) ?? [];

    if (validSymbols.length === 0) {
      toast.error('No valid symbols to import');
      return;
    }

    importMutation.mutate(validSymbols);
  };

  // Render JSON input, validation results preview, import button
}
```

### Anti-Patterns to Avoid

- **WebSocket for status polling:** Overkill for 5-second refresh. Polling is simpler, reliable, and sufficient.
- **Direct Redis from browser:** Not possible. All commands must go through tRPC mutations.
- **Blocking UI during backfill:** Backfill can take 30+ seconds. Use optimistic updates, show progress.
- **No command history persistence:** Client memory is fine for session; don't persist to DB unless required.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Status badges | Custom CSS classes | shadcn Badge component | Consistent styling, variants |
| Confirmation modals | Custom modal | shadcn Dialog | Accessibility, animations |
| Toast notifications | Custom toasts | sonner (already installed) | Stacking, promise support |
| Symbol search | Custom debounced input | Existing symbolRouter.search | Rate-limited, validated |
| Command execution | Direct Redis publish | tRPC mutation + Redis | Auth, type safety |

**Key insight:** The backend infrastructure is complete. Phase 22 is purely UI work wiring existing APIs to components.

## Common Pitfalls

### Pitfall 1: Command Timeout UX
**What goes wrong:** User clicks Pause, mutation hangs for 30 seconds, then times out
**Why it happens:** API not running or not subscribed to command channel
**How to avoid:** Show loading state immediately, provide cancel option, consider shorter timeout (10s) for UI
**Warning signs:** Mutations take longer than 2 seconds for simple commands

### Pitfall 2: Stale Status After Command
**What goes wrong:** User pauses, but status still shows "Running" for 5 seconds
**Why it happens:** Polling interval hasn't elapsed yet
**How to avoid:** After successful command mutation, immediately refetch status:
```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['control', 'status'] });
}
```
**Warning signs:** UI shows stale state after confirmed command

### Pitfall 3: Symbol Add Without Backfill Feedback
**What goes wrong:** User adds symbol, sees it in list, but no data shows for minutes
**Why it happens:** Backfill runs in background, no progress feedback
**How to avoid:** Show "Backfilling..." badge next to new symbols, poll for indicator data
**Warning signs:** User confusion about why new symbol has no data

### Pitfall 4: Bulk Import Rate Limiting
**What goes wrong:** Bulk import of 50 symbols times out or gets rate-limited
**Why it happens:** Each symbol validated against exchange API (100ms delay = 5s total)
**How to avoid:** Show progress during validation, warn user about large imports taking time
**Warning signs:** Bulk validate mutation timing out for large lists

### Pitfall 5: Exchange Status False Positive
**What goes wrong:** "Connected" shown when WebSocket is actually disconnected
**Why it happens:** Status endpoint doesn't check actual WebSocket state
**How to avoid:** CoinbaseAdapter must expose `isConnected()` method that checks actual state
**Warning signs:** Status shows connected but no data flowing

## Code Examples

### Status Card Component

```typescript
// apps/admin/src/components/control/RuntimeStatus.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlayCircle, PauseCircle, Clock, Wifi } from 'lucide-react';

interface RuntimeStatusProps {
  status: {
    isPaused: boolean;
    mode: string;
    uptime: number;
    monitoredSymbols: string[];
    exchangeConnected: boolean;
  } | null;
  isLoading: boolean;
}

export function RuntimeStatus({ status, isLoading }: RuntimeStatusProps) {
  if (isLoading || !status) {
    return <Card><CardContent className="py-8 text-center">Loading...</CardContent></Card>;
  }

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Runtime Status
          <Badge variant={status.isPaused ? 'secondary' : 'default'}>
            {status.isPaused ? (
              <><PauseCircle className="h-3 w-3 mr-1" /> Paused</>
            ) : (
              <><PlayCircle className="h-3 w-3 mr-1" /> Running</>
            )}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-500" />
            <span className="text-sm">Uptime: {formatUptime(status.uptime)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Wifi className={`h-4 w-4 ${status.exchangeConnected ? 'text-green-500' : 'text-red-500'}`} />
            <span className="text-sm">
              Exchange: {status.exchangeConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        <div>
          <span className="text-sm text-gray-500">Mode: </span>
          <Badge variant="outline">{status.mode}</Badge>
        </div>
        <div>
          <span className="text-sm text-gray-500">
            Symbols: {status.monitoredSymbols.length} active
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Control Buttons Component

```typescript
// apps/admin/src/components/control/ControlButtons.tsx
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmationDialog } from './ConfirmationDialog';

interface ControlButtonsProps {
  isPaused: boolean;
  currentMode: string;
  onPause: () => void;
  onResume: () => void;
  onModeChange: (mode: string) => void;
  onClearCache: (scope: string) => void;
  isExecuting: boolean;
}

export function ControlButtons({
  isPaused,
  currentMode,
  onPause,
  onResume,
  onModeChange,
  onClearCache,
  isExecuting,
}: ControlButtonsProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <div className="flex items-center gap-4">
      {/* Pause/Resume */}
      {isPaused ? (
        <Button onClick={onResume} disabled={isExecuting}>
          <Play className="h-4 w-4 mr-2" />
          Resume
        </Button>
      ) : (
        <Button onClick={onPause} disabled={isExecuting} variant="secondary">
          <Pause className="h-4 w-4 mr-2" />
          Pause
        </Button>
      )}

      {/* Mode Switcher */}
      <Select value={currentMode} onValueChange={onModeChange} disabled={isExecuting}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Select mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="position-monitor">Position Monitor</SelectItem>
          <SelectItem value="scalper-macdv">Scalper MACD-V</SelectItem>
          <SelectItem value="scalper-orderbook" disabled>Scalper Orderbook (v4.1)</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear Cache */}
      <Button
        variant="destructive"
        onClick={() => setShowClearConfirm(true)}
        disabled={isExecuting}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Clear Cache
      </Button>

      <ConfirmationDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear Cache"
        description="This will delete all cached candles and indicators. You'll need to wait for backfill to complete before data is available again."
        confirmLabel="Clear All"
        onConfirm={() => {
          onClearCache('all');
          setShowClearConfirm(false);
        }}
        isLoading={isExecuting}
      />
    </div>
  );
}
```

### Symbol Row Component

```typescript
// apps/admin/src/components/symbols/SymbolRow.tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface SymbolRowProps {
  symbol: string;
  enabled: boolean;
  metrics?: {
    price: string;
    volume24h: string;
    priceChange24h: string;
  } | null;
  isBackfilling?: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}

export function SymbolRow({
  symbol,
  enabled,
  metrics,
  isBackfilling,
  onToggle,
  onRemove,
}: SymbolRowProps) {
  const [expanded, setExpanded] = useState(false);

  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    return num < 1 ? num.toFixed(6) : num.toFixed(2);
  };

  const formatChange = (change: string) => {
    const num = parseFloat(change);
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  };

  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={onToggle} />
          <span className="font-mono font-medium">{symbol}</span>
          {isBackfilling && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Backfilling
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-4">
          {metrics && (
            <Tooltip>
              <TooltipTrigger>
                <div className="text-sm text-right">
                  <div className="font-medium">${formatPrice(metrics.price)}</div>
                  <div className={parseFloat(metrics.priceChange24h) >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatChange(metrics.priceChange24h)}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>24h Volume: ${parseFloat(metrics.volume24h).toLocaleString()}</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          <Button variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>

      {expanded && metrics && (
        <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Price</span>
            <div className="font-medium">${formatPrice(metrics.price)}</div>
          </div>
          <div>
            <span className="text-gray-500">24h Change</span>
            <div className={parseFloat(metrics.priceChange24h) >= 0 ? 'text-green-600' : 'text-red-600'}>
              {formatChange(metrics.priceChange24h)}
            </div>
          </div>
          <div>
            <span className="text-gray-500">24h Volume</span>
            <div className="font-medium">${parseFloat(metrics.volume24h).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WebSocket for all real-time | Polling for low-frequency status | 2025 best practice | Simpler implementation |
| Custom toast implementation | sonner library | shadcn recommendation | Better UX, less code |
| Modal for every action | Inline controls + confirmation dialogs | Modern UI patterns | Faster interactions |

**Deprecated/outdated:**
- **shadcn Toast component:** Use sonner instead
- **Direct state management for server data:** Use React Query

## Open Questions

1. **Command History Persistence**
   - What we know: UI-CTL-06 wants command history panel
   - What's unclear: Should history persist in DB or just session memory?
   - Recommendation: Session memory for now (store in React state). Can add DB persistence later if needed.

2. **Exchange Status Granularity**
   - What we know: UI-CTL-05 wants connection status indicators
   - What's unclear: What statuses exist? (connected, connecting, disconnected, error?)
   - Recommendation: Expose `CoinbaseAdapter.connectionState` enum, show appropriate icon/badge

3. **Scanner Status Display**
   - What we know: UI-SYM-05 wants scanner status (enabled, last run, exchange)
   - What's unclear: Scanner doesn't exist yet - fields are in schema but no implementation
   - Recommendation: Show fields from settings if populated, otherwise show "Not configured"

4. **API Instance Access**
   - What we know: `controlRouter` needs access to `ControlChannelService` instance
   - What's unclear: How to access service instance from tRPC context?
   - Recommendation: Store service reference in a module-level registry keyed by userId, or pass via context from server.ts

## Sources

### Primary (HIGH confidence)
- `apps/api/src/services/control-channel.service.ts` - Complete command handlers
- `apps/api/src/routers/symbol.router.ts` - Symbol validation/search endpoints
- `apps/admin/src/pages/Settings.tsx` - Existing form/mutation patterns
- `packages/schemas/src/control/command.schema.ts` - Command types
- `packages/schemas/src/settings/user-settings.schema.ts` - Settings schema

### Secondary (MEDIUM confidence)
- [shadcn/ui Badge](https://ui.shadcn.com/docs/components/badge) - Status indicator component
- [shadcn/ui Dialog](https://ui.shadcn.com/docs/components/dialog) - Confirmation modal component
- [shadcn.io Status Dashboard](https://www.shadcn.io/components/navbar/navbar-18) - Navigation bar with status indicators
- [TanStack Query patterns](https://tanstack.com/query/latest) - Polling, mutations, optimistic updates

### Tertiary (LOW confidence)
- WebSearch for polling vs WebSocket patterns - general best practices

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in codebase
- Architecture patterns: HIGH - extending existing patterns exactly
- Command execution: HIGH - infrastructure already complete
- Status display: MEDIUM - need to expose new endpoint from existing service
- Symbol management: HIGH - all APIs exist, just need UI

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - stable UI patterns)
