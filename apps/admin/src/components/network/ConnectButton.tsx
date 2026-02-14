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
 * Renders a "Connect" button that ALWAYS opens the ExchangeSetupModal
 * as a pre-flight verification wizard before connecting.
 *
 * Flow:
 * 1. Click Connect → fetch user's exchange record (if any)
 * 2. Open ExchangeSetupModal (always) — verifies env vars + tests connection
 * 3. After modal completes → check lock status → start exchange
 *
 * Requirements:
 * - ADM-01: Display connect button for offline/idle exchanges
 * - ADM-02: Check lock status before connecting, warn if locked
 * - ADM-03: Always show setup/verify modal before connecting
 */
export function ConnectButton({
  exchangeId,
  exchangeName,
  disabled = false,
}: ConnectButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [existingExchange, setExistingExchange] = useState<{
    exchangeName: string;
    displayName: string;
    apiKeyEnvVar: string;
    apiSecretEnvVar: string;
    isDefault: boolean;
  } | null>(null);
  const [lockInfo, setLockInfo] = useState<{
    hostname: string;
    ipAddress: string | null;
    connectedAt: string | null;
  } | null>(null);

  /**
   * Always open the setup/verify modal.
   * If user already has a record, pass existing data for pre-population.
   */
  const handleClick = async () => {
    setLoading(true);
    try {
      const userStatus = await trpcClient.exchangeSymbol.userStatus.query();
      const existing = userStatus.statuses.find(
        (s) => s.exchangeName === exchangeName
      );

      if (existing) {
        setExistingExchange({
          exchangeName: existing.exchangeName,
          displayName: existing.displayName ?? exchangeName,
          apiKeyEnvVar: existing.apiKeyEnvVar,
          apiSecretEnvVar: existing.apiSecretEnvVar,
          isDefault: existing.isDefault,
        });
      } else {
        setExistingExchange(null);
      }

      setShowSetup(true);
      setLoading(false);
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

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [['network']] }),
        queryClient.invalidateQueries({ queryKey: [['exchangeSymbol']] }),
      ]);
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
   * Setup/verification modal completed — proceed with lock check and connect.
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
        onCancel={() => setShowSetup(false)}
        userName={null}
        preselectedExchange={exchangeName}
        editExchange={existingExchange}
        connectMode
      />
    </>
  );
}
