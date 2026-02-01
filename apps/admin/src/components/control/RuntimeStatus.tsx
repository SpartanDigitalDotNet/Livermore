import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlayCircle, PauseCircle, Clock, Wifi, WifiOff } from 'lucide-react';

interface RuntimeStatusProps {
  status: {
    isPaused: boolean;
    mode: string;
    uptime: number;
    exchangeConnected: boolean;
    queueDepth: number;
  } | null;
  isLoading: boolean;
}

/**
 * Format uptime seconds into human-readable string
 */
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * RuntimeStatus Component
 *
 * Displays current API runtime status including:
 * - Running/Paused state (UI-CTL-01)
 * - Current mode (UI-CTL-01)
 * - Uptime (UI-CTL-01)
 * - Exchange connection status (UI-CTL-05)
 */
export function RuntimeStatus({ status, isLoading }: RuntimeStatusProps) {
  if (isLoading || !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Runtime Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Runtime Status
          <Badge variant={status.isPaused ? 'secondary' : 'default'}>
            {status.isPaused ? (
              <>
                <PauseCircle className="h-3 w-3 mr-1" />
                Paused
              </>
            ) : (
              <>
                <PlayCircle className="h-3 w-3 mr-1" />
                Running
              </>
            )}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Uptime */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-500" />
            <span className="text-sm">Uptime: {formatUptime(status.uptime)}</span>
          </div>

          {/* Exchange Status */}
          <div className="flex items-center gap-2">
            {status.exchangeConnected ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm">
              Exchange: {status.exchangeConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>

        {/* Mode */}
        <div>
          <span className="text-sm text-gray-500">Mode: </span>
          <Badge variant="outline">{status.mode}</Badge>
        </div>

        {/* Queue Depth (if > 0) */}
        {status.queueDepth > 0 && (
          <div className="text-sm text-yellow-600">
            {status.queueDepth} commands in queue
          </div>
        )}
      </CardContent>
    </Card>
  );
}
