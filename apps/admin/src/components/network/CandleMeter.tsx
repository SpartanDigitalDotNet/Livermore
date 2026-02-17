import { useMemo, useState, useCallback } from 'react';
import { useCandlePulse } from '@/contexts/CandlePulseContext';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

/** Expected candle interval in milliseconds per timeframe */
const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

function getColor(timestamp: number | null, nowMs: number, timeframe: string): string {
  if (timestamp === null) return 'bg-gray-700';

  const age = nowMs - timestamp;
  const interval = INTERVAL_MS[timeframe] ?? 300_000;
  const ratio = age / interval;

  if (ratio < 1.0) return 'bg-green-500';
  if (ratio < 1.5) return 'bg-teal-500';
  if (ratio < 3.0) return 'bg-amber-500';
  if (ratio < 10) return 'bg-red-500';
  return 'bg-gray-700';
}

function formatAge(timestamp: number | null, nowMs: number): string {
  if (timestamp === null) return 'no data';
  const ageSec = Math.floor((nowMs - timestamp) / 1000);
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ${Math.floor((ageSec % 3600) / 60)}m`;
  return `${Math.floor(ageSec / 86400)}d`;
}

interface CandleMeterProps {
  exchangeId: number;
  symbols: string[];
}

export function CandleMeter({ exchangeId, symbols }: CandleMeterProps) {
  const { getTimestamp, displayTick } = useCandlePulse();
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const nowMs = useMemo(() => Date.now(), [displayTick]);

  const handleMouseEnter = useCallback((symbol: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
    setHoveredSymbol(symbol);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredSymbol(null);
  }, []);

  if (symbols.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        Candle Freshness
      </p>
      <div className="flex flex-wrap gap-x-px gap-y-1.5">
        {symbols.map((symbol) => (
          <div
            key={symbol}
            className="flex flex-col gap-px cursor-default"
            onMouseEnter={(e) => handleMouseEnter(symbol, e)}
            onMouseLeave={handleMouseLeave}
          >
            {TIMEFRAMES.map((tf) => {
              const ts = getTimestamp(exchangeId, symbol, tf);
              const color = getColor(ts, nowMs, tf);
              return (
                <div
                  key={tf}
                  className={`w-2 h-[3px] rounded-[0.5px] ${color}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Custom tooltip — renders instantly, follows hovered symbol */}
      {hoveredSymbol && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y - 2,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="rounded-md border border-gray-800 bg-gray-900 text-gray-50 px-3 py-1.5 text-xs shadow-md">
            <p className="font-semibold mb-1">{hoveredSymbol}</p>
            {TIMEFRAMES.map((tf) => {
              const ts = getTimestamp(exchangeId, hoveredSymbol, tf);
              return (
                <div key={tf} className="flex justify-between gap-3">
                  <span className="text-gray-400">{tf}</span>
                  <span>{formatAge(ts, nowMs)}</span>
                </div>
              );
            })}
          </div>
          {/* Arrow pointing down */}
          <svg width="20" height="10" viewBox="0 0 20 10" className="mx-auto block" style={{ marginTop: '-2px' }}>
            <path d="M0 0 L10 10 L20 0" fill="rgb(75,85,99)" />
            <path d="M2 0 L10 8 L18 0" fill="rgb(17,24,39)" />
          </svg>
        </div>
      )}
    </div>
  );
}
