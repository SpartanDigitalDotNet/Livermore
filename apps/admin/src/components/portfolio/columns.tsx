import { createColumnHelper } from '@tanstack/react-table';

interface PortfolioSymbol {
  symbol: string;
  price: number | null;
  values: Record<string, number | null>;
  signal: string;
  stage: string;
  liquidity: string;
}

const columnHelper = createColumnHelper<PortfolioSymbol>();

/**
 * Format price with appropriate precision.
 */
function formatPrice(price: number | null): string {
  if (price === null) return '-';
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Format MACD-V value with color coding.
 */
function formatMacdV(value: number | null): { text: string; color: string } {
  if (value === null) return { text: '-', color: 'text-gray-400' };
  const text = value.toFixed(1);
  if (value > 50) return { text, color: 'text-green-600 font-medium' };
  if (value > 0) return { text, color: 'text-green-500' };
  if (value > -50) return { text, color: 'text-red-500' };
  return { text, color: 'text-red-600 font-medium' };
}

/**
 * Get signal badge styling.
 */
function getSignalStyle(signal: string): string {
  switch (signal) {
    case 'STRONG BUY':
      return 'bg-green-100 text-green-800';
    case 'Bullish':
      return 'bg-green-50 text-green-700';
    case 'STRONG SELL':
      return 'bg-red-100 text-red-800';
    case 'Bearish':
      return 'bg-red-50 text-red-700';
    case 'Reversal Up?':
      return 'bg-yellow-100 text-yellow-800';
    case 'Reversal Down?':
      return 'bg-orange-100 text-orange-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export const columns = [
  columnHelper.accessor('symbol', {
    header: 'Symbol',
    cell: (info) => (
      <span className="font-medium">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('price', {
    header: 'Price',
    cell: (info) => (
      <span className="font-mono">${formatPrice(info.getValue())}</span>
    ),
  }),
  columnHelper.accessor((row) => row.values['1h'], {
    id: '1h',
    header: '1h',
    cell: (info) => {
      const { text, color } = formatMacdV(info.getValue() ?? null);
      return <span className={`font-mono ${color}`}>{text}</span>;
    },
  }),
  columnHelper.accessor((row) => row.values['4h'], {
    id: '4h',
    header: '4h',
    cell: (info) => {
      const { text, color } = formatMacdV(info.getValue() ?? null);
      return <span className={`font-mono ${color}`}>{text}</span>;
    },
  }),
  columnHelper.accessor((row) => row.values['1d'], {
    id: '1d',
    header: '1d',
    cell: (info) => {
      const { text, color } = formatMacdV(info.getValue() ?? null);
      return <span className={`font-mono ${color}`}>{text}</span>;
    },
  }),
  columnHelper.accessor('signal', {
    header: 'Signal',
    cell: (info) => (
      <span
        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getSignalStyle(info.getValue())}`}
      >
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('stage', {
    header: 'Stage',
    cell: (info) => (
      <span className="capitalize">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('liquidity', {
    header: 'Liquidity',
    cell: (info) => {
      const liq = info.getValue();
      const color =
        liq === 'high'
          ? 'text-green-600'
          : liq === 'medium'
            ? 'text-yellow-600'
            : 'text-red-600';
      return <span className={`capitalize ${color}`}>{liq}</span>;
    },
  }),
];

export type { PortfolioSymbol };
