import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface WarmupStatsData {
  status: string;
  mode: string | null;
  startedAt: number;
  updatedAt: number;
  totalSymbols: number;
  totalPairs: number;
  completedPairs: number;
  skippedPairs: number;
  failedPairs: number;
  failures: Array<{ symbol: string; timeframe: string; error: string }>;
}

interface WarmupReportModalProps {
  open: boolean;
  onClose: () => void;
  stats: WarmupStatsData;
  exchangeLabel: string;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function WarmupReportModal({ open, onClose, stats, exchangeLabel }: WarmupReportModalProps) {
  const duration = stats.updatedAt - stats.startedAt;
  const hasFailures = stats.failures.length > 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasFailures ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : (
              <CheckCircle className="h-5 w-5 text-green-500" />
            )}
            Warmup Report &mdash; {exchangeLabel}
          </DialogTitle>
        </DialogHeader>

        {/* Summary Grid */}
        <div className="rounded-md border p-4 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Mode</span>
              <div className="font-medium">
                <Badge variant="outline" className="mt-0.5">
                  {stats.mode === 'full_refresh' ? 'Full Refresh' : stats.mode === 'targeted' ? 'Targeted' : 'N/A'}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Duration</span>
              <div className="font-medium">{formatDuration(duration)}</div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Total Pairs</span>
              <div className="font-medium">{stats.totalPairs}</div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Completed</span>
              <div className="font-medium">{stats.completedPairs}</div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Skipped</span>
              <div className="font-medium">{stats.skippedPairs}</div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Failed</span>
              <div className={`font-medium ${stats.failedPairs > 0 ? 'text-red-600' : ''}`}>
                {stats.failedPairs}
              </div>
            </div>
          </div>
        </div>

        {/* Success / Error State */}
        {hasFailures ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <XCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{stats.failures.length} Failure{stats.failures.length > 1 ? 's' : ''}</span>
            </div>
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 max-h-48 overflow-y-auto">
              <ul className="divide-y divide-red-100 dark:divide-red-900/50">
                {stats.failures.map((failure, idx) => (
                  <li key={idx} className="px-3 py-2 text-sm">
                    <span className="font-medium text-red-700 dark:text-red-400">
                      {failure.symbol} {failure.timeframe}
                    </span>
                    <span className="text-red-600 dark:text-red-500">: {failure.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 py-2">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-medium">All symbols loaded successfully</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
