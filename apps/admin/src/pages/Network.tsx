import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InstanceCard, ActivityFeed } from '@/components/network';
import { CandlePulseProvider } from '@/contexts/CandlePulseContext';
import { WifiOff } from 'lucide-react';

/**
 * Network Page
 *
 * Perseus Network dashboard displaying live exchange instance status
 * and a scrollable activity feed. Auto-refreshes every 5 seconds.
 *
 * Requirements:
 * - UI-01: Network page accessible from Admin header navigation
 * - UI-02: Instance card per exchange with status fields
 * - UI-03: Offline instances show "Offline" destructive badge
 * - UI-04: Scrollable activity feed with state transitions and errors
 * - UI-05: Polling-based refresh at 5s interval
 * - DIFF-01: Uptime display from connectedAt
 * - DIFF-02: Heartbeat latency with color degradation
 */
export function Network() {
  const {
    data: instanceData,
    isLoading: instancesLoading,
    error: instancesError,
  } = useQuery({
    ...trpc.network.getInstances.queryOptions(),
    refetchInterval: 5000,
    retry: 2,
  });

  const {
    data: activityData,
    isLoading: activityLoading,
  } = useQuery({
    ...trpc.network.getActivityLog.queryOptions({ count: 50 }),
    refetchInterval: 5000,
  });

  // Distinguish network errors (API offline) from real server errors
  const isApiOffline = instancesError &&
    (instancesError.message === 'Failed to fetch' || instancesError.message.includes('ERR_CONNECTION_REFUSED'));

  if (instancesError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Network</CardTitle>
        </CardHeader>
        <CardContent>
          {isApiOffline ? (
            <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-6 text-center">
              <WifiOff className="h-8 w-8 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">API server is offline</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Waiting for reconnection&hellip;</p>
              <div className="mt-3 flex justify-center">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-pulse" />
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-950/50 dark:text-red-400">
              Error loading network status: {instancesError.message}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (instancesLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Network</CardTitle>
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
    <CandlePulseProvider>
      <div className="space-y-6">
        {/* Summary header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Perseus Network
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {instanceData?.instances.filter((i) => i.online).length ?? 0} of{' '}
            {instanceData?.instances.length ?? 0} online
          </span>
        </div>

        {/* Instance Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {instanceData?.instances.map((inst) => (
            <InstanceCard key={inst.exchangeId} instance={inst} />
          ))}
        </div>

        {/* Activity Feed */}
        <ActivityFeed
          entries={activityData?.entries ?? []}
          exchanges={instanceData?.instances.map((i) => i.exchangeName) ?? []}
          isLoading={activityLoading}
        />
      </div>
    </CandlePulseProvider>
  );
}
