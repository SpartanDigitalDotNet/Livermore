import { cn } from '@/lib/utils';

interface LogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  name: string;
  service: string;
  msg: string;
  event?: string;
  symbol?: string;
}

interface LogViewerProps {
  entries: LogEntry[];
}

function getLevelStyle(level: string): string {
  switch (level) {
    case 'ERROR':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    case 'WARN':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'INFO':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'DEBUG':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:text-gray-600';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
}

export function LogViewer({ entries }: LogViewerProps) {
  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500 dark:text-gray-400">No log entries found</div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, idx) => (
        <div
          key={`${entry.timestamp}-${idx}`}
          className={cn(
            'rounded-md border p-3 dark:border-gray-800',
            entry.level === 'ERROR' && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30',
            entry.level === 'WARN' && 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30'
          )}
        >
          <div className="flex items-start gap-3">
            <span
              className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${getLevelStyle(entry.level)}`}
            >
              {entry.level}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="font-mono">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>{entry.service}</span>
                {entry.symbol && (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span className="font-medium">{entry.symbol}</span>
                  </>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{entry.msg}</p>
              {entry.event && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Event: {entry.event}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export type { LogEntry };
