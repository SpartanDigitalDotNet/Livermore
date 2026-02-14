import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  RuntimeStatus,
  ControlButtons,
  CommandHistory,
  ActiveSymbols,
  type CommandHistoryItem,
} from '@/components/control';

/**
 * ControlPanel Page
 *
 * Main control panel for monitoring and controlling API runtime.
 *
 * Requirements:
 * - UI-CTL-01: Runtime status display
 * - UI-CTL-02: Pause/resume buttons
 * - UI-CTL-03: Mode switcher
 * - UI-CTL-04: Active symbols count and list
 * - UI-CTL-05: Exchange connection status
 * - UI-CTL-06: Command history panel
 * - UI-CTL-07: Confirmation dialog for destructive commands
 */
export function ControlPanel() {
  const queryClient = useQueryClient();

  // Command history state (session memory only)
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);

  // Fetch status - poll faster during startup for progress updates
  const {
    data: status,
    isLoading: statusLoading,
    error: statusError,
  } = useQuery({
    ...trpc.control.getStatus.queryOptions(),
    refetchInterval: (query) => {
      const data = query.state.data as { connectionState?: string; startup?: { phase: string } } | undefined;
      const isStarting = data?.connectionState === 'connecting' ||
        (data?.startup?.phase && data.startup.phase !== 'idle' && data.startup.phase !== 'complete');
      return isStarting ? 1000 : 5000;
    },
  });

  // Fetch user settings for symbols list
  const {
    data: settings,
    isLoading: settingsLoading,
  } = useQuery(trpc.settings.get.queryOptions());

  // Get symbols from settings
  const symbols: string[] = (settings as { symbols?: string[] })?.symbols ?? [];

  // Add command to history
  const addCommand = useCallback(
    (
      id: string,
      type: string,
      status: 'pending' | 'success' | 'error',
      message?: string,
      duration?: number
    ) => {
      setCommandHistory((prev) => {
        // Find existing command or create new
        const existingIndex = prev.findIndex((cmd) => cmd.id === id);

        if (existingIndex >= 0) {
          // Update existing command
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            status,
            message,
            duration,
          };
          return updated;
        }

        // Add new command at the start
        return [
          {
            id,
            type,
            timestamp: new Date(),
            status,
            message,
            duration,
          },
          ...prev,
        ].slice(0, 50); // Keep max 50 items
      });
    },
    []
  );

  // Command execution mutation
  const executeCommandMutation = useMutation({
    mutationFn: async (params: {
      type: string;
      payload?: Record<string, unknown>;
    }) => {
      const result = await trpcClient.control.executeCommand.mutate({
        type: params.type as 'pause' | 'resume' | 'start' | 'stop' | 'switch-mode' | 'reload-settings' | 'force-backfill' | 'clear-cache' | 'add-symbol' | 'remove-symbol' | 'bulk-add-symbols',
        payload: params.payload,
      });
      return result;
    },
    onMutate: (variables) => {
      // Add pending command to history
      const id = crypto.randomUUID();
      addCommand(id, variables.type, 'pending');
      return { id, startTime: Date.now() };
    },
    onSuccess: (result, variables, context) => {
      const duration = context ? Date.now() - context.startTime : undefined;

      if (result.success) {
        addCommand(
          context?.id ?? '',
          variables.type,
          'success',
          'Completed',
          duration
        );
        toast.success(`Command '${variables.type}' executed successfully`);
      } else {
        addCommand(
          context?.id ?? '',
          variables.type,
          'error',
          result.message ?? 'Failed',
          duration
        );
        toast.error(result.message ?? 'Command failed');
      }
      // Refetch status immediately after command
      queryClient.invalidateQueries({ queryKey: ['control', 'getStatus'] });
    },
    onError: (err, variables, context) => {
      const duration = context ? Date.now() - context.startTime : undefined;
      addCommand(
        context?.id ?? '',
        variables.type,
        'error',
        err.message,
        duration
      );
      toast.error(`Command failed: ${err.message}`);
    },
  });

  const handlePause = () => {
    executeCommandMutation.mutate({ type: 'pause' });
  };

  const handleResume = () => {
    executeCommandMutation.mutate({ type: 'resume' });
  };

  const handleModeChange = (mode: string) => {
    executeCommandMutation.mutate({
      type: 'switch-mode',
      payload: { mode },
    });
  };

  const handleReloadSettings = () => {
    executeCommandMutation.mutate({ type: 'reload-settings' });
  };

  const handleClearCache = (scope: 'all' | 'symbol' | 'timeframe') => {
    executeCommandMutation.mutate({
      type: 'clear-cache',
      payload: { scope },
    });
  };

  const handleStart = () => {
    executeCommandMutation.mutate({ type: 'start' });
  };

  const handleStop = () => {
    executeCommandMutation.mutate({ type: 'stop' });
  };

  if (statusError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Control Panel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-950/50 dark:text-red-400">
            Error loading status: {statusError.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Row: Status and Active Symbols */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <RuntimeStatus status={status ?? null} isLoading={statusLoading} />
        <ActiveSymbols symbols={symbols} isLoading={settingsLoading} />
      </div>

      {/* Controls Card */}
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <ControlButtons
            isPaused={status?.isPaused ?? false}
            currentMode={status?.mode ?? 'position-monitor'}
            connectionState={(status?.connectionState as 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error') ?? 'idle'}
            onPause={handlePause}
            onResume={handleResume}
            onStart={handleStart}
            onStop={handleStop}
            onModeChange={handleModeChange}
            onReloadSettings={handleReloadSettings}
            onClearCache={handleClearCache}
            isExecuting={executeCommandMutation.isPending}
          />
        </CardContent>
      </Card>

      {/* Command History */}
      <CommandHistory commands={commandHistory} maxItems={10} />
    </div>
  );
}
