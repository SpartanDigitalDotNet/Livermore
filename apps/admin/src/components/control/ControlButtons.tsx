import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Pause, RefreshCw, Trash2, Power, PowerOff } from 'lucide-react';
import { ConfirmationDialog } from './ConfirmationDialog';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface ControlButtonsProps {
  isPaused: boolean;
  currentMode: string;
  connectionState: ConnectionState;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  onModeChange: (mode: string) => void;
  onReloadSettings: () => void;
  onClearCache: (scope: 'all' | 'symbol' | 'timeframe') => void;
  isExecuting: boolean;
}

/**
 * ControlButtons Component
 *
 * Provides runtime control buttons:
 * - Pause/Resume toggle (UI-CTL-02)
 * - Mode switcher dropdown (UI-CTL-03)
 * - Reload settings button
 * - Clear cache button with confirmation (UI-CTL-07)
 */
export function ControlButtons({
  isPaused,
  currentMode,
  connectionState,
  onPause,
  onResume,
  onStart,
  onStop,
  onModeChange,
  onReloadSettings,
  onClearCache,
  isExecuting,
}: ControlButtonsProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Start/Stop Button (Phase 26) */}
      {isConnected ? (
        <Button
          onClick={() => setShowStopConfirm(true)}
          disabled={isExecuting}
          variant="destructive"
        >
          <PowerOff className="h-4 w-4 mr-2" />
          Stop
        </Button>
      ) : (
        <Button
          onClick={onStart}
          disabled={isExecuting || isConnecting}
          variant="default"
          className="bg-green-600 hover:bg-green-700"
        >
          <Power className="h-4 w-4 mr-2" />
          {isConnecting ? 'Connecting...' : 'Start'}
        </Button>
      )}

      {/* Pause/Resume Button - only show when connected */}
      {isConnected && (isPaused ? (
        <Button onClick={onResume} disabled={isExecuting}>
          <Play className="h-4 w-4 mr-2" />
          Resume
        </Button>
      ) : (
        <Button onClick={onPause} disabled={isExecuting} variant="secondary">
          <Pause className="h-4 w-4 mr-2" />
          Pause
        </Button>
      ))}

      {/* Mode Switcher */}
      <Select
        value={currentMode}
        onValueChange={onModeChange}
        disabled={isExecuting}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Select mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="position-monitor">Position Monitor</SelectItem>
          <SelectItem value="scalper-macdv">Scalper MACD-V</SelectItem>
          <SelectItem value="scalper-orderbook" disabled>
            Scalper Orderbook (v4.1)
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Reload Settings */}
      <Button
        variant="outline"
        onClick={onReloadSettings}
        disabled={isExecuting}
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        Reload Settings
      </Button>

      {/* Clear Cache */}
      <Button
        variant="destructive"
        onClick={() => setShowClearConfirm(true)}
        disabled={isExecuting}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Clear Cache
      </Button>

      {/* Clear Cache Confirmation Dialog */}
      <ConfirmationDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear Cache"
        description="This will delete all cached candles and indicators. You'll need to wait for backfill to complete before data is available again. This action cannot be undone."
        confirmLabel="Clear All Cache"
        onConfirm={() => {
          onClearCache('all');
          setShowClearConfirm(false);
        }}
        isLoading={isExecuting}
      />

      {/* Stop Confirmation Dialog */}
      <ConfirmationDialog
        open={showStopConfirm}
        onOpenChange={setShowStopConfirm}
        title="Stop Exchange Connection"
        description="This will disconnect from the exchange WebSocket. Real-time data will stop flowing until you start again."
        confirmLabel="Stop Connection"
        onConfirm={() => {
          onStop();
          setShowStopConfirm(false);
        }}
        isLoading={isExecuting}
      />
    </div>
  );
}
