import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SignalsTable, EXCHANGE_MAP, type Signal } from '@/components/signals/SignalsTable';
import { useAlertContext } from '@/contexts/AlertContext';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

export function Signals() {
  // Filter state
  const [exchangeFilter, setExchangeFilter] = useState<string>('all');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [timeframeFilter, setTimeframeFilter] = useState<string>('all');

  const exchangeId = exchangeFilter !== 'all' ? parseInt(exchangeFilter, 10) : undefined;

  const { data, isLoading, error, refetch, isFetching } = useQuery(
    trpc.alert.recent.queryOptions({ limit: 50, exchangeId })
  );

  const { lastAlert, highlightedIds, isConnected, clearLastAlert, removeHighlight } = useAlertContext();
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
  // Also clear highlights for alerts that moved from realtime → fetched,
  // so fetched rows never show the "new alert" background color on refresh.
  useEffect(() => {
    if (data?.data) {
      const fetchedIds = new Set(data.data.map((s) => s.id));
      setRealtimeSignals((prev) => {
        const absorbed = prev.filter((s) => fetchedIds.has(s.id));
        absorbed.forEach((s) => removeHighlight(s.id));
        return prev.filter((s) => !fetchedIds.has(s.id));
      });
    }
  }, [data, removeHighlight]);

  const fetchedSignals: Signal[] = useMemo(() =>
    (data?.data ?? []).map((s) => ({
      id: s.id,
      symbol: s.symbol,
      alertType: s.alertType,
      timeframe: s.timeframe,
      price: s.price,
      triggerValue: s.triggerValue,
      signalDelta: s.signalDelta,
      triggeredAt: s.triggeredAt,
      exchangeId: s.exchangeId ?? null,
      exchangeName: null,
      triggerLabel: s.triggerLabel ?? null,
    })),
    [data]
  );

  // Combine realtime (prepended) with fetched signals, then apply client-side filters
  const signals = useMemo(() => {
    let combined = [...realtimeSignals, ...fetchedSignals];

    // Client-side symbol filter
    if (symbolFilter) {
      const q = symbolFilter.toUpperCase();
      combined = combined.filter((s) => s.symbol.toUpperCase().includes(q));
    }

    // Client-side timeframe filter
    if (timeframeFilter !== 'all') {
      combined = combined.filter((s) => s.timeframe === timeframeFilter);
    }

    return combined;
  }, [realtimeSignals, fetchedSignals, symbolFilter, timeframeFilter]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trade Signals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400" />
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
          <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-950/50 dark:text-red-400">
            Error: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

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
          className="rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </CardHeader>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
        {/* Exchange dropdown (server-side filter) */}
        <Select value={exchangeFilter} onValueChange={setExchangeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Exchange" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Exchanges</SelectItem>
            {Object.entries(EXCHANGE_MAP).map(([id, { name }]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Symbol search (client-side filter) */}
        <Input
          placeholder="Filter symbol..."
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          className="w-[160px]"
        />

        {/* Timeframe pills (client-side filter) */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTimeframeFilter('all')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              timeframeFilter === 'all'
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
          >
            All
          </button>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframeFilter(tf)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                timeframeFilter === tf
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <CardContent>
        <SignalsTable data={signals} highlightedIds={highlightedIds} />
      </CardContent>
    </Card>
  );
}
