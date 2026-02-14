import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PlayCircle, PauseCircle, Clock, Wifi, WifiOff, Loader2 } from 'lucide-react';

interface StartupProgress {
  phase: 'idle' | 'indicators' | 'warmup' | 'boundary' | 'websocket' | 'complete';
  phaseLabel: string;
  percent: number;
  currentItem?: string;
  total?: number;
  current?: number;
}

interface RuntimeStatusProps {
  status: {
    isPaused: boolean;
    mode: string;
    uptime: number;
    exchangeConnected: boolean;
    queueDepth: number;
    connectionState?: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'starting' | 'warming' | 'active' | 'stopping' | 'stopped';
    startup?: StartupProgress;
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
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400" />
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
          {(() => {
            const cs = status.connectionState ?? (status.exchangeConnected ? 'connected' : 'idle');
            if (cs === 'idle' || cs === 'disconnected') {
              return (
                <Badge variant="secondary">
                  <PauseCircle className="h-3 w-3 mr-1" />
                  Idle
                </Badge>
              );
            }
            if (cs === 'connecting') {
              return (
                <Badge variant="outline" className="border-blue-300 text-blue-600">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Starting
                </Badge>
              );
            }
            if (cs === 'error') {
              return (
                <Badge variant="destructive">
                  <WifiOff className="h-3 w-3 mr-1" />
                  Error
                </Badge>
              );
            }
            // connected
            return status.isPaused ? (
              <Badge variant="secondary">
                <PauseCircle className="h-3 w-3 mr-1" />
                Paused
              </Badge>
            ) : (
              <Badge variant="default">
                <PlayCircle className="h-3 w-3 mr-1" />
                Running
              </Badge>
            );
          })()}
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
          <span className="text-sm text-gray-500 dark:text-gray-400">Mode: </span>
          <Badge variant="outline">{status.mode}</Badge>
        </div>

        {/* Startup Progress */}
        {status.startup && status.startup.phase !== 'idle' && status.startup.phase !== 'complete' && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm font-medium">{status.startup.phaseLabel}</span>
            </div>
            <Progress value={status.startup.percent} className="h-2" />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>
                {status.startup.currentItem && (
                  <span className="text-gray-700 dark:text-gray-300">{status.startup.currentItem}</span>
                )}
                {status.startup.current && status.startup.total && (
                  <span className="ml-2">({status.startup.current}/{status.startup.total})</span>
                )}
              </span>
              <span>{status.startup.percent}%</span>
            </div>
          </div>
        )}

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
