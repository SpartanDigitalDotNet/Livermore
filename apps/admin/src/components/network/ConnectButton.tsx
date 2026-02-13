import { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { trpcClient, queryClient } from '@/lib/trpc';
import { LockWarningModal } from './LockWarningModal';

interface ConnectButtonProps {
  exchangeId: number;
  exchangeName: string;
  disabled?: boolean;
}

/**
 * ConnectButton Component
 *
 * Renders a "Connect" button that checks for existing locks before
 * attempting to start an exchange. If the exchange is already running
 * on another machine, shows a warning modal requiring confirmation.
 *
 * Requirements:
 * - ADM-01: Display connect button for offline/idle exchanges
 * - ADM-02: Check lock status before connecting, warn if locked
 */
export function ConnectButton({
  exchangeId,
  exchangeName,
  disabled = false,
}: ConnectButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [lockInfo, setLockInfo] = useState<{
    hostname: string;
    ipAddress: string | null;
    connectedAt: string | null;
  } | null>(null);

  /**
   * Check if exchange is locked on another instance, then connect.
   */
  const handleClick = async () => {
    setLoading(true);
    try {
      // Check current lock status
      const statusResult = await trpcClient.network.getExchangeStatus.query({
        exchangeId,
      });

      const { online, status } = statusResult;

      // If online and not idle/stopped, show warning modal
      if (
        online &&
        status &&
        status.connectionState !== 'idle' &&
        status.connectionState !== 'stopped'
      ) {
        setLockInfo({
          hostname: status.hostname,
          ipAddress: status.ipAddress,
          connectedAt: status.connectedAt,
        });
        setShowWarning(true);
        setLoading(false);
        return;
      }

      // Otherwise connect directly
      await handleConnect();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to check exchange status'
      );
      setLoading(false);
    }
  };

  /**
   * Execute the start command.
   */
  const handleConnect = async () => {
    try {
      await trpcClient.control.executeCommand.mutate({
        type: 'start',
        payload: { exchange: exchangeName },
      });

      toast.success(`Connecting to ${exchangeName}...`);

      // Invalidate network queries to trigger immediate refetch
      await queryClient.invalidateQueries({ queryKey: [['network']] });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to start exchange'
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * User confirmed takeover from warning modal.
   */
  const handleConfirmTakeover = async () => {
    setShowWarning(false);
    await handleConnect();
  };

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={disabled || loading}
        variant="outline"
        size="sm"
        className="w-full"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Play className="h-4 w-4 mr-2" />
        )}
        Connect
      </Button>

      {lockInfo && (
        <LockWarningModal
          open={showWarning}
          onConfirm={handleConfirmTakeover}
          onCancel={() => {
            setShowWarning(false);
            setLoading(false);
          }}
          hostname={lockInfo.hostname}
          ipAddress={lockInfo.ipAddress}
          connectedAt={lockInfo.connectedAt}
          exchangeName={exchangeName}
        />
      )}
    </>
  );
}
