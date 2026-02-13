import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, XCircle, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react';
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
  userName: string | null;
  editExchange?: {
    exchangeName: string;
    displayName: string;
    apiKeyEnvVar: string;
    apiSecretEnvVar: string;
    isDefault: boolean;
  } | null;
}

interface ExchangeInfo {
  id: number;
  name: string;
  displayName: string;
  geoRestrictions: { note: string } | null;
  isBusy: boolean;
}

export function ExchangeSetupModal({ open, onComplete, userName, editExchange }: ExchangeSetupModalProps) {
  const [selectedExchange, setSelectedExchange] = useState<ExchangeInfo | null>(null);
  const [apiKeyEnvVar, setApiKeyEnvVar] = useState('');
  const [apiSecretEnvVar, setApiSecretEnvVar] = useState('');
  const [displayNameValue, setDisplayNameValue] = useState('');
  const [isDefaultChecked, setIsDefaultChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch exchanges with availability
  const { data: statusData, isLoading: statusLoading } = useQuery(
    trpc.exchangeSymbol.exchangeStatuses.queryOptions()
  );

  // Check env vars when both inputs have values
  const envVarsToCheck = [apiKeyEnvVar, apiSecretEnvVar].filter(Boolean);
  const { data: envCheckData } = useQuery(
    trpc.exchangeSymbol.checkEnvVars.queryOptions(
      { envVars: envVarsToCheck },
      { enabled: envVarsToCheck.length === 2 }
    )
  );

  // Edit mode: pre-populate fields from editExchange prop
  useEffect(() => {
    if (editExchange) {
      // Set synthetic exchange info for header display
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
      setIsDefaultChecked(false); // Switch only shown if not already default
    }
  }, [editExchange]);

  // Auto-populate env var names when exchange is selected (create mode only)
  useEffect(() => {
    if (selectedExchange && !editExchange) {
      const prefix = selectedExchange.displayName.replace(/\s+/g, '');
      setApiKeyEnvVar(`${prefix}_ApiKeyId`);
      setApiSecretEnvVar(`${prefix}_ApiSecret`);
    }
  }, [selectedExchange, editExchange]);

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
  };

  const handleSave = async () => {
    if (!selectedExchange || !apiKeyEnvVar || !apiSecretEnvVar) return;
    setSaving(true);
    try {
      if (editExchange) {
        // Edit mode: call updateExchange
        await trpcClient.exchangeSymbol.updateExchange.mutate({
          exchangeName: editExchange.exchangeName,
          apiKeyEnvVar,
          apiSecretEnvVar,
          displayName: displayNameValue || undefined,
          isDefault: isDefaultChecked ? true : undefined,
        });
        toast.success('Exchange updated successfully!');
      } else {
        // Create mode: call setupExchange
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

  const envResults = envCheckData?.results ?? {};

  const isEditMode = !!editExchange;
  const isDismissable = isEditMode;

  return (
    <Dialog open={open} onOpenChange={isDismissable ? onComplete : undefined}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => !isDismissable && e.preventDefault()}
        onEscapeKeyDown={(e) => !isDismissable && e.preventDefault()}
        onInteractOutside={(e) => !isDismissable && e.preventDefault()}
        // Hide the default close button via CSS override if not dismissable
        style={!isDismissable ? { ['--dialog-close-display' as string]: 'none' } : {}}
      >
        {/* Hide the built-in close button in create mode */}
        {!isDismissable && <style>{`.absolute.right-4.top-4 { display: none !important; }`}</style>}

        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Exchange' : selectedExchange ? 'Configure Exchange' : 'Welcome!'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? `Update credentials for ${editExchange.exchangeName}`
              : selectedExchange
                ? `Set up API credentials for ${selectedExchange.displayName}`
                : `${userName ? `Hi ${userName}! ` : ''}Your exchange is not yet set up. Select one to get started.`}
          </DialogDescription>
        </DialogHeader>

        {!selectedExchange && !isEditMode ? (
          /* Step 1: Exchange selection (skipped in edit mode) */
          <div className="space-y-2">
            {statusLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : statusData?.exchanges.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">
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
                      ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {ex.displayName}
                    </span>
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
          /* Step 2: Env var configuration (create or edit mode) */
          <div className="space-y-4">
            {!isEditMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="mb-1 -ml-2"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            )}

            {/* Geo-restriction warning */}
            {selectedExchange.geoRestrictions?.note && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
                <p className="text-sm text-yellow-800">
                  {selectedExchange.geoRestrictions.note}
                </p>
              </div>
            )}

            {/* Display Name (edit mode only) */}
            {isEditMode && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">
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
              <label className="text-sm font-medium text-gray-700">
                API Key Environment Variable
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={apiKeyEnvVar}
                  onChange={(e) => setApiKeyEnvVar(e.target.value)}
                  placeholder="e.g. Coinbase_ApiKeyId"
                />
                <EnvStatus found={envResults[apiKeyEnvVar]} checking={envVarsToCheck.length === 2 && !envCheckData} />
              </div>
            </div>

            {/* API Secret env var */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                API Secret Environment Variable
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={apiSecretEnvVar}
                  onChange={(e) => setApiSecretEnvVar(e.target.value)}
                  placeholder="e.g. Coinbase_ApiSecret"
                />
                <EnvStatus found={envResults[apiSecretEnvVar]} checking={envVarsToCheck.length === 2 && !envCheckData} />
              </div>
            </div>

            {/* Set as Default switch (edit mode only, if not already default) */}
            {isEditMode && editExchange && !editExchange.isDefault && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="is-default"
                  checked={isDefaultChecked}
                  onCheckedChange={setIsDefaultChecked}
                />
                <Label htmlFor="is-default" className="text-sm font-medium text-gray-700">
                  Set as Default Exchange
                </Label>
              </div>
            )}

            <p className="text-xs text-gray-500">
              Ensure these environment variables are set on the server running the API.
            </p>

            <Button
              onClick={handleSave}
              disabled={saving || !apiKeyEnvVar || !apiSecretEnvVar}
              className="w-full"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditMode ? 'Update Exchange' : 'Save Exchange'}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EnvStatus({ found, checking }: { found: boolean | undefined; checking: boolean }) {
  if (checking) {
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
