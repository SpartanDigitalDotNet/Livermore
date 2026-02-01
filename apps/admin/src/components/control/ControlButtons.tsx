import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Pause, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from './ConfirmationDialog';

interface ControlButtonsProps {
  isPaused: boolean;
  currentMode: string;
  onPause: () => void;
  onResume: () => void;
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
  onPause,
  onResume,
  onModeChange,
  onReloadSettings,
  onClearCache,
  isExecuting,
}: ControlButtonsProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Pause/Resume Button */}
      {isPaused ? (
        <Button onClick={onResume} disabled={isExecuting}>
          <Play className="h-4 w-4 mr-2" />
          Resume
        </Button>
      ) : (
        <Button onClick={onPause} disabled={isExecuting} variant="secondary">
          <Pause className="h-4 w-4 mr-2" />
          Pause
        </Button>
      )}

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
    </div>
  );
}
