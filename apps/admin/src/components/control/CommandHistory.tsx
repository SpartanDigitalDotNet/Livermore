import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';

interface CommandHistoryItem {
  id: string;
  type: string;
  timestamp: Date;
  status: 'pending' | 'success' | 'error';
  message?: string;
  duration?: number; // milliseconds
}

interface CommandHistoryProps {
  commands: CommandHistoryItem[];
  maxItems?: number;
}

/**
 * Format timestamp to relative time (e.g., "2 minutes ago")
 */
function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString();
}

/**
 * Format command type to human-readable label
 */
function formatCommandType(type: string): string {
  return type
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * CommandHistory Component
 *
 * Displays recent commands with timestamps and status (UI-CTL-06).
 * Commands are stored in-memory (session only) and shown in reverse
 * chronological order.
 */
export function CommandHistory({
  commands,
  maxItems = 10,
}: CommandHistoryProps) {
  const displayedCommands = commands.slice(0, maxItems);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Command History
          {commands.length > 0 && (
            <Badge variant="secondary">{commands.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {displayedCommands.length === 0 ? (
          <p className="text-gray-500 text-sm">No commands executed yet</p>
        ) : (
          <div className="space-y-2">
            {displayedCommands.map((cmd) => (
              <div
                key={cmd.id}
                className="flex items-center justify-between border rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  {/* Status Icon */}
                  {cmd.status === 'pending' && (
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                  )}
                  {cmd.status === 'success' && (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  )}
                  {cmd.status === 'error' && (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}

                  {/* Command Info */}
                  <div>
                    <div className="font-medium text-sm">
                      {formatCommandType(cmd.type)}
                    </div>
                    {cmd.message && (
                      <div className="text-xs text-gray-500 truncate max-w-xs">
                        {cmd.message}
                      </div>
                    )}
                  </div>
                </div>

                {/* Timestamp and Duration */}
                <div className="text-right">
                  <div className="text-xs text-gray-500">
                    {formatRelativeTime(cmd.timestamp)}
                  </div>
                  {cmd.duration !== undefined && cmd.status !== 'pending' && (
                    <div className="text-xs text-gray-400">
                      {cmd.duration}ms
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { CommandHistoryItem };
