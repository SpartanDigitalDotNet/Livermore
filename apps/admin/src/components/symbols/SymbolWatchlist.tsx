import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3 } from 'lucide-react';
import { SymbolRow } from './SymbolRow';

interface SymbolWatchlistProps {
  symbols: string[];
  disabledSymbols?: string[];
  onToggle: (symbol: string, enabled: boolean) => void;
  onRemove: (symbol: string) => void;
  removingSymbol?: string | null;
  isLoading?: boolean;
}

/**
 * SymbolWatchlist Component
 *
 * Displays the user's symbol watchlist (UI-SYM-01):
 * - List of symbols with enable/disable toggles
 * - Each symbol is rendered via SymbolRow
 * - Shows empty state when no symbols configured
 */
export function SymbolWatchlist({
  symbols,
  disabledSymbols = [],
  onToggle,
  onRemove,
  removingSymbol,
  isLoading,
}: SymbolWatchlistProps) {
  const disabledSet = new Set(disabledSymbols);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Watchlist
          {!isLoading && <Badge variant="secondary">{symbols.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-600" />
          </div>
        ) : symbols.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No symbols in your watchlist</p>
            <p className="text-sm mt-1">
              Add symbols using the form above
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {symbols.map((symbol) => (
              <SymbolRow
                key={symbol}
                symbol={symbol}
                enabled={!disabledSet.has(symbol)}
                onToggle={(enabled) => onToggle(symbol, enabled)}
                onRemove={() => onRemove(symbol)}
                isRemoving={removingSymbol === symbol}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
