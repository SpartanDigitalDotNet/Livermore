import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Upload,
} from 'lucide-react';
import { trpcClient } from '@/lib/trpc';

interface ValidationResult {
  symbol: string;
  status: 'valid' | 'invalid' | 'duplicate';
  metrics?: {
    price: string;
    volume24h: string;
    priceChange24h: string;
    baseName: string;
    quoteName: string;
  };
  error?: string;
}

interface BulkImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

/**
 * BulkImportModal Component
 *
 * Modal for bulk importing symbols (UI-SYM-04):
 * - JSON array input (paste or type)
 * - Validation preview showing status for each symbol
 * - Import button to add all valid symbols at once
 */
export function BulkImportModal({
  open,
  onOpenChange,
  onImportComplete,
}: BulkImportModalProps) {
  const queryClient = useQueryClient();

  const [jsonInput, setJsonInput] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<
    ValidationResult[] | null
  >(null);

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: async (symbols: string[]) => {
      const result = await trpcClient.symbol.bulkValidate.query({ symbols });
      return result;
    },
    onSuccess: (data) => {
      setValidationResults(data.results);
    },
    onError: (err) => {
      toast.error(`Validation failed: ${err.message}`);
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (symbols: string[]) => {
      const result = await trpcClient.control.executeCommand.mutate({
        type: 'bulk-add-symbols',
        payload: { symbols },
      });
      return result;
    },
    onSuccess: (result) => {
      if (result.success) {
        const data = result.data as {
          added: number;
          skipped: number;
          totalSymbols: number;
        };
        toast.success(
          `Imported ${data.added} symbols (${data.skipped} skipped)`
        );
        handleClose();
        onImportComplete();
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      } else {
        toast.error(result.message ?? 'Import failed');
      }
    },
    onError: (err) => {
      toast.error(`Import failed: ${err.message}`);
    },
  });

  // Handle validate button
  const handleValidate = () => {
    setParseError(null);
    setValidationResults(null);

    try {
      const parsed = JSON.parse(jsonInput);

      if (!Array.isArray(parsed)) {
        setParseError('Input must be a JSON array (e.g., ["BTC-USD", "ETH-USD"])');
        return;
      }

      if (parsed.length === 0) {
        setParseError('Array cannot be empty');
        return;
      }

      if (parsed.length > 50) {
        setParseError('Maximum 50 symbols allowed per import');
        return;
      }

      // Ensure all items are strings
      const symbols = parsed.filter((item): item is string => typeof item === 'string');

      if (symbols.length !== parsed.length) {
        setParseError('All array items must be strings');
        return;
      }

      validateMutation.mutate(symbols);
    } catch {
      setParseError('Invalid JSON. Example: ["BTC-USD", "ETH-USD", "SOL-USD"]');
    }
  };

  // Handle import button
  const handleImport = () => {
    if (!validationResults) return;

    const validSymbols = validationResults
      .filter((r) => r.status === 'valid')
      .map((r) => r.symbol);

    if (validSymbols.length === 0) {
      toast.error('No valid symbols to import');
      return;
    }

    importMutation.mutate(validSymbols);
  };

  // Handle close/reset
  const handleClose = () => {
    setJsonInput('');
    setParseError(null);
    setValidationResults(null);
    onOpenChange(false);
  };

  // Count results by status
  const validCount =
    validationResults?.filter((r) => r.status === 'valid').length ?? 0;
  const invalidCount =
    validationResults?.filter((r) => r.status === 'invalid').length ?? 0;
  const duplicateCount =
    validationResults?.filter((r) => r.status === 'duplicate').length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk Import Symbols
          </DialogTitle>
          <DialogDescription>
            Paste a JSON array of symbols to validate and import. Maximum 50
            symbols per import.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* JSON Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Symbol Array (JSON)
            </label>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='["BTC-USD", "ETH-USD", "SOL-USD"]'
              className="w-full h-32 px-3 py-2 border rounded-md font-mono text-sm resize-none"
              disabled={validateMutation.isPending || importMutation.isPending}
            />
            {parseError && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{parseError}</p>
            )}
          </div>

          {/* Validate Button */}
          {!validationResults && (
            <Button
              onClick={handleValidate}
              disabled={
                !jsonInput.trim() ||
                validateMutation.isPending ||
                importMutation.isPending
              }
              className="w-full"
            >
              {validateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Validating...
                </>
              ) : (
                'Validate Symbols'
              )}
            </Button>
          )}

          {/* Validation Results */}
          {validationResults && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  {validCount} valid
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" />
                    {invalidCount} invalid
                  </Badge>
                )}
                {duplicateCount > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {duplicateCount} duplicate
                  </Badge>
                )}
              </div>

              {/* Results List */}
              <div className="border rounded-md max-h-60 overflow-auto">
                {validationResults.map((result) => (
                  <div
                    key={result.symbol}
                    className="flex items-center justify-between px-3 py-2 border-b last:border-b-0"
                  >
                    <div className="flex items-center gap-2">
                      {result.status === 'valid' && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                      {result.status === 'invalid' && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      {result.status === 'duplicate' && (
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                      )}
                      <span className="font-mono font-medium">
                        {result.symbol}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {result.status === 'valid' && result.metrics && (
                        <span>${parseFloat(result.metrics.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      )}
                      {result.status === 'invalid' && (
                        <span className="text-red-500">
                          {result.error ?? 'Not found'}
                        </span>
                      )}
                      {result.status === 'duplicate' && (
                        <span>Already in watchlist</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Edit / Import Buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setValidationResults(null)}
                  disabled={importMutation.isPending}
                >
                  Edit Input
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={validCount === 0 || importMutation.isPending}
                  className="flex-1"
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `Import ${validCount} Symbol${validCount !== 1 ? 's' : ''}`
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={importMutation.isPending}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
