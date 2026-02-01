import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3 } from 'lucide-react';

interface ActiveSymbolsProps {
  symbols: string[];
  isLoading?: boolean;
}

/**
 * ActiveSymbols Component
 *
 * Displays count and list of currently monitored symbols (UI-CTL-04).
 * Symbols are fetched from user settings.
 */
export function ActiveSymbols({ symbols, isLoading }: ActiveSymbolsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Active Symbols
          {!isLoading && <Badge variant="secondary">{symbols.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600" />
          </div>
        ) : symbols.length === 0 ? (
          <p className="text-gray-500 text-sm">No symbols being monitored</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {symbols.map((symbol) => (
              <Badge key={symbol} variant="outline" className="font-mono">
                {symbol}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
