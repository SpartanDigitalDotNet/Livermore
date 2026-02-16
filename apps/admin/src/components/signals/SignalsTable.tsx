import type { ComponentType } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ExchangeBinance, ExchangeCoinbase, ExchangeKraken } from '@web3icons/react';

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
  exchangeId: number | null;
  exchangeName: string | null;
  triggerLabel: string | null;
}

/** Exchange ID → display name + icon */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EXCHANGE_MAP: Record<number, { name: string; icon: ComponentType<any> | null }> = {
  1: { name: 'Coinbase', icon: ExchangeCoinbase },
  2: { name: 'Binance', icon: ExchangeBinance },
  3: { name: 'BinanceUS', icon: ExchangeBinance },
  4: { name: 'Kraken', icon: ExchangeKraken },
};

/**
 * Format triggerLabel for display.
 * level_150 → "Level 150", level_-150 → "Level -150"
 * reversal_overbought → "Reversal OB", reversal_oversold → "Reversal OS"
 */
function formatTriggerLabel(label: string | null): { text: string; colorClass: string } | null {
  if (!label) return null;

  if (label.startsWith('level_')) {
    const level = label.slice(6); // e.g. "150", "-150"
    const num = parseFloat(level);
    const isNeg = num < 0;
    return {
      text: `Level ${level}`,
      colorClass: isNeg
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-600 dark:text-red-400',
    };
  }

  if (label.startsWith('reversal_')) {
    const zone = label.slice(9); // e.g. "overbought", "oversold"
    if (zone === 'overbought') {
      return { text: 'Reversal OB', colorClass: 'text-red-600 dark:text-red-400' };
    }
    if (zone === 'oversold') {
      return { text: 'Reversal OS', colorClass: 'text-green-600 dark:text-green-400' };
    }
    return { text: `Reversal ${zone}`, colorClass: 'text-gray-500 dark:text-gray-400' };
  }

  return { text: label, colorClass: 'text-gray-500 dark:text-gray-400' };
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

/** Color hex + RGB for each MACD-V zone */
const MACD_V_COLORS = {
  slate:  { hex: '#64748b', rgb: '100 116 139' },
  cyan:   { hex: '#06b6d4', rgb: '6 182 212' },
  lime:   { hex: '#84cc16', rgb: '132 204 22' },
  yellow: { hex: '#eab308', rgb: '234 179 8' },
  orange: { hex: '#f97316', rgb: '249 115 22' },
  red:    { hex: '#ef4444', rgb: '239 68 68' },
  teal:   { hex: '#14b8a6', rgb: '20 184 166' },
  purple: { hex: '#e040fb', rgb: '224 64 251' },
} as const;

/** Get dot color hex for MACD-V zone. */
function getMacdVDotColor(macdV: number | null, signalDelta: number | null): string | null {
  if (macdV === null) return null;

  const isRecovering = signalDelta !== null && signalDelta > 0;
  const absMacdV = Math.abs(macdV);

  if (absMacdV >= 150) {
    return (macdV < 0 && isRecovering) ? MACD_V_COLORS.purple.hex : MACD_V_COLORS.red.hex;
  }
  if (macdV > 0) {
    if (macdV <= 50) return MACD_V_COLORS.slate.hex;
    if (macdV <= 75) return MACD_V_COLORS.cyan.hex;
    if (macdV <= 125) return MACD_V_COLORS.lime.hex;
    if (macdV <= 140) return MACD_V_COLORS.yellow.hex;
    return MACD_V_COLORS.orange.hex;
  }
  if (macdV >= -50) return MACD_V_COLORS.slate.hex;
  return isRecovering ? MACD_V_COLORS.teal.hex : MACD_V_COLORS.slate.hex;
}

/**
 * Get background color class for highlighted (new) rows.
 */
function getMacdVBgClass(macdV: number | null, signalDelta: number | null): string {
  if (macdV === null) return '';

  const isRecovering = signalDelta !== null && signalDelta > 0;
  const absMacdV = Math.abs(macdV);

  if (absMacdV >= 150) {
    if (macdV < 0 && isRecovering) return 'bg-purple-100 dark:bg-purple-900/20';
    return 'bg-red-100 dark:bg-red-900/20';
  }

  if (macdV > 0) {
    if (macdV <= 50) return 'bg-slate-100 dark:bg-slate-800/20';
    if (macdV <= 75) return 'bg-cyan-100 dark:bg-cyan-900/20';
    if (macdV <= 125) return 'bg-lime-100 dark:bg-lime-900/20';
    if (macdV <= 140) return 'bg-yellow-100 dark:bg-yellow-900/20';
    return 'bg-orange-100 dark:bg-orange-900/20';
  }

  if (macdV >= -50) return 'bg-slate-100 dark:bg-slate-800/20';
  if (isRecovering) return 'bg-teal-100 dark:bg-teal-900/20';
  return 'bg-slate-100 dark:bg-slate-800/20';
}

interface SignalsTableProps {
  data: Signal[];
  highlightedIds?: Set<number>;
}

function formatAlertType(type: string): { label: string; color: string } {
  switch (type) {
    case 'oversold':
      return { label: 'Oversold', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' };
    case 'overbought':
      return { label: 'Overbought', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };
    case 'crossover_bullish':
      return { label: 'Bullish Crossover', color: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' };
    case 'crossover_bearish':
      return { label: 'Bearish Crossover', color: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' };
    case 'divergence_bullish':
      return { label: 'Bullish Divergence', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'divergence_bearish':
      return { label: 'Bearish Divergence', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' };
    default:
      return { label: type, color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' };
  }
}

export function SignalsTable({ data, highlightedIds }: SignalsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Exchange</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Signal Type</TableHead>
          <TableHead>Label</TableHead>
          <TableHead>Timeframe</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-gray-500 dark:text-gray-400">
              No signals triggered
            </TableCell>
          </TableRow>
        ) : (
          data.map((signal) => {
            const { label, color } = formatAlertType(signal.alertType);
            const isHighlighted = highlightedIds?.has(signal.id);
            const dotColor = getMacdVDotColor(signal.triggerValue, signal.signalDelta);
            const bgClass = isHighlighted ? getMacdVBgClass(signal.triggerValue, signal.signalDelta) : '';
            const exchange = signal.exchangeId ? EXCHANGE_MAP[signal.exchangeId] : null;
            const triggerFormatted = formatTriggerLabel(signal.triggerLabel);
            return (
              <TableRow
                key={signal.id}
                className={isHighlighted ? `animate-highlight-fade ${bgClass}` : ''}
              >
                <TableCell className="font-mono text-sm">
                  <span className="flex items-center gap-2">
                    {dotColor && (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: dotColor }}
                      />
                    )}
                    {new Date(signal.triggeredAt).toLocaleString()}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    {exchange?.icon ? (
                      <exchange.icon size={18} variant="branded" />
                    ) : exchange ? (
                      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {exchange.name.charAt(0)}
                      </span>
                    ) : null}
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {exchange?.name ?? '-'}
                    </span>
                  </span>
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
                <TableCell>
                  {triggerFormatted ? (
                    <span className={`text-xs font-medium ${triggerFormatted.colorClass}`}>
                      {triggerFormatted.text}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
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

export { EXCHANGE_MAP };
export type { Signal };
