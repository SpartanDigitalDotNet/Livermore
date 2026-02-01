import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { trpc, trpcClient } from '@/lib/trpc';

interface AddSymbolFormProps {
  existingSymbols: string[];
  onSymbolAdded: () => void;
}

/**
 * Format price with appropriate decimal places
 */
function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (isNaN(num)) return price;
  return num < 1 ? num.toFixed(6) : num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Format percentage change with sign
 */
function formatChange(change: string): string {
  const num = parseFloat(change);
  if (isNaN(num)) return change;
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

/**
 * Format volume with abbreviations
 */
function formatVolume(volume: string): string {
  const num = parseFloat(volume);
  if (isNaN(num)) return volume;

  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

/**
 * AddSymbolForm Component
 *
 * Provides symbol search, validation preview, and add functionality:
 * - Search with autocomplete suggestions (UI-SYM-02)
 * - Validation with metrics preview before adding
 * - Clear error messages for invalid symbols
 */
export function AddSymbolForm({
  existingSymbols,
  onSymbolAdded,
}: AddSymbolFormProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search for symbols
  const {
    data: searchResults,
    isLoading: searchLoading,
  } = useQuery({
    ...trpc.symbol.search.queryOptions({ query: debouncedQuery, limit: 10 }),
    enabled: debouncedQuery.length >= 1 && !selectedSymbol,
  });

  // Validate selected symbol
  const {
    data: validation,
    isLoading: validationLoading,
  } = useQuery({
    ...trpc.symbol.validate.queryOptions({ symbol: selectedSymbol ?? '' }),
    enabled: !!selectedSymbol,
  });

  // Add symbol mutation
  const addSymbolMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const result = await trpcClient.control.executeCommand.mutate({
        type: 'add-symbol',
        payload: { symbol },
      });
      return result;
    },
    onSuccess: (result, symbol) => {
      if (result.success) {
        toast.success(`Symbol ${symbol} added to watchlist`);
        setSearchQuery('');
        setSelectedSymbol(null);
        onSymbolAdded();
      } else {
        toast.error(result.message ?? 'Failed to add symbol');
      }
    },
    onError: (err) => {
      toast.error(`Failed to add symbol: ${err.message}`);
    },
  });

  // Handle selecting a symbol from search results
  const handleSelectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    setSearchQuery(symbol);
  }, []);

  // Handle clearing selection
  const handleClearSelection = useCallback(() => {
    setSelectedSymbol(null);
    setSearchQuery('');
  }, []);

  // Handle add button click
  const handleAdd = () => {
    if (!selectedSymbol || !validation?.valid) return;
    addSymbolMutation.mutate(validation.symbol);
  };

  // Check if symbol already exists
  const alreadyExists = selectedSymbol
    ? existingSymbols.includes(selectedSymbol.toUpperCase())
    : false;

  // Extract metrics from validation (type narrowing for union type)
  const validationMetrics = validation?.valid && 'metrics' in validation ? validation.metrics : null;
  const validationError = validation && !validation.valid && 'error' in validation ? validation.error : null;

  // Filter search results to exclude existing symbols
  const filteredResults = searchResults?.results?.filter(
    (r) => !existingSymbols.includes(r.symbol)
  ) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Symbol
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Input */}
        <div className="relative">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedSymbol) setSelectedSymbol(null);
                }}
                placeholder="Search symbols (e.g., BTC, ETH, SOL)"
                className="pl-10"
              />
            </div>
            {selectedSymbol && (
              <Button variant="ghost" size="sm" onClick={handleClearSelection}>
                Clear
              </Button>
            )}
          </div>

          {/* Search Results Dropdown */}
          {!selectedSymbol &&
            debouncedQuery.length >= 1 &&
            (searchLoading || filteredResults.length > 0) && (
              <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
                {searchLoading ? (
                  <div className="p-3 text-center text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Searching...
                  </div>
                ) : filteredResults.length === 0 ? (
                  <div className="p-3 text-center text-gray-500">
                    No new symbols found
                  </div>
                ) : (
                  filteredResults.map((result) => (
                    <button
                      key={result.symbol}
                      onClick={() => handleSelectSymbol(result.symbol)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center justify-between"
                    >
                      <span className="font-mono font-medium">
                        {result.symbol}
                      </span>
                      <span className="text-sm text-gray-500">
                        {result.baseName}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
        </div>

        {/* Validation Preview */}
        {selectedSymbol && (
          <div className="border rounded-lg p-4">
            {validationLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Validating...</span>
              </div>
            ) : validation?.valid ? (
              <div className="space-y-3">
                {/* Symbol Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-mono font-bold text-lg">
                      {validation.symbol}
                    </span>
                    {alreadyExists && (
                      <Badge variant="secondary">Already in watchlist</Badge>
                    )}
                  </div>
                  <Badge variant="outline">Coinbase</Badge>
                </div>

                {/* Metrics */}
                {validationMetrics && (
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Price</span>
                      <div className="font-medium">
                        ${formatPrice(validationMetrics.price)}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-500">24h Change</span>
                      <div
                        className={
                          parseFloat(validationMetrics.priceChange24h) >= 0
                            ? 'text-green-600 font-medium'
                            : 'text-red-600 font-medium'
                        }
                      >
                        {formatChange(validationMetrics.priceChange24h)}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-500">24h Volume</span>
                      <div className="font-medium">
                        {formatVolume(validationMetrics.volume24h)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Add Button */}
                <Button
                  onClick={handleAdd}
                  disabled={addSymbolMutation.isPending || alreadyExists}
                  className="w-full"
                >
                  {addSymbolMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : alreadyExists ? (
                    'Already in Watchlist'
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add to Watchlist
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                <span>
                  {validationError ?? 'Symbol not found on exchange'}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
