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
  /**
   * signalDelta = macdV - signal (where signal = EMA(macdV, 9))
   * - Positive: macdV above signal line (bullish momentum / recovering)
   * - Negative: macdV below signal line (bearish momentum / falling)
   */
  signalDelta: number | null;
  triggeredAt: string;
}

/**
 * MACD-V color mapping based on value and signalDelta.
 * Colors match Pine Script MACD-V-MCC indicator.
 *
 * signalDelta = macdV - signal (EMA of macdV, 9)
 * - Positive signalDelta: macdV > signal = bullish momentum / recovering
 * - Negative signalDelta: macdV < signal = bearish momentum / falling
 *
 * Color meanings:
 * - Slate:   Chop zone (-50 to +50) or falling in oversold territory
 * - Teal:    Oversold (-50 to -150) with recovery momentum (potential low-risk Long)
 * - Purple:  Extreme oversold (<-150) with recovery momentum
 * - Red:     Extreme zones (±150+) without recovery / overbought exhaustion
 * - Cyan:    Early rally (+50 to +75)
 * - Lime:    Strong rally (+75 to +125)
 * - Yellow:  Extended rally (+125 to +140)
 * - Orange:  Near exhaustion (+140 to +150)
 */

/** Tailwind color values for left border */
const MACD_V_COLORS = {
  slate: '#64748b',   // slate-500
  cyan: '#06b6d4',    // cyan-500
  lime: '#84cc16',    // lime-500
  yellow: '#eab308',  // yellow-500
  orange: '#f97316',  // orange-500
  red: '#ef4444',     // red-500
  teal: '#14b8a6',    // teal-500
  purple: '#a855f7',  // purple-500
} as const;

/**
 * Get left border color for a row based on MACD-V value and signalDelta.
 * Returns a CSS style object with borderLeft property.
 */
function getMacdVBorderStyle(macdV: number | null, signalDelta: number | null): React.CSSProperties {
  if (macdV === null) return {};

  const isRecovering = signalDelta !== null && signalDelta > 0;
  const absMacdV = Math.abs(macdV);

  // Extreme zones (±150+)
  if (absMacdV >= 150) {
    if (macdV < 0 && isRecovering) return { borderLeft: `4px solid ${MACD_V_COLORS.purple}` };
    return { borderLeft: `4px solid ${MACD_V_COLORS.red}` };
  }

  // Positive side (bullish momentum)
  if (macdV > 0) {
    if (macdV <= 50) return { borderLeft: `4px solid ${MACD_V_COLORS.slate}` };
    if (macdV <= 75) return { borderLeft: `4px solid ${MACD_V_COLORS.cyan}` };
    if (macdV <= 125) return { borderLeft: `4px solid ${MACD_V_COLORS.lime}` };
    if (macdV <= 140) return { borderLeft: `4px solid ${MACD_V_COLORS.yellow}` };
    return { borderLeft: `4px solid ${MACD_V_COLORS.orange}` };
  }

  // Negative side
  if (macdV >= -50) return { borderLeft: `4px solid ${MACD_V_COLORS.slate}` };
  if (isRecovering) return { borderLeft: `4px solid ${MACD_V_COLORS.teal}` };
  return { borderLeft: `4px solid ${MACD_V_COLORS.slate}` };
}

/**
 * Get background color class for highlighted (new) rows.
 */
function getMacdVBgClass(macdV: number | null, signalDelta: number | null): string {
  if (macdV === null) return '';

  const isRecovering = signalDelta !== null && signalDelta > 0;
  const absMacdV = Math.abs(macdV);

  if (absMacdV >= 150) {
    if (macdV < 0 && isRecovering) return 'bg-purple-100';
    return 'bg-red-100';
  }

  if (macdV > 0) {
    if (macdV <= 50) return 'bg-slate-100';
    if (macdV <= 75) return 'bg-cyan-100';
    if (macdV <= 125) return 'bg-lime-100';
    if (macdV <= 140) return 'bg-yellow-100';
    return 'bg-orange-100';
  }

  if (macdV >= -50) return 'bg-slate-100';
  if (isRecovering) return 'bg-teal-100';
  return 'bg-slate-100';
}

interface SignalsTableProps {
  data: Signal[];
  highlightedIds?: Set<number>;
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

export function SignalsTable({ data, highlightedIds }: SignalsTableProps) {
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
            const isHighlighted = highlightedIds?.has(signal.id);
            const borderStyle = getMacdVBorderStyle(signal.triggerValue, signal.signalDelta);
            const bgClass = isHighlighted ? getMacdVBgClass(signal.triggerValue, signal.signalDelta) : '';
            return (
              <TableRow
                key={signal.id}
                style={borderStyle}
                className={isHighlighted ? `animate-highlight-fade ${bgClass}` : ''}
              >
                <TableCell className="font-mono text-sm">
                  {new Date(signal.triggeredAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <img
                      src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${signal.symbol.split(/[-/]/)[0].toLowerCase()}.svg`}
                      alt=""
                      className="h-5 w-5"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    {signal.symbol}
                  </span>
                </TableCell>
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
