import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, XCircle, AlertTriangle, Loader2, ArrowLeft, Zap, RefreshCw } from 'lucide-react';
import { trpc, trpcClient, queryClient } from '../../lib/trpc';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface ExchangeSetupModalProps {
  open: boolean;
  onComplete: () => void;
  onCancel?: () => void;
  userName: string | null;
  editExchange?: {
    exchangeName: string;
    displayName: string;
    apiKeyEnvVar: string;
    apiSecretEnvVar: string;
    isDefault: boolean;
  } | null;
  /** Pre-select an exchange by name, skipping the selection step */
  preselectedExchange?: string;
  /** When true, opened from ConnectButton — uses connect-mode language */
  connectMode?: boolean;
}

interface ExchangeInfo {
  id: number;
  name: string;
  displayName: string;
  geoRestrictions: { note: string } | null;
  isBusy: boolean;
}

export function ExchangeSetupModal({
  open,
  onComplete,
  onCancel,
  userName,
  editExchange,
  preselectedExchange,
  connectMode,
}: ExchangeSetupModalProps) {
  const [selectedExchange, setSelectedExchange] = useState<ExchangeInfo | null>(null);
  const [apiKeyEnvVar, setApiKeyEnvVar] = useState('');
  const [apiSecretEnvVar, setApiSecretEnvVar] = useState('');
  const [displayNameValue, setDisplayNameValue] = useState('');
  const [isDefaultChecked, setIsDefaultChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  // Env var verification — imperative (user clicks "Verify")
  const [envResults, setEnvResults] = useState<Record<string, boolean>>({});
  const [envChecking, setEnvChecking] = useState(false);
  const [envCheckError, setEnvCheckError] = useState(false);
  const [envChecked, setEnvChecked] = useState(false);

  // Test connection
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [testLatency, setTestLatency] = useState<number | null>(null);

  // Fetch exchanges with availability
  const { data: statusData, isLoading: statusLoading } = useQuery(
    trpc.exchangeSymbol.exchangeStatuses.queryOptions()
  );

  // Edit mode / existing record: pre-populate fields
  useEffect(() => {
    if (editExchange) {
      setSelectedExchange({
        id: 0,
        name: editExchange.exchangeName,
        displayName: editExchange.displayName,
        geoRestrictions: null,
        isBusy: false,
      });
      setApiKeyEnvVar(editExchange.apiKeyEnvVar);
      setApiSecretEnvVar(editExchange.apiSecretEnvVar);
      setDisplayNameValue(editExchange.displayName);
      // In connectMode, always make the connecting exchange the default
      setIsDefaultChecked(connectMode ? true : false);
    }
  }, [editExchange]);

  // Pre-select exchange when opened via ConnectButton (skips selection step)
  useEffect(() => {
    if (preselectedExchange && !editExchange && statusData?.exchanges) {
      const match = statusData.exchanges.find((ex) => ex.name === preselectedExchange);
      if (match) {
        setSelectedExchange(match as ExchangeInfo);
      }
    }
  }, [preselectedExchange, editExchange, statusData]);

  // Auto-populate env var names when exchange is selected (create mode only)
  // Uses naming convention: {EXCHANGE_NAME}_CLIENTID / {EXCHANGE_NAME}_SECRET
  useEffect(() => {
    if (selectedExchange && !editExchange) {
      const prefix = selectedExchange.name.toUpperCase();
      setApiKeyEnvVar(`${prefix}_CLIENTID`);
      setApiSecretEnvVar(`${prefix}_SECRET`);
    }
  }, [selectedExchange, editExchange]);

  // When env var fields change, clear all verification state
  useEffect(() => {
    setEnvResults({});
    setEnvChecked(false);
    setEnvCheckError(false);
    setTestResult('idle');
    setTestError(null);
    setTestLatency(null);
  }, [apiKeyEnvVar, apiSecretEnvVar]);

  // Auto-verify on first load when env vars are populated (new setup only, not edit/connect)
  const [autoVerifyDone, setAutoVerifyDone] = useState(false);
  useEffect(() => {
    if (open && apiKeyEnvVar && apiSecretEnvVar && !autoVerifyDone && !editExchange) {
      setAutoVerifyDone(true);
      verifyEnvVars(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, apiKeyEnvVar, apiSecretEnvVar]);

  // Reset flags when modal closes
  useEffect(() => {
    if (!open) {
      setAutoVerifyDone(false);
    }
  }, [open]);

  /**
   * Verify env vars exist on the server. Imperative call — no caching.
   * @param isManual - true when user clicks Verify button, false for auto-verify
   */
  async function verifyEnvVars(_isManual = true) {
    if (!apiKeyEnvVar || !apiSecretEnvVar) return;
    setEnvChecking(true);
    setEnvCheckError(false);
    setEnvChecked(false);
    try {
      const result = await trpcClient.exchangeSymbol.checkEnvVars.query({
        envVars: [apiKeyEnvVar, apiSecretEnvVar],
      });
      setEnvResults(result.results);
      setEnvChecked(true);
    } catch {
      setEnvCheckError(true);
    } finally {
      setEnvChecking(false);
    }
  }

  // Env vars are pre-verified when loaded from an existing DB record
  // (unless the user changed them, in which case they need re-verification)
  const envVarsMatchDb =
    !!editExchange &&
    apiKeyEnvVar === editExchange.apiKeyEnvVar &&
    apiSecretEnvVar === editExchange.apiSecretEnvVar;

  const envVarsVerified =
    envVarsMatchDb ||
    (envChecked &&
      envResults[apiKeyEnvVar] === true &&
      envResults[apiSecretEnvVar] === true);

  const handleSelectExchange = (exchange: ExchangeInfo) => {
    if (exchange.isBusy) return;
    setSelectedExchange(exchange);
  };

  const handleBack = () => {
    setSelectedExchange(null);
    setApiKeyEnvVar('');
    setApiSecretEnvVar('');
    setDisplayNameValue('');
    setIsDefaultChecked(false);
    setEnvResults({});
    setEnvChecked(false);
    setEnvCheckError(false);
    setTestResult('idle');
    setTestError(null);
    setTestLatency(null);
  };

  const handleTestConnection = async () => {
    if (!selectedExchange) return;
    setTestResult('testing');
    setTestError(null);
    setTestLatency(null);
    try {
      const result = await trpcClient.exchangeSymbol.testConnection.mutate({
        exchangeName: selectedExchange.name,
      });
      setTestResult('passed');
      setTestLatency(result.latencyMs);
    } catch (err) {
      setTestResult('failed');
      setTestError(err instanceof Error ? err.message : 'Connection test failed');
    }
  };

  const handleSave = async () => {
    if (!selectedExchange || !apiKeyEnvVar || !apiSecretEnvVar) return;
    setSaving(true);
    try {
      if (editExchange) {
        const changed =
          apiKeyEnvVar !== editExchange.apiKeyEnvVar ||
          apiSecretEnvVar !== editExchange.apiSecretEnvVar ||
          (displayNameValue && displayNameValue !== editExchange.displayName) ||
          isDefaultChecked;

        if (changed) {
          await trpcClient.exchangeSymbol.updateExchange.mutate({
            exchangeName: editExchange.exchangeName,
            apiKeyEnvVar,
            apiSecretEnvVar,
            displayName: displayNameValue || undefined,
            isDefault: isDefaultChecked ? true : undefined,
          });
        }
        toast.success(connectMode ? 'Exchange verified!' : 'Exchange updated successfully!');
      } else {
        await trpcClient.exchangeSymbol.setupExchange.mutate({
          exchangeName: selectedExchange.name,
          apiKeyEnvVar,
          apiSecretEnvVar,
        });
        toast.success('Exchange configured successfully!');
      }
      await queryClient.invalidateQueries({ queryKey: [['exchangeSymbol']] });
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save exchange';
      if (message.includes('CONFLICT') || message.includes('already configured')) {
        toast.error('This exchange is already configured for your account.');
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const isEditMode = !!editExchange;
  const isDismissable = isEditMode || !!preselectedExchange || !!connectMode;

  let saveButtonText: string;
  if (connectMode) {
    saveButtonText = isEditMode ? 'Connect' : 'Save & Connect';
  } else {
    saveButtonText = isEditMode ? 'Update Exchange' : 'Save Exchange';
  }

  const canSave =
    !saving && !!apiKeyEnvVar && !!apiSecretEnvVar && envVarsVerified && testResult === 'passed';

  return (
    <Dialog open={open} onOpenChange={isDismissable ? (onCancel ?? onComplete) : undefined}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => !isDismissable && e.preventDefault()}
        onEscapeKeyDown={(e) => !isDismissable && e.preventDefault()}
        onInteractOutside={(e) => !isDismissable && e.preventDefault()}
        style={!isDismissable ? { ['--dialog-close-display' as string]: 'none' } : {}}
      >
        {!isDismissable && (
          <style>{`.absolute.right-4.top-4 { display: none !important; }`}</style>
        )}

        <DialogHeader>
          <DialogTitle>
            {connectMode
              ? isEditMode
                ? `Connect to ${editExchange.displayName}`
                : 'Set Up Exchange'
              : isEditMode
                ? 'Edit Exchange'
                : selectedExchange
                  ? 'Configure Exchange'
                  : 'Welcome!'}
          </DialogTitle>
          <DialogDescription>
            {connectMode
              ? isEditMode
                ? 'Verify credentials and test connection before connecting.'
                : `Configure API credentials for ${selectedExchange?.displayName ?? preselectedExchange}.`
              : isEditMode
                ? `Update credentials for ${editExchange.exchangeName}`
                : selectedExchange
                  ? `Set up API credentials for ${selectedExchange.displayName}`
                  : `${userName ? `Hi ${userName}! ` : ''}Your exchange is not yet set up. Select one to get started.`}
          </DialogDescription>
        </DialogHeader>

        {!selectedExchange && !isEditMode ? (
          /* Step 1: Exchange selection */
          <div className="space-y-2">
            {statusLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : statusData?.exchanges.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No active exchanges available. Contact your administrator.
              </p>
            ) : (
              statusData?.exchanges.map((ex) => (
                <button
                  key={ex.id}
                  disabled={ex.isBusy}
                  onClick={() => handleSelectExchange(ex as ExchangeInfo)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    ex.isBusy
                      ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60 dark:border-gray-700 dark:bg-gray-800'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-600 dark:hover:bg-blue-950/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{ex.displayName}</span>
                    {ex.isBusy ? (
                      <Badge variant="secondary">In Use</Badge>
                    ) : (
                      <Badge variant="success">Available</Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : selectedExchange ? (
          /* Step 2: Env var configuration + verification + test connection */
          <div className="space-y-4">
            {!isEditMode && !preselectedExchange && !connectMode && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="mb-1 -ml-2">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            )}

            {/* Geo-restriction warning */}
            {selectedExchange.geoRestrictions?.note && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-950/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
                <p className="text-sm text-yellow-800 dark:text-yellow-300">{selectedExchange.geoRestrictions.note}</p>
              </div>
            )}

            {/* Display Name (edit mode only, not connect mode) */}
            {isEditMode && !connectMode && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Display Name (Optional)
                </label>
                <Input
                  value={displayNameValue}
                  onChange={(e) => setDisplayNameValue(e.target.value)}
                  placeholder="e.g. My Binance Account"
                  maxLength={100}
                />
              </div>
            )}

            {/* API Key env var */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                API Key Environment Variable
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={apiKeyEnvVar}
                  onChange={(e) => setApiKeyEnvVar(e.target.value)}
                  placeholder="e.g. COINBASE_CLIENTID"
                />
                <EnvStatus found={envVarsMatchDb ? true : envChecked ? envResults[apiKeyEnvVar] : undefined} loading={envChecking} />
              </div>
            </div>

            {/* API Secret env var */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                API Secret Environment Variable
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={apiSecretEnvVar}
                  onChange={(e) => setApiSecretEnvVar(e.target.value)}
                  placeholder="e.g. COINBASE_SECRET"
                />
                <EnvStatus found={envVarsMatchDb ? true : envChecked ? envResults[apiSecretEnvVar] : undefined} loading={envChecking} />
              </div>
            </div>

            {/* Set as Default switch (edit mode only, not connect mode, if not already default) */}
            {isEditMode && !connectMode && editExchange && !editExchange.isDefault && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="is-default"
                  checked={isDefaultChecked}
                  onCheckedChange={setIsDefaultChecked}
                />
                <Label htmlFor="is-default" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Set as Default Exchange
                </Label>
              </div>
            )}

            {/* Env var verification status + Verify button */}
            {envVarsMatchDb ? (
              <p className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle className="h-3 w-3" />
                Credentials loaded from configuration.
              </p>
            ) : envVarsVerified ? (
              <p className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle className="h-3 w-3" />
                Environment variables verified on server.
              </p>
            ) : envCheckError ? (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <XCircle className="h-3 w-3" />
                Failed to verify environment variables. Check server connection.
              </p>
            ) : envChecked && !envVarsVerified ? (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <XCircle className="h-3 w-3" />
                One or more environment variables not found on server.
              </p>
            ) : envChecking ? (
              <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Verifying environment variables...
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Click Verify to check these environment variables on the server.
              </p>
            )}

            {/* Verify Environment Variables button */}
            {!envVarsVerified && (
              <Button
                variant="outline"
                onClick={() => verifyEnvVars(true)}
                disabled={envChecking || !apiKeyEnvVar || !apiSecretEnvVar}
                className="w-full"
              >
                {envChecking ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {envChecking ? 'Checking...' : 'Verify Environment Variables'}
              </Button>
            )}

            {/* Test Connection button — enabled only after env vars verified */}
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!envVarsVerified || testResult === 'testing'}
              className="w-full"
            >
              {testResult === 'testing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {testResult === 'passed' && <CheckCircle className="mr-2 h-4 w-4 text-green-500" />}
              {testResult === 'failed' && <XCircle className="mr-2 h-4 w-4 text-red-500" />}
              {testResult === 'idle' && <Zap className="mr-2 h-4 w-4" />}
              {testResult === 'testing'
                ? 'Testing...'
                : testResult === 'passed'
                  ? 'Connection Verified'
                  : testResult === 'failed'
                    ? 'Test Failed — Retry'
                    : 'Test Exchange Connection'}
            </Button>

            {/* Test result feedback */}
            {testResult === 'passed' && (
              <p className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle className="h-3 w-3" />
                Connected to {selectedExchange.displayName} API
                {testLatency != null && ` (${testLatency}ms)`}.
              </p>
            )}
            {testResult === 'failed' && testError && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <XCircle className="h-3 w-3" />
                {testError}
              </p>
            )}

            {/* Save / Connect button — requires env vars verified + test passed */}
            <Button onClick={handleSave} disabled={!canSave} className="w-full">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saveButtonText}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EnvStatus({ found, loading }: { found: boolean | undefined; loading: boolean }) {
  if (loading) {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />;
  }
  if (found === undefined) {
    return <div className="h-4 w-4 shrink-0" />;
  }
  return found ? (
    <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
  ) : (
    <XCircle className="h-4 w-4 shrink-0 text-red-500" />
  );
}
