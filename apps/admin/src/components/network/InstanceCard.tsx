import type { ComponentType } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Server, Clock, User, Hash, Wifi, WifiOff } from 'lucide-react';
import { ExchangeBinance, ExchangeCoinbase, ExchangeKraken, ExchangeKucoin } from '@web3icons/react';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { useCandlePulse } from '@/contexts/CandlePulseContext';
import { ConnectButton } from './ConnectButton';
import { WarmupProgressPanel } from './WarmupProgressPanel';
import { CandleMeter } from './CandleMeter';

/** Map exchange names to static web3icon components (null = letter fallback) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exchangeIconMap: Record<string, ComponentType<any> | null> = {
  coinbase: ExchangeCoinbase,
  binance: ExchangeBinance,
  binance_us: ExchangeBinance,
  kraken: ExchangeKraken,
  kucoin: ExchangeKucoin,
  mexc: null,
};

interface InstanceCardProps {
  instance: {
    exchangeId: number;
    exchangeName: string;
    displayName: string;
    online: boolean;
    status: {
      exchangeId: number;
      exchangeName: string;
      hostname: string;
      ipAddress: string | null;
      countryCode: string | null;
      adminEmail: string | null;
      adminDisplayName: string | null;
      connectionState:
        | 'idle'
        | 'starting'
        | 'warming'
        | 'active'
        | 'stopping'
        | 'stopped';
      symbolCount: number;
      connectedAt: string | null;
      lastHeartbeat: string;
      lastStateChange: string;
      registeredAt: string;
      lastError: string | null;
      lastErrorAt: string | null;
    } | null;
  };
}

/**
 * Get Badge variant and label for a connection state.
 */
function getStateBadge(
  online: boolean,
  connectionState?: string
): { variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'; label: string; className?: string } {
  if (!online) {
    return { variant: 'destructive', label: 'Offline' };
  }

  switch (connectionState) {
    case 'active':
      return { variant: 'success', label: 'Active' };
    case 'starting':
      return { variant: 'outline', label: 'Starting', className: 'border-blue-300 text-blue-600' };
    case 'warming':
      return { variant: 'warning', label: 'Warming' };
    case 'stopping':
      return { variant: 'warning', label: 'Stopping' };
    case 'stopped':
      return { variant: 'secondary', label: 'Stopped' };
    case 'idle':
    default:
      return { variant: 'secondary', label: 'Idle' };
  }
}

/**
 * Get heartbeat age info with color coding.
 * Green: < 10s, Yellow: < 30s, Red: >= 30s
 */
function getHeartbeatInfo(lastHeartbeat: string): { ageSec: number; colorClass: string } {
  const ageMs = Date.now() - new Date(lastHeartbeat).getTime();
  const ageSec = Math.floor(ageMs / 1000);

  let colorClass: string;
  if (ageSec < 10) {
    colorClass = 'text-green-500';
  } else if (ageSec < 30) {
    colorClass = 'text-yellow-500';
  } else {
    colorClass = 'text-red-500';
  }

  return { ageSec, colorClass };
}

/**
 * Format uptime from connectedAt timestamp to human-readable duration.
 */
