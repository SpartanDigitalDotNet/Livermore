import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface SymbolRowProps {
  symbol: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  isRemoving?: boolean;
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

  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(2)}K`;
  }
  return `$${num.toFixed(2)}`;
}

/**
 * SymbolRow Component
 *
 * Displays individual symbol with:
 * - Enable/disable toggle (UI-SYM-01)
 * - Expandable metrics display (UI-SYM-06)
 * - Remove button
 */
export function SymbolRow({
  symbol,
  enabled,
  onToggle,
  onRemove,
  isRemoving,
}: SymbolRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Fetch metrics when expanded
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    ...trpc.symbol.validate.queryOptions({ symbol }),
    enabled: expanded, // Only fetch when expanded
    staleTime: 60_000, // Cache for 1 minute
  });

  const priceData = metrics?.valid && 'metrics' in metrics ? metrics.metrics : null;

  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Enable/Disable Toggle */}
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={isRemoving}
          />

          {/* Symbol Name */}
          <span className="font-mono font-medium">{symbol}</span>

          {/* Backfilling indicator would go here if tracking state */}
        </div>

        <div className="flex items-center gap-4">
          {/* Price preview (from cached metrics if available) */}
          {priceData && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <div className="text-sm text-right">
                    <div className="font-medium">
                      ${formatPrice(priceData.price)}
                    </div>
                    <div
                      className={
                        parseFloat(priceData.priceChange24h) >= 0
                          ? 'text-green-600'
                          : 'text-red-600'
                      }
                    >
                      {formatChange(priceData.priceChange24h)}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>24h Volume: {formatVolume(priceData.volume24h)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Expand/Collapse Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>

          {/* Remove Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={isRemoving}
            className="text-red-500 hover:text-red-700 hover:bg-red-50"
          >
            {isRemoving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="text-lg">&times;</span>
            )}
          </Button>
        </div>
      </div>

      {/* Expanded Metrics Section */}
      {expanded && (
        <div className="mt-3 pt-3 border-t">
          {metricsLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : priceData ? (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Price</span>
                <div className="font-medium">
                  ${formatPrice(priceData.price)}
                </div>
              </div>
              <div>
                <span className="text-gray-500">24h Change</span>
                <div
                  className={
                    parseFloat(priceData.priceChange24h) >= 0
                      ? 'text-green-600 font-medium'
                      : 'text-red-600 font-medium'
                  }
                >
                  {formatChange(priceData.priceChange24h)}
                </div>
              </div>
              <div>
                <span className="text-gray-500">24h Volume</span>
                <div className="font-medium">
                  {formatVolume(priceData.volume24h)}
                </div>
              </div>
              <div>
                <span className="text-gray-500">Base</span>
                <div className="font-medium">{priceData.baseName}</div>
              </div>
              <div>
                <span className="text-gray-500">Quote</span>
                <div className="font-medium">{priceData.quoteName}</div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              Unable to fetch metrics
            </p>
          )}
        </div>
      )}
    </div>
  );
}
