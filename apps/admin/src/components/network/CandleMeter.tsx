import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useCandlePulse } from '@/contexts/CandlePulseContext';
import { useAlertContext } from '@/contexts/AlertContext';
import { CandleMeterLegend } from './CandleMeterLegend';

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

const FLASH_DURATION_MS = 4000;

/** Tier cutoffs by globalRank */
const LARGE_CAP_MAX_RANK = 10;
const MID_CAP_MAX_RANK = 30;

interface TierGroup {
  label: string;
  symbols: string[];
}

function classifyTiers(symbols: string[], ranks: Record<string, number | null>): TierGroup[] {
  const large: string[] = [];
  const mid: string[] = [];
  const small: string[] = [];

  for (const symbol of symbols) {
    const rank = ranks[symbol];
    if (rank != null && rank <= LARGE_CAP_MAX_RANK) {
      large.push(symbol);
    } else if (rank != null && rank <= MID_CAP_MAX_RANK) {
      mid.push(symbol);
    } else {
      small.push(symbol);
    }
  }

  const groups: TierGroup[] = [];
  if (large.length > 0) groups.push({ label: `Large-cap (${large.length})`, symbols: large });
  if (mid.length > 0) groups.push({ label: `Mid-cap (${mid.length})`, symbols: mid });
  if (small.length > 0) groups.push({ label: `Small-cap (${small.length})`, symbols: small });
  return groups;
}

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
  ranks?: Record<string, number | null>;
}

export function CandleMeter({ exchangeId, symbols, ranks = {} }: CandleMeterProps) {
  const { getTimestamp, displayTick } = useCandlePulse();
  const { lastAlert } = useAlertContext();
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [flashingSymbols, setFlashingSymbols] = useState<Set<string>>(new Set());
  const [showLegend, setShowLegend] = useState(false);
  const timersRef = useRef<Map<string, number>>(new Map());

  const nowMs = useMemo(() => Date.now(), [displayTick]);

  const tiers = useMemo(() => classifyTiers(symbols, ranks), [symbols, ranks]);

  // Flash a symbol column when an alert fires for it
  useEffect(() => {
    if (!lastAlert) return;
    const symbol = lastAlert.symbol;
    if (!symbols.includes(symbol)) return;

    // Add to flashing set
    setFlashingSymbols((prev) => new Set(prev).add(symbol));

    // Clear any existing timer for this symbol
    const existing = timersRef.current.get(symbol);
    if (existing) clearTimeout(existing);

    // Auto-remove after duration
    const timer = window.setTimeout(() => {
      setFlashingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
      timersRef.current.delete(symbol);
    }, FLASH_DURATION_MS);

    timersRef.current.set(symbol, timer);
  }, [lastAlert, symbols]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  const handleMouseEnter = useCallback((symbol: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
    setHoveredSymbol(symbol);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredSymbol(null);
  }, []);

  if (symbols.length === 0) return null;

  // If no rank data available, fall back to single flat grid (no tier labels)
  const hasTiers = Object.keys(ranks).length > 0;

  // Split tiers: Large-cap + Mid-cap share a row, Small-cap gets its own row
  const topRowTiers = tiers.filter((t) => t.label.startsWith('Large') || t.label.startsWith('Mid'));
  const bottomRowTiers = tiers.filter((t) => !t.label.startsWith('Large') && !t.label.startsWith('Mid'));

  const renderTier = (tier: TierGroup) => (
    <div key={tier.label}>
      <p className="text-[10px] text-gray-500 dark:text-gray-500 mb-0.5">
        {tier.label}
      </p>
      <div className="flex flex-wrap gap-x-px gap-y-1.5">
        {tier.symbols.map((symbol) => {
          const isFlashing = flashingSymbols.has(symbol);
          return (
            <div
              key={symbol}
              className="flex flex-col gap-px cursor-default rounded-sm"
              style={isFlashing ? { animation: `candleMeterFlash ${FLASH_DURATION_MS}ms ease-out` } : undefined}
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
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <style>{`
        @keyframes candleMeterFlash {
          0% { box-shadow: 0 0 8px 4px rgba(250, 204, 21, 1); }
          15% { box-shadow: 0 0 4px 2px rgba(250, 204, 21, 0.5); }
          30% { box-shadow: 0 0 8px 4px rgba(250, 204, 21, 1); }
          45% { box-shadow: 0 0 4px 2px rgba(250, 204, 21, 0.5); }
          60% { box-shadow: 0 0 8px 4px rgba(250, 204, 21, 1); }
          75% { box-shadow: 0 0 4px 2px rgba(250, 204, 21, 0.5); }
          100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
        }
      `}</style>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Candle Freshness
        </p>
        <button
          onClick={() => setShowLegend(true)}
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
        >
          View Legend
        </button>
      </div>

      {hasTiers ? (
        <div className="space-y-2">
          {topRowTiers.length > 0 && (
            <div className="flex gap-4">
              {topRowTiers.map(renderTier)}
            </div>
          )}
          {bottomRowTiers.map(renderTier)}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-px gap-y-1.5">
          {symbols.map((symbol) => {
            const isFlashing = flashingSymbols.has(symbol);
            return (
              <div
                key={symbol}
                className="flex flex-col gap-px cursor-default rounded-sm"
                style={isFlashing ? { animation: `candleMeterFlash ${FLASH_DURATION_MS}ms ease-out` } : undefined}
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
            );
          })}
        </div>
      )}

      <CandleMeterLegend open={showLegend} onClose={() => setShowLegend(false)} />

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
