import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PortfolioTable } from '@/components/portfolio/PortfolioTable';
import type { PortfolioSymbol } from '@/components/portfolio/columns';

/**
 * Portfolio symbols to monitor.
 * These are the symbols with positions or watchlist items.
 */
const PORTFOLIO_SYMBOLS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'XRP-USD',
  'DOGE-USD',
  'ADA-USD',
  'AVAX-USD',
  'LINK-USD',
  'DOT-USD',
  'MATIC-USD',
  'SHIB-USD',
  'UNI-USD',
  'LTC-USD',
  'ATOM-USD',
  'XLM-USD',
];

export function Dashboard() {
  const { data, isLoading, error, refetch, isFetching } = useQuery(
    trpc.indicator.getPortfolioAnalysis.queryOptions({
      symbols: PORTFOLIO_SYMBOLS,
    })
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700">
            Error: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Transform API response to table format
  const symbols: PortfolioSymbol[] = (data?.symbols ?? []).map((s) => ({
    symbol: s.symbol,
    price: s.price,
    values: s.values,
    signal: s.signal,
    stage: s.stage,
    liquidity: s.liquidity,
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Portfolio Analysis</CardTitle>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </CardHeader>
      <CardContent>
        <PortfolioTable data={symbols} />
        {data?.timestamp && (
          <p className="mt-4 text-xs text-gray-500">
            Last updated: {new Date(data.timestamp).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