function formatUptime(connectedAt: string | null): string {
  if (!connectedAt) return 'N/A';

  const seconds = Math.floor((Date.now() - new Date(connectedAt).getTime()) / 1000);
  if (seconds < 0) return 'N/A';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

/**
 * InstanceCard Component
 *
 * Displays exchange instance status with connection state badge,
 * heartbeat latency indicator, uptime, hostname, IP, admin, and symbol count.
 *
 * Shows ConnectButton for offline, idle, or stopped exchanges.
 *
 * Requirements:
 * - ADM-01: Display connect button for connectable exchanges
 */
export function InstanceCard({ instance }: InstanceCardProps) {
  const { online, displayName, status, exchangeId, exchangeName } = instance;
  const badge = getStateBadge(online, status?.connectionState);
  const { seedTimestamps, getSymbols } = useCandlePulse();

  const isActive = status?.connectionState === 'active';

  // Fetch initial candle timestamps when instance becomes active
  const { data: candleData } = useQuery({
    ...trpc.network.getCandleTimestamps.queryOptions({ exchangeId }),
    enabled: isActive,
    staleTime: Infinity, // Only fetch once — WebSocket keeps it fresh
    // Retry if symbol registry wasn't populated yet (empty response during startup race)
    refetchInterval: (query) => {
      const symbols = query.state.data?.symbols;
      return (!symbols || symbols.length === 0) ? 5000 : false;
    },
  });

  // Seed context when data arrives
  useEffect(() => {
    if (candleData?.timestamps) {
      seedTimestamps(exchangeId, candleData.timestamps);
    }
  }, [candleData, exchangeId, seedTimestamps]);

  const meterSymbols = isActive ? (candleData?.symbols ?? getSymbols(exchangeId)) : [];

  // Determine if exchange is connectable
  // Show button when: offline, OR (online AND (idle OR stopped))
  const isConnectable =
    !online ||
    status?.connectionState === 'idle' ||
    status?.connectionState === 'stopped';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-base">
            {(() => {
              const Icon = exchangeIconMap[exchangeName];
              return Icon ? (
                <Icon size={24} variant="branded" />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {displayName.charAt(0)}
                </span>
              );
            })()}
            {displayName}
          </span>
          <Badge variant={badge.variant} className={badge.className}>
            {online ? (
              <Wifi className="h-3 w-3 mr-1" />
            ) : (
              <WifiOff className="h-3 w-3 mr-1" />
            )}
            {badge.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {status ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {/* Row 1: Hostname and IP */}
              <div className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-gray-700 truncate dark:text-gray-300">{status.hostname}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                {status.countryCode && (
                  <img
                    src={`https://hatscripts.github.io/circle-flags/flags/${status.countryCode.toLowerCase()}.svg`}
                    alt={status.countryCode.toUpperCase()}
                    className="h-5 w-5 flex-shrink-0"
                  />
                )}
                <span className="truncate">{status.ipAddress ?? 'N/A'}</span>
              </div>

              {/* Row 2: Admin and Symbol count */}
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-gray-700 truncate dark:text-gray-300">
                  {status.adminDisplayName ?? status.adminEmail ?? 'N/A'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-gray-700 dark:text-gray-300">{status.symbolCount} symbols</span>
              </div>

              {/* Row 3: Heartbeat and Uptime */}
              <div className="flex items-center gap-1.5">
                {(() => {
                  const hb = getHeartbeatInfo(status.lastHeartbeat);
                  return (
                    <>
                      <Wifi className={`h-3.5 w-3.5 ${hb.colorClass}`} />
                      <span className={hb.colorClass}>{hb.ageSec}s ago</span>
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-gray-700 dark:text-gray-300">
                  Running for {formatUptime(status.connectedAt)}
                </span>
              </div>
            </div>

            {/* Candle Freshness Meter (active only) */}
            {isActive && meterSymbols.length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <CandleMeter exchangeId={exchangeId} symbols={meterSymbols} />
              </div>
            )}

            {/* Warmup Progress Panel (starting/warming/active — persists after completion for report link) */}
            {(status.connectionState === 'starting' || status.connectionState === 'warming' || status.connectionState === 'active') && (
              <div className="mt-3 pt-3 border-t">
                <WarmupProgressPanel exchangeId={exchangeId} exchangeLabel={displayName} />
              </div>
            )}
          </>
        ) : (
          <p className="text-gray-400 text-sm dark:text-gray-500">No active connection</p>
        )}
      </CardContent>

      {/* Connect Button Footer */}
      {isConnectable && (
        <div className="px-6 pb-4 pt-3 border-t mt-2">
          <ConnectButton
            exchangeId={exchangeId}
            exchangeName={exchangeName}
          />
        </div>
      )}
    </Card>
  );
}
