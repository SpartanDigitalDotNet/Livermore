import { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { trpcClient, queryClient } from '@/lib/trpc';
import { LockWarningModal } from './LockWarningModal';
import { ExchangeSetupModal } from '../exchange/ExchangeSetupModal';

interface ConnectButtonProps {
  exchangeId: number;
  exchangeName: string;
  disabled?: boolean;
}

/**
 * ConnectButton Component
 *
 * Renders a "Connect" button that:
 * 1. Checks if user has a user_exchanges record for this exchange
 * 2. If not, opens ExchangeSetupModal to create one first
 * 3. Checks for existing locks before connecting
 * 4. If locked on another machine, shows warning modal
 * 5. Otherwise, starts the exchange
 *
 * Requirements:
 * - ADM-01: Display connect button for offline/idle exchanges
 * - ADM-02: Check lock status before connecting, warn if locked
 * - ADM-03: Route through Exchange Setup Modal if no user_exchange record
 */
export function ConnectButton({
  exchangeId,
  exchangeName,
  disabled = false,
}: ConnectButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [lockInfo, setLockInfo] = useState<{
    hostname: string;
    ipAddress: string | null;
    connectedAt: string | null;
  } | null>(null);

  /**
   * Check if user has a user_exchanges record, then check lock, then connect.
   */
  const handleClick = async () => {
    setLoading(true);
    try {
      // Step 1: Check if user has this exchange configured
      const userStatus = await trpcClient.exchangeSymbol.userStatus.query();
      const hasRecord = userStatus.statuses.some(
        (s) => s.exchangeName === exchangeName
      );

      if (!hasRecord) {
        // No user_exchange record — show setup modal first
        setShowSetup(true);
        setLoading(false);
        return;
      }

      // Step 2: Check current lock status
      await checkLockAndConnect();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to check exchange status'
      );
      setLoading(false);
    }
  };

  /**
   * Check lock status and connect if clear.
   */
  const checkLockAndConnect = async () => {
    try {
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

  /**
   * Exchange setup completed — now proceed with lock check and connect.
   */
  const handleSetupComplete = async () => {
    setShowSetup(false);
    setLoading(true);
    await checkLockAndConnect();
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

      <ExchangeSetupModal
        open={showSetup}
        onComplete={handleSetupComplete}
        userName={null}
        preselectedExchange={exchangeName}
      />
    </>
  );
}
