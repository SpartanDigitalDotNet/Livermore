import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignalsTable, type Signal } from '@/components/signals/SignalsTable';

export function Signals() {
  const { data, isLoading, error, refetch, isFetching } = useQuery(
    trpc.alert.recent.queryOptions({ limit: 50 })
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trade Signals</CardTitle>
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
          <CardTitle>Trade Signals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700">
            Error: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  const signals: Signal[] = (data?.data ?? []).map((s) => ({
    id: s.id,
    symbol: s.symbol,
    alertType: s.alertType,
    timeframe: s.timeframe,
    price: s.price,
    triggerValue: s.triggerValue,
    triggeredAt: s.triggeredAt,
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Trade Signals</CardTitle>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </CardHeader>
      <CardContent>
        <SignalsTable data={signals} />
      </CardContent>
    </Card>
  );
}
