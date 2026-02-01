import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, AlertCircle } from 'lucide-react';

interface ScannerStatusProps {
  scanner?: {
    enabled: boolean;
    exchange: string;
    lastRun?: string;
  } | null;
  isLoading?: boolean;
}

/**
 * ScannerStatus Component
 *
 * Displays scanner status information (UI-SYM-05):
 * - Enabled/disabled state
 * - Target exchange
 * - Last run timestamp (if available)
 */
export function ScannerStatus({ scanner, isLoading }: ScannerStatusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Scanner Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600" />
          </div>
        ) : scanner ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Status</span>
              <Badge variant={scanner.enabled ? 'default' : 'secondary'}>
                {scanner.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Exchange</span>
              <span className="text-sm font-medium">{scanner.exchange}</span>
            </div>
            {scanner.lastRun && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Last Run</span>
                <span className="text-sm">
                  {new Date(scanner.lastRun).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-gray-500">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Scanner not configured</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
