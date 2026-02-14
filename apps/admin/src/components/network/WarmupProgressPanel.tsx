import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

interface WarmupProgressPanelProps {
  exchangeId: number;
}

/**
 * Format ETA milliseconds into human-readable duration.
 * Examples: "~2m 15s remaining", "~45s remaining"
 */
function formatEta(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `~${m}m ${sec}s remaining` : `~${sec}s remaining`;
}

/**
 * Get Badge variant for warmup status.
 */
function getStatusBadge(
  status: string
): { variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'; label: string } {
  switch (status) {
    case 'assessing':
      return { variant: 'outline', label: 'Assessing Cache' };
    case 'dumping':
      return { variant: 'warning', label: 'Clearing Cache' };
    case 'scanning':
      return { variant: 'outline', label: 'Scanning' };
    case 'fetching':
      return { variant: 'warning', label: 'Fetching' };
    case 'complete':
      return { variant: 'success', label: 'Complete' };
    case 'error':
      return { variant: 'destructive', label: 'Error' };
    default:
      return { variant: 'secondary', label: status.charAt(0).toUpperCase() + status.slice(1) };
  }
}

/**
 * WarmupProgressPanel Component
 *
 * Displays real-time warmup progress with:
 * - Status badge (scanning/executing/complete/error)
 * - Progress bar showing percent complete
 * - ETA estimate
 * - Current symbol being warmed
 * - Completed/skipped/failed pair counts
 * - Collapsible failure list (if any failures exist)
 *
 * Polls every 2s during active warmup (scanning/executing).
 * Slows to 30s polling when complete/error to avoid hammering Redis.
 *
 * Requirements: WARM-06 -- Admin UI displays real-time warmup progress
 */
export function WarmupProgressPanel({ exchangeId }: WarmupProgressPanelProps) {
  const { data } = useQuery({
    ...trpc.network.getWarmupStats.queryOptions({ exchangeId }),
    // Fast poll during active states, slow poll when complete/error
    refetchInterval: (query) => {
      const stats = query.state.data?.stats;
      if (!stats) return false;
      const isActive = stats.status === 'assessing' || stats.status === 'dumping' || stats.status === 'scanning' || stats.status === 'fetching';
      return isActive ? 2000 : 30000;
    },
  });

  // If no stats, or warmup already complete/error, don't render
  if (!data?.stats) return null;
  const stats = data.stats;
  if (stats.status === 'complete' || stats.status === 'error') return null;

  const statusBadge = getStatusBadge(stats.status);

  return (
    <div className="rounded-md border p-3 bg-blue-50/50">
      {/* Header: Title + Status Badge */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">Warmup Progress</h4>
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </div>

      {/* Progress Bar */}
      <div className="mb-2">
        <Progress value={stats.percentComplete} className="h-2" />
      </div>

      {/* Percent + ETA */}
      <div className="text-sm text-gray-600 mb-1">
        {stats.percentComplete}%
        {stats.etaMs !== null && ` • ${formatEta(stats.etaMs)}`}
      </div>

      {/* Current Symbol */}
      {stats.currentSymbol && (
        <div className="text-sm text-gray-700 mb-2">
          Currently warming: <span className="font-medium">{stats.currentSymbol} {stats.currentTimeframe}</span>
        </div>
      )}

      {/* Summary Line */}
      <div className="text-xs text-gray-600">
        Loading history for <span className="font-medium">{stats.totalSymbols || '—'}</span> symbols
        {stats.failedPairs > 0 && <>{' • '}<span className="font-medium text-red-600">{stats.failedPairs} failed</span></>}
      </div>

      {/* Failures Section (collapsible) */}
      {stats.failures.length > 0 && (
        <details className="mt-2">
          <summary className="text-red-600 text-xs cursor-pointer hover:underline">
            {stats.failures.length} failure{stats.failures.length > 1 ? 's' : ''}
          </summary>
          <ul className="mt-1 ml-4 text-xs text-red-600 space-y-1">
            {stats.failures.map((failure, idx) => (
              <li key={idx}>
                <span className="font-medium">{failure.symbol} {failure.timeframe}</span>: {failure.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
