import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc, trpcClient } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RuntimeStatus, ControlButtons } from '@/components/control';

/**
 * ControlPanel Page
 *
 * Main control panel for monitoring and controlling API runtime.
 *
 * Requirements:
 * - UI-CTL-01: Runtime status display
 * - UI-CTL-02: Pause/resume buttons
 * - UI-CTL-03: Mode switcher
 * - UI-CTL-05: Exchange connection status
 * - UI-CTL-07: Confirmation dialog for destructive commands
 */
export function ControlPanel() {
  const queryClient = useQueryClient();

  // Fetch status with 5-second polling
  const {
    data: status,
    isLoading,
    error,
  } = useQuery({
    ...trpc.control.getStatus.queryOptions(),
    refetchInterval: 5000, // Poll every 5 seconds
  });

  // Command execution mutation
  const executeCommandMutation = useMutation({
    mutationFn: async (params: {
      type: string;
      payload?: Record<string, unknown>;
    }) => {
      const result = await trpcClient.control.executeCommand.mutate({
        type: params.type as 'pause' | 'resume' | 'switch-mode' | 'reload-settings' | 'force-backfill' | 'clear-cache' | 'add-symbol' | 'remove-symbol' | 'bulk-add-symbols',
        payload: params.payload,
      });
      return result;
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        toast.success(`Command '${variables.type}' executed successfully`);
      } else {
        toast.error(result.message ?? 'Command failed');
      }
      // Refetch status immediately after command
      queryClient.invalidateQueries({ queryKey: ['control', 'getStatus'] });
    },
    onError: (err) => {
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

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Control Panel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-50 p-4 text-red-700">
            Error loading status: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Runtime Status Card */}
      <RuntimeStatus status={status ?? null} isLoading={isLoading} />

      {/* Controls Card */}
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <ControlButtons
            isPaused={status?.isPaused ?? false}
            currentMode={status?.mode ?? 'position-monitor'}
            onPause={handlePause}
            onResume={handleResume}
            onModeChange={handleModeChange}
            onReloadSettings={handleReloadSettings}
            onClearCache={handleClearCache}
            isExecuting={executeCommandMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}
