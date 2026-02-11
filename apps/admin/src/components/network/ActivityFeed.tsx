import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, CheckCircle, AlertTriangle } from 'lucide-react';

interface ActivityFeedProps {
  entries: Array<Record<string, string> & { id: string }>;
  isLoading?: boolean;
}

/**
 * Format a Redis stream ID timestamp to relative time.
 * Stream IDs have the format "timestamp-sequence".
 */
function formatRelativeTime(streamId: string): string {
  const ms = parseInt(streamId.split('-')[0], 10);
  if (isNaN(ms)) return '';

  const seconds = Math.floor((Date.now() - ms) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * ActivityFeed Component
 *
 * Scrollable feed of network activity (state transitions and errors)
 * in reverse chronological order.
 */
export function ActivityFeed({ entries, isLoading }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Activity Feed
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-gray-500 text-sm">No recent activity</p>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 border rounded-lg p-3"
              >
                {/* Icon */}
                {entry.event === 'error' ? (
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {entry.event === 'state_transition' ? (
                    <>
                      <div className="text-sm font-medium text-gray-900">
                        {entry.exchangeName}:{' '}
                        <span className="text-gray-500">{entry.fromState}</span>
                        <span className="mx-1 text-gray-400">&rarr;</span>
                        <span className="text-gray-700">{entry.toState}</span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {entry.adminEmail || entry.hostname}
                      </div>
                    </>
                  ) : entry.event === 'error' ? (
                    <>
                      <div className="text-sm font-medium text-red-700">
                        {entry.exchangeName}: {entry.error}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {entry.hostname}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-700">
                      {entry.exchangeName}: {entry.event}
                    </div>
                  )}
                </div>

                {/* Timestamp */}
                <div className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                  {formatRelativeTime(entry.id)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
