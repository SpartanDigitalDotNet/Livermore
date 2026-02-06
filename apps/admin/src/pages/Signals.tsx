import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignalsTable, type Signal } from '@/components/signals/SignalsTable';
import { useAlertContext } from '@/contexts/AlertContext';

export function Signals() {
  const { data, isLoading, error, refetch, isFetching } = useQuery(
    trpc.alert.recent.queryOptions({ limit: 50 })
  );

  const { lastAlert, highlightedIds, isConnected, clearLastAlert } = useAlertContext();
  const [realtimeSignals, setRealtimeSignals] = useState<Signal[]>([]);
  const processedIdsRef = useRef<Set<number>>(new Set());

  // Prepend new alerts from WebSocket
  useEffect(() => {
    if (lastAlert && !processedIdsRef.current.has(lastAlert.id)) {
      processedIdsRef.current.add(lastAlert.id);
      setRealtimeSignals((prev) => [lastAlert, ...prev]);
      clearLastAlert();
    }
  }, [lastAlert, clearLastAlert]);

  // Reset realtime signals when data refreshes (to avoid duplicates)
  useEffect(() => {
    if (data?.data) {
      const fetchedIds = new Set(data.data.map((s) => s.id));
      setRealtimeSignals((prev) => prev.filter((s) => !fetchedIds.has(s.id)));
    }
  }, [data]);

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

  const fetchedSignals: Signal[] = (data?.data ?? []).map((s) => ({
    id: s.id,
    symbol: s.symbol,
    alertType: s.alertType,
    timeframe: s.timeframe,
    price: s.price,
    triggerValue: s.triggerValue,
    signalDelta: s.signalDelta,
    triggeredAt: s.triggeredAt,
  }));

  // Combine realtime (prepended) with fetched signals
  const signals = [...realtimeSignals, ...fetchedSignals];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Trade Signals</CardTitle>
          <span
            className={`inline-flex h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            title={isConnected ? 'Live updates connected' : 'Live updates disconnected'}
          />
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </CardHeader>
      <CardContent>
        <SignalsTable data={signals} highlightedIds={highlightedIds} />
      </CardContent>
    </Card>
  );
}
