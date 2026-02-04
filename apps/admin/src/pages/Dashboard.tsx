import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { PortfolioTable } from '@/components/portfolio/PortfolioTable';
import type { PortfolioSymbol } from '@/components/portfolio/columns';

/** Minimum position value to show by default */
const MIN_POSITION_VALUE = 10;

/** Stablecoins to exclude from portfolio analysis */
const STABLECOINS = ['USD', 'USDC', 'USDT', 'DAI', 'GUSD'];

export function Dashboard() {
  const [showSmallBalances, setShowSmallBalances] = useState(false);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  const queryClient = useQueryClient();

  // Fetch actual positions from database
  const {
    data: positionsData,
    isLoading: positionsLoading,
    error: positionsError,
  } = useQuery(trpc.position.list.queryOptions());

  // Sync mutation to fetch positions from Coinbase
  const syncMutation = useMutation({
    ...trpc.position.sync.mutationOptions(),
    onSuccess: () => {
      // Invalidate positions query to refetch
      queryClient.invalidateQueries({ queryKey: ['position', 'list'] });
    },
  });

  // Auto-sync on first load if positions are empty
  useEffect(() => {
    if (
      !positionsLoading &&
      !hasAutoSynced &&
      positionsData?.data?.length === 0 &&
      !syncMutation.isPending
    ) {
      setHasAutoSynced(true);
      syncMutation.mutate();
    }
  }, [positionsLoading, positionsData, hasAutoSynced, syncMutation]);

  // Extract symbols from positions, sorted by value descending
  const { symbols, positionMap } = useMemo(() => {
    if (!positionsData?.data) return { symbols: [], positionMap: new Map() };

    // Filter and sort positions
    const filteredPositions = positionsData.data
      .filter((p) => {
        // Exclude stablecoins
        if (STABLECOINS.includes(p.symbol.toUpperCase())) return false;
        // Filter by value if not showing small balances
        if (!showSmallBalances && p.currentValue < MIN_POSITION_VALUE) return false;
        return true;
      })
      .sort((a, b) => b.currentValue - a.currentValue);

    // Build symbol list (convert BTC -> BTC-USD)
    const symbolList = filteredPositions.map((p) => `${p.symbol}-USD`);

    // Build map for quick lookup
    const map = new Map(filteredPositions.map((p) => [`${p.symbol}-USD`, p]));

    return { symbols: symbolList, positionMap: map };
  }, [positionsData, showSmallBalances]);

  // Fetch portfolio analysis for filtered symbols
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    ...trpc.indicator.getPortfolioAnalysis.queryOptions({
      symbols: symbols,
    }),
    enabled: symbols.length > 0,
  });

  // Handle loading state (including sync)
  if (positionsLoading || syncMutation.isPending || (symbols.length > 0 && isLoading)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
            {syncMutation.isPending && (
              <p className="text-sm text-gray-500">Syncing from Coinbase...</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle errors
  if (positionsError || error || syncMutation.isError) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Positions</CardTitle>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Retry Sync
          </button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700">
            Error: {syncMutation.error?.message || positionsError?.message || error?.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle empty positions
  if (symbols.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Positions</CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="show-small-empty" className="text-sm text-gray-600">
                Show small balances
              </label>
              <Switch
                id="show-small-empty"
                checked={showSmallBalances}
                onCheckedChange={setShowSmallBalances}
              />
            </div>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {syncMutation.isPending ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-gray-50 p-4 text-gray-600">
            No positions found{!showSmallBalances ? ' above $10' : ''}.
            {positionsData?.data?.length === 0 && (
              <span> Click Sync to fetch positions from Coinbase.</span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Transform API response to table format, preserving sort order from positions
  const tableData: PortfolioSymbol[] = symbols.map((sym) => {
    const analysisData = data?.symbols?.find((s) => s.symbol === sym);
    const position = positionMap.get(sym);
    return {
      symbol: sym,
      price: analysisData?.price ?? position?.currentPrice ?? null,
      values: analysisData?.values ?? {},
      signal: analysisData?.signal ?? 'Unknown',
      stage: analysisData?.stage ?? 'unknown',
      liquidity: analysisData?.liquidity ?? 'unknown',
    };
  });

  // Count hidden positions
  const totalPositions = positionsData?.data?.filter(
    (p) => !STABLECOINS.includes(p.symbol.toUpperCase())
  ).length ?? 0;
  const hiddenCount = totalPositions - symbols.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Positions</CardTitle>
          <p className="mt-1 text-sm text-gray-500">
            {symbols.length} position{symbols.length !== 1 ? 's' : ''}
            {hiddenCount > 0 && !showSmallBalances && (
              <span className="text-gray-400">
                {' '}({hiddenCount} small balance{hiddenCount !== 1 ? 's' : ''} hidden)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="show-small" className="text-sm text-gray-600">
              Show small balances
            </label>
            <Switch
              id="show-small"
              checked={showSmallBalances}
              onCheckedChange={setShowSmallBalances}
            />
          </div>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {syncMutation.isPending ? 'Syncing...' : 'Sync'}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <PortfolioTable data={tableData} />
        {data?.timestamp && (
          <p className="mt-4 text-xs text-gray-500">
            Last updated: {new Date(data.timestamp).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
