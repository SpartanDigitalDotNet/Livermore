import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface CandleMeterLegendProps {
  open: boolean;
  onClose: () => void;
}

const TIMEFRAME_LABELS = ['1m', '5m', '15m', '1h', '4h', '1d'];

const COLOR_LEGEND: Array<{ color: string; label: string; desc: string }> = [
  { color: 'bg-green-500', label: 'Fresh', desc: 'Within expected interval' },
  { color: 'bg-teal-500', label: 'Slightly stale', desc: 'Up to 1.5x interval' },
  { color: 'bg-amber-500', label: 'Stale', desc: 'Up to 3x interval' },
  { color: 'bg-red-500', label: 'Very stale', desc: 'Up to 10x interval' },
  { color: 'bg-gray-700', label: 'No data', desc: 'Never received' },
];

/** Reuses the same keyframes as CandleMeter for consistency */
const FLASH_KEYFRAMES = `
  @keyframes legendFlash {
    0% { box-shadow: 0 0 8px 4px rgba(250, 204, 21, 1); }
    15% { box-shadow: 0 0 4px 2px rgba(250, 204, 21, 0.5); }
    30% { box-shadow: 0 0 8px 4px rgba(250, 204, 21, 1); }
    45% { box-shadow: 0 0 4px 2px rgba(250, 204, 21, 0.5); }
    60% { box-shadow: 0 0 8px 4px rgba(250, 204, 21, 1); }
    75% { box-shadow: 0 0 4px 2px rgba(250, 204, 21, 0.5); }
    100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
  }
`;

/** Sample column of colored cells to illustrate one symbol */
function SampleColumn({ colors, flash }: { colors: string[]; flash?: boolean }) {
  return (
    <div
      className="flex flex-col gap-px rounded-sm"
      style={flash ? { animation: 'legendFlash 4s ease-out infinite' } : undefined}
    >
      {colors.map((color, i) => (
        <div key={i} className={`w-2.5 h-[4px] rounded-[0.5px] ${color}`} />
      ))}
    </div>
  );
}

export function CandleMeterLegend({ open, onClose }: CandleMeterLegendProps) {
  // Replay flash animation every 5s so user always sees it
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setFlashKey((k) => k + 1), 5000);
    return () => clearInterval(interval);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <style>{FLASH_KEYFRAMES}</style>
        <DialogHeader>
          <DialogTitle>Candle Meter Legend</DialogTitle>
          <DialogDescription>
            How to read the candle freshness visualization
          </DialogDescription>
        </DialogHeader>

        {/* Anatomy section */}
        <div className="rounded-md border p-4 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
            Anatomy of a Symbol Column
          </p>
          <div className="flex items-start gap-4">
            {/* Sample column with timeframe labels */}
            <div className="flex flex-col gap-px">
              {TIMEFRAME_LABELS.map((tf, i) => (
                <div key={tf} className="flex items-center gap-2">
                  <div className={`w-2.5 h-[4px] rounded-[0.5px] ${i < 3 ? 'bg-green-500' : i < 5 ? 'bg-amber-500' : 'bg-gray-700'}`} />
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono leading-none">{tf}</span>
                </div>
              ))}
            </div>

            <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Each thin column represents <strong>one symbol</strong>.
              <br />
              Top to bottom: shortest to longest timeframe.
              <br />
              Color shows how fresh the last candle close is, relative to the timeframe&apos;s expected interval.
            </div>
          </div>
        </div>

        {/* Color legend */}
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            Freshness Colors
          </p>
          <div className="space-y-1.5">
            {COLOR_LEGEND.map(({ color, label, desc }) => (
              <div key={label} className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-sm flex-shrink-0 ${color}`} />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 w-28">{label}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tier explanation */}
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            Market Cap Tiers
          </p>
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
            <div className="flex gap-2">
              <span className="font-medium w-24">Large-cap</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">CoinGecko rank 1&ndash;10</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium w-24">Mid-cap</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">CoinGecko rank 11&ndash;30</span>
            </div>
            <div className="flex gap-2">
              <span className="font-medium w-24">Small-cap</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">CoinGecko rank 31+</span>
            </div>
          </div>
        </div>

        {/* Alert flash demo */}
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            Alert Flash
          </p>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-gray-900 dark:bg-gray-800 rounded px-3 py-2">
              <SampleColumn colors={['bg-green-500', 'bg-green-500', 'bg-teal-500', 'bg-amber-500', 'bg-green-500', 'bg-green-500']} />
              <SampleColumn
                key={flashKey}
                colors={['bg-green-500', 'bg-green-500', 'bg-green-500', 'bg-green-500', 'bg-teal-500', 'bg-green-500']}
                flash
              />
              <SampleColumn colors={['bg-green-500', 'bg-amber-500', 'bg-green-500', 'bg-green-500', 'bg-amber-500', 'bg-gray-700']} />
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              When a trade signal fires, the symbol&apos;s column flashes yellow so you can spot which symbol triggered.
            </p>
          </div>
        </div>

        {/* Hover tip */}
        <p className="text-xs text-gray-500 dark:text-gray-400 border-t pt-3 dark:border-gray-700">
          Hover any column in the meter to see the symbol name and per-timeframe age.
        </p>
      </DialogContent>
    </Dialog>
  );
}
