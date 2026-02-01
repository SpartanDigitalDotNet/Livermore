import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SymbolWatchlist,
  ScannerStatus,
  AddSymbolForm,
} from '@/components/symbols';
import { ConfirmationDialog } from '@/components/control';

/**
 * Symbols Page
 *
 * Symbol management page for viewing and managing the user's watchlist.
 *
 * Requirements:
 * - UI-SYM-01: Symbol watchlist display with enable/disable toggles
 * - UI-SYM-02: Add symbol with search + validation against exchange
 * - UI-SYM-03: Remove symbol with confirmation
 * - UI-SYM-05: Scanner status display
 * - UI-SYM-06: Symbol metrics display on hover/expand
 */
export function Symbols() {
  const queryClient = useQueryClient();

  // Symbol pending removal (for confirmation dialog)
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

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
  // Note: For v4.0, this is informational only - actual toggle would require
  // a separate disabledSymbols array in settings and a patch endpoint
  const handleToggle = async (symbol: string, enabled: boolean) => {
    toast.info(
      `Symbol ${symbol} ${enabled ? 'enabled' : 'disabled'} - full toggle support coming in v4.1`
    );
  };

  // Handle remove click (show confirmation)
  const handleRemoveClick = (symbol: string) => {
    setRemovingSymbol(symbol);
    setShowRemoveConfirm(true);
  };

  // Handle confirmed removal
  const handleConfirmRemove = async () => {
    if (!removingSymbol) return;

    setIsRemoving(true);

    try {
      // Execute remove-symbol command
      const result = await trpcClient.control.executeCommand.mutate({
        type: 'remove-symbol',
        payload: { symbol: removingSymbol },
      });

      if (result.success) {
        toast.success(`Symbol ${removingSymbol} removed from watchlist`);
        // Invalidate settings to refetch updated symbol list
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      } else {
        toast.error(result.message ?? 'Failed to remove symbol');
      }
    } catch (err: any) {
      toast.error(`Failed to remove symbol: ${err.message}`);
    } finally {
      setShowRemoveConfirm(false);
      setRemovingSymbol(null);
      setIsRemoving(false);
    }
  };

  // Handle symbol added callback
  const handleSymbolAdded = () => {
    // Invalidate settings to refetch updated symbol list
    queryClient.invalidateQueries({ queryKey: ['settings'] });
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
      {/* Add Symbol Form */}
      <AddSymbolForm
        existingSymbols={symbols}
        onSymbolAdded={handleSymbolAdded}
      />

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

      {/* Remove Confirmation Dialog (UI-SYM-03) */}
      <ConfirmationDialog
        open={showRemoveConfirm}
        onOpenChange={(open) => {
          if (!isRemoving) {
            setShowRemoveConfirm(open);
            if (!open) setRemovingSymbol(null);
          }
        }}
        title="Remove Symbol"
        description={`Are you sure you want to remove ${removingSymbol} from your watchlist? This will stop monitoring and delete cached data for this symbol.`}
        confirmLabel="Remove Symbol"
        onConfirm={handleConfirmRemove}
        isLoading={isRemoving}
      />
    </div>
  );
}
