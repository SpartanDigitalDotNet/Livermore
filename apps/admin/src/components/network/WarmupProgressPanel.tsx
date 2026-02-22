import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { WarmupReportModal } from './WarmupReportModal';

interface WarmupProgressPanelProps {
  exchangeId: number;
  exchangeLabel?: string;
  connectionState?: string;
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
 * - Toast notification + modal report on completion
 *
 * Polls every 2s during active warmup (scanning/executing).
 * Slows to 30s polling when complete/error to avoid hammering Redis.
 *
 * Requirements: WARM-06 -- Admin UI displays real-time warmup progress
 */
export function WarmupProgressPanel({ exchangeId, exchangeLabel, connectionState }: WarmupProgressPanelProps) {
  const [showReport, setShowReport] = useState(false);
  const hasTriggeredReport = useRef(false);
  const hasSeenActive = useRef(false);

  const { data } = useQuery({
    ...trpc.network.getWarmupStats.queryOptions({ exchangeId }),
    // Fast poll during active states, slow poll when complete/error.
    // When stats is null, keep polling — warmup may not have written its first update yet.
    refetchInterval: (query) => {
      const stats = query.state.data?.stats;
      if (!stats) return 2000;
      const isActive = stats.status === 'assessing' || stats.status === 'dumping' || stats.status === 'scanning' || stats.status === 'fetching';
      // Keep fast-polling if instance is warming (new warmup may overwrite stale stats soon)
      if (isActive || connectionState === 'starting' || connectionState === 'warming') return 2000;
      return 30000;
    },
  });

  const stats = data?.stats ?? null;
  const isInstanceWarming = connectionState === 'starting' || connectionState === 'warming';

  // Reset report trigger when a new warmup begins (instance re-enters warming state)
  useEffect(() => {
    if (isInstanceWarming) {
      hasTriggeredReport.current = false;
      hasSeenActive.current = true;
    }
  }, [isInstanceWarming]);

  // Track when we see an active warmup state (so we only toast for warmups we witnessed)
  useEffect(() => {
    if (!stats) return;
    const isActive = stats.status === 'assessing' || stats.status === 'dumping' || stats.status === 'scanning' || stats.status === 'fetching';
    if (isActive) hasSeenActive.current = true;
  }, [stats?.status]);

  // Fire toast + open modal when warmup completes (only if we witnessed the active warmup)
  useEffect(() => {
    if (!stats) return;
    if (stats.status !== 'complete' && stats.status !== 'error') return;
    if (hasTriggeredReport.current) return;
    if (!hasSeenActive.current) return;

    hasTriggeredReport.current = true;
    const hasFailures = stats.failedPairs > 0;
    const label = exchangeLabel ?? `Exchange ${exchangeId}`;

    if (hasFailures) {
      toast.warning(`${label} Warmup Complete with Errors`, {
        description: `${stats.failedPairs} of ${stats.totalPairs} pairs failed`,
        duration: 8000,
        action: {
          label: 'View Report',
          onClick: () => setShowReport(true),
        },
      });
      // Auto-open modal on failures
      setShowReport(true);
    } else {
      toast.success(`${label} Warmup Complete`, {
        description: `${stats.totalPairs} pairs loaded`,
        duration: 5000,
        action: {
          label: 'View Report',
          onClick: () => setShowReport(true),
        },
      });
    }
  }, [stats?.status, stats?.failedPairs, stats?.totalPairs, exchangeId, exchangeLabel]);

  if (!stats) return null;

  const isComplete = stats.status === 'complete' || stats.status === 'error';

  // If instance is warming but stats show complete/error, that's stale data from a previous run.
  // Show a "preparing" indicator instead of the old report.
  if (isComplete && isInstanceWarming) {
    return (
      <div className="rounded-md border p-3 bg-blue-50/50 dark:bg-blue-950/30 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Warmup Progress</h4>
          <Badge variant="outline">Preparing</Badge>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Warming up exchange connection&hellip;</p>
      </div>
    );
  }

  // Post-completion: show compact summary with report link
  if (isComplete) {
    const hasFailures = stats.failedPairs > 0;
    return (
      <>
        <div className="flex items-center gap-2 text-sm">
          {hasFailures ? (
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
          )}
          <span className="text-gray-700 dark:text-gray-300">
            Warmup complete &mdash; {stats.totalPairs} pairs loaded
            {hasFailures && <span className="text-red-600"> ({stats.failedPairs} failed)</span>}
          </span>
          <button
            onClick={() => setShowReport(true)}
            className="text-blue-600 dark:text-blue-400 hover:underline text-sm ml-auto flex-shrink-0"
          >
            View Report
          </button>
        </div>
        <WarmupReportModal
          open={showReport}
          onClose={() => setShowReport(false)}
          stats={stats}
          exchangeLabel={exchangeLabel ?? `Exchange ${exchangeId}`}
        />
      </>
    );
  }

  const statusBadge = getStatusBadge(stats.status);

  return (
    <>
      <div className="rounded-md border p-3 bg-blue-50/50 dark:bg-blue-950/30 dark:border-gray-700">
        {/* Header: Title + Status Badge */}
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium">Warmup Progress</h4>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>

        {/* Progress Bar */}
        <div className="mb-2">
          <Progress value={stats.percentComplete} className="h-2 bg-gray-700 [&>div]:bg-blue-500" />
        </div>

        {/* Percent + ETA */}
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
          {stats.percentComplete}%
          {stats.etaMs !== null && ` • ${formatEta(stats.etaMs)}`}
        </div>

        {/* Current Symbol */}
        {stats.currentSymbol && (
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            Currently warming:
            <img
              src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${stats.currentSymbol.split(/[-/]/)[0].toLowerCase()}.svg`}
              alt=""
              className="h-4 w-4"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="font-medium">{stats.currentSymbol} {stats.currentTimeframe}</span>
          </div>
        )}

        {/* Summary Line */}
        <div className="text-xs text-gray-600 dark:text-gray-400">
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

      <WarmupReportModal
        open={showReport}
        onClose={() => setShowReport(false)}
        stats={stats}
        exchangeLabel={exchangeLabel ?? `Exchange ${exchangeId}`}
      />
    </>
  );
}
