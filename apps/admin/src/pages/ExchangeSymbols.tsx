import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const exchangeLabel: Record<string, string> = {
  coinbase: 'Coinbase',
  binance: 'Binance',
  binance_us: 'Binance US',
  kraken: 'Kraken',
  kucoin: 'KuCoin',
  mexc: 'MEXC',
};

function formatMarketCap(value: string | null): string {
  if (!value) return '-';
  const num = parseFloat(value);
  if (num >= 1e12) return `$${(num / 1e12).toFixed(1)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  return `$${num.toLocaleString()}`;
}

function formatVolume(value: string | null): string {
  if (!value) return '-';
  const num = parseFloat(value);
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(0)}K`;
  return num.toFixed(0);
}

function formatFee(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Exchange Symbols Page
 *
 * DB-only reads. Defaults to user's default exchange.
 * No external API calls — symbol population is a separate scheduled process.
 */
export function ExchangeSymbols() {
  const [selectedExchangeId, setSelectedExchangeId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Load user's default exchange
  const { data: defaultExData } = useQuery(
    trpc.exchangeSymbol.defaultExchange.queryOptions()
  );

  // Load exchange list with counts
  const { data: exchangeData } = useQuery(
    trpc.exchangeSymbol.exchanges.queryOptions()
  );

  // Load user's exchange configuration status
  const { data: userStatusData } = useQuery(
    trpc.exchangeSymbol.userStatus.queryOptions()
  );

  // Set initial exchange from user's default
  useEffect(() => {
    if (selectedExchangeId === null && defaultExData?.exchangeId) {
      setSelectedExchangeId(defaultExData.exchangeId);
    }
  }, [defaultExData, selectedExchangeId]);

  // Fallback: if user has no default, pick first exchange with symbols
  useEffect(() => {
    if (selectedExchangeId === null && defaultExData?.exchangeId === null && exchangeData) {
      const first = exchangeData.exchanges.find((e) => e.symbolCount > 0);
      if (first) setSelectedExchangeId(first.id);
    }
  }, [exchangeData, defaultExData, selectedExchangeId]);

  // Load symbols for selected exchange (only fires once we have an exchangeId)
  const { data: symbolData, isLoading } = useQuery({
    ...trpc.exchangeSymbol.list.queryOptions({
      exchangeId: selectedExchangeId!,
      page,
      pageSize,
    }),
    enabled: selectedExchangeId !== null,
  });

  const handleExchangeChange = (id: number) => {
    setSelectedExchangeId(id);
    setPage(1);
  };

  const exchangeList = exchangeData?.exchanges ?? [];
  const symbols = symbolData?.symbols ?? [];
  const totalPages = symbolData?.totalPages ?? 1;
  const selectedExchange = exchangeList.find((e) => e.id === selectedExchangeId);

  // Build lookup: exchangeName → user status
  const statusMap = new Map(
    (userStatusData?.statuses ?? []).map((s) => [s.exchangeName, s])
  );
  const selectedStatus = selectedExchange ? statusMap.get(selectedExchange.name) : undefined;

  // Loading state before we have exchange data resolved
  if (selectedExchangeId === null || !exchangeData) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading exchange configuration...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Exchange Symbols</h2>
          <p className="text-sm text-gray-500">
            {selectedExchange
              ? `${exchangeLabel[selectedExchange.name] ?? selectedExchange.displayName} — ${selectedExchange.activeCount} active of ${selectedExchange.symbolCount} symbols`
              : 'Select an exchange'}
          </p>
        </div>
        {exchangeData?.lastRefresh && (
          <span className="text-xs text-gray-400">
            Last refreshed {formatTimeAgo(exchangeData.lastRefresh)}
          </span>
        )}
      </div>

      {/* Exchange tabs */}
      <div className="flex gap-2 flex-wrap">
        {exchangeList.map((ex) => (
          <Button
            key={ex.id}
            variant={selectedExchangeId === ex.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleExchangeChange(ex.id)}
          >
            {exchangeLabel[ex.name] ?? ex.displayName}
            {ex.symbolCount > 0 && (
              <span className="ml-1 opacity-60">({ex.symbolCount})</span>
            )}
          </Button>
        ))}
      </div>

      {/* Exchange info */}
      {selectedExchange && (() => {
        const fees = selectedExchange.feeSchedule as { base_maker: number; base_taker: number } | null;
        const timeframes = selectedExchange.supportedTimeframes as string[] | null;
        const geo = selectedExchange.geoRestrictions as { note?: string } | null;
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {selectedStatus?.isDefault && (
                <Badge className="bg-blue-600 text-white text-xs">Default Exchange</Badge>
              )}
              {selectedStatus && selectedStatus.hasCredentials && (
                <Badge className="bg-green-600 text-white text-xs">Configured</Badge>
              )}
              {selectedStatus && !selectedStatus.hasCredentials && (
                <Badge className="bg-yellow-600 text-white text-xs">No API Keys</Badge>
              )}
              {!selectedStatus && (
                <Badge className="bg-gray-500 text-white text-xs">Not Set Up</Badge>
              )}
              {geo && (
                <Badge className="bg-yellow-600 text-white text-xs">{geo.note ?? 'Geo-restricted'}</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
              {fees && (
                <span>Fees: {formatFee(fees.base_maker)} maker / {formatFee(fees.base_taker)} taker</span>
              )}
              {timeframes && timeframes.length > 0 && (
                <span>Timeframes: {timeframes.join(', ')}</span>
              )}
            </div>
          </div>
        );
      })()}

      <p className="text-sm text-gray-500">
        Symbols ranked by global market cap via{' '}
        <a href="https://www.coingecko.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">CoinGecko</a>.
      </p>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12 text-gray-500">
              Loading...
            </div>
          ) : symbols.length === 0 ? (
            <div className="flex items-center justify-center p-12 text-gray-500">
              No symbols for this exchange. Run the seed script to populate.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Pair</TableHead>
                  <TableHead className="text-right">Volume 24h</TableHead>
                  <TableHead className="text-right">Market Cap</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {symbols.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm text-gray-500">
                      {s.globalRank ?? '-'}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{s.displayName ?? s.baseCurrency}</span>
                      <span className="ml-1.5 text-xs text-gray-400">({s.baseCurrency})</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{s.symbol}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatVolume(s.volume24h)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatMarketCap(s.marketCap)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={s.isActive ? 'default' : 'secondary'} className="text-xs">
                        {s.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
