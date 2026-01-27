import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Signal {
  id: number;
  symbol: string;
  alertType: string;
  timeframe: string | null;
  price: number;
  triggerValue: number | null;
  triggeredAt: string;
}

interface SignalsTableProps {
  data: Signal[];
}

function formatAlertType(type: string): { label: string; color: string } {
  switch (type) {
    case 'oversold':
      return { label: 'Oversold', color: 'bg-green-100 text-green-800' };
    case 'overbought':
      return { label: 'Overbought', color: 'bg-red-100 text-red-800' };
    case 'crossover_bullish':
      return { label: 'Bullish Crossover', color: 'bg-green-50 text-green-700' };
    case 'crossover_bearish':
      return { label: 'Bearish Crossover', color: 'bg-red-50 text-red-700' };
    case 'divergence_bullish':
      return { label: 'Bullish Divergence', color: 'bg-blue-100 text-blue-800' };
    case 'divergence_bearish':
      return { label: 'Bearish Divergence', color: 'bg-orange-100 text-orange-800' };
    default:
      return { label: type, color: 'bg-gray-100 text-gray-700' };
  }
}

export function SignalsTable({ data }: SignalsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Signal Type</TableHead>
          <TableHead>Timeframe</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-gray-500">
              No signals triggered
            </TableCell>
          </TableRow>
        ) : (
          data.map((signal) => {
            const { label, color } = formatAlertType(signal.alertType);
            return (
              <TableRow key={signal.id}>
                <TableCell className="font-mono text-sm">
                  {new Date(signal.triggeredAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-medium">{signal.symbol}</TableCell>
                <TableCell>
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${color}`}
                  >
                    {label}
                  </span>
                </TableCell>
                <TableCell>{signal.timeframe ?? '-'}</TableCell>
                <TableCell className="font-mono">
                  ${signal.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="font-mono">
                  {signal.triggerValue?.toFixed(1) ?? '-'}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

export type { Signal };
