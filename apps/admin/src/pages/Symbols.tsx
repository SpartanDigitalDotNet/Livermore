import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SymbolWatchlist, ScannerStatus } from '@/components/symbols';
import { ConfirmationDialog } from '@/components/control';

/**
 * Symbols Page
 *
 * Symbol management page for viewing and managing the user's watchlist.
 *
 * Requirements:
 * - UI-SYM-01: Symbol watchlist display with enable/disable toggles
 * - UI-SYM-05: Scanner status display
 * - UI-SYM-06: Symbol metrics display on hover/expand
 *
 * Note: Add/Remove functionality will be added in Plan 05.
 */
export function Symbols() {
  const queryClient = useQueryClient();

  // Symbol pending removal (for confirmation dialog)
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  // Fetch user settings
  const {
    data: settings,
    isLoading,
    error,
  } = useQuery(trpc.settings.get.queryOptions());

  // Extract symbols and scanner from settings
  const symbols: string[] = (settings as any)?.symbols ?? [];
  const disabledSymbols: string[] = (settings as any)?.disabledSymbols ?? [];
  const scanner = (settings as any)?.scanner ?? null;

  // Handle symbol toggle (enable/disable)
  const handleToggle = async (symbol: string, enabled: boolean) => {
    // For now, just show a toast - actual implementation will use settings.patch
    toast.info(
      `Symbol ${symbol} ${enabled ? 'enabled' : 'disabled'} (save pending)`
    );

    // TODO: In plan 05, this will call executeCommand to update settings
  };

  // Handle remove click (show confirmation)
  const handleRemoveClick = (symbol: string) => {
    setRemovingSymbol(symbol);
    setShowRemoveConfirm(true);
  };

  // Handle confirmed removal
  const handleConfirmRemove = async () => {
    if (!removingSymbol) return;

    try {
      // Execute remove-symbol command
      const result = await trpcClient.control.executeCommand.mutate({
        type: 'remove-symbol',
        payload: { symbol: removingSymbol },
      });

      if (result.success) {
        toast.success(`Symbol ${removingSymbol} removed`);
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      } else {
        toast.error(result.message ?? 'Failed to remove symbol');
      }
    } catch (err: any) {
      toast.error(`Failed to remove symbol: ${err.message}`);
    } finally {
      setShowRemoveConfirm(false);
      setRemovingSymbol(null);
    }
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Symbols</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700">
            Error loading symbols: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Placeholder for Add Symbol form (Plan 05) */}
      <Card>
        <CardHeader>
          <CardTitle>Add Symbol</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-sm">
            Symbol search and add form will be added in the next plan.
          </p>
        </CardContent>
      </Card>

      {/* Scanner Status */}
      <ScannerStatus scanner={scanner} isLoading={isLoading} />

      {/* Symbol Watchlist */}
      <SymbolWatchlist
        symbols={symbols}
        disabledSymbols={disabledSymbols}
        onToggle={handleToggle}
        onRemove={handleRemoveClick}
        removingSymbol={removingSymbol}
        isLoading={isLoading}
      />

      {/* Remove Confirmation Dialog */}
      <ConfirmationDialog
        open={showRemoveConfirm}
        onOpenChange={(open) => {
          setShowRemoveConfirm(open);
          if (!open) setRemovingSymbol(null);
        }}
        title="Remove Symbol"
        description={`Are you sure you want to remove ${removingSymbol} from your watchlist? This will stop monitoring and delete cached data for this symbol.`}
        confirmLabel="Remove"
        onConfirm={handleConfirmRemove}
        isLoading={removingSymbol !== null && !showRemoveConfirm}
      />
    </div>
  );
}
