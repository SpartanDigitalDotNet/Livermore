import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAlertContext } from '@/contexts/AlertContext';

const TOAST_DURATION_MS = 5000;

/**
 * Get momentum state description based on MACD-V and signalDelta.
 *
 * signalDelta = macdV - signal (EMA of macdV, 9)
 * - Positive: macdV > signal = bullish momentum / recovering
 * - Negative: macdV < signal = bearish momentum / falling
 */
function getMomentumState(macdV: number | null, signalDelta: number | null): string {
  if (macdV === null) return '';

  const isRecovering = signalDelta !== null && signalDelta > 0;
  const absMacdV = Math.abs(macdV);

  if (absMacdV >= 150) {
    if (macdV < 0) return isRecovering ? 'Recovering' : 'Oversold';
    return 'Overbought';
  }

  if (macdV > 50) return 'Rallying';
  if (macdV < -50) return isRecovering ? 'Recovering' : 'Falling';
  return 'Ranging';
}

/**
 * Get toast style based on MACD-V and signalDelta.
 * Returns a colored left border matching the MACD-V zone colors.
 *
 * signalDelta = macdV - signal (EMA of macdV, 9)
 * - Positive: macdV > signal = bullish momentum / recovering
 * - Negative: macdV < signal = bearish momentum / falling
 */
function getToastStyle(macdV: number | null, signalDelta: number | null): React.CSSProperties {
  if (macdV === null) return {};

  const isRecovering = signalDelta !== null && signalDelta > 0;
  const absMacdV = Math.abs(macdV);

  // Extreme zones (±150+)
  if (absMacdV >= 150) {
    if (macdV < 0 && isRecovering) return { borderLeft: '4px solid #a855f7' }; // purple-500
    return { borderLeft: '4px solid #ef4444' }; // red-500
  }

  // Positive side
  if (macdV > 0) {
    if (macdV <= 50) return { borderLeft: '4px solid #64748b' };  // slate-500 (chop)
    if (macdV <= 75) return { borderLeft: '4px solid #06b6d4' };  // cyan-500 (early rally)
    if (macdV <= 125) return { borderLeft: '4px solid #84cc16' }; // lime-500 (strong rally)
    if (macdV <= 140) return { borderLeft: '4px solid #eab308' }; // yellow-500 (extended)
    return { borderLeft: '4px solid #f97316' };                    // orange-500 (near exhaustion)
  }

  // Negative side
  if (macdV >= -50) return { borderLeft: '4px solid #64748b' };   // slate-500 (chop)
  if (isRecovering) return { borderLeft: '4px solid #14b8a6' };   // teal-500 (potential Long)
  return { borderLeft: '4px solid #64748b' };                      // slate-500 (still falling)
}

export function AlertToastHandler() {
  const { lastAlert, currentHash, clearLastAlert } = useAlertContext();
  const processedIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Only show toast when NOT on Signals page
    if (lastAlert && currentHash !== '#/signals') {
      // Prevent duplicate toasts for same alert
      if (processedIdRef.current === lastAlert.id) return;
      processedIdRef.current = lastAlert.id;

      const priceStr = lastAlert.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
      const valueStr = lastAlert.triggerValue?.toFixed(1) ?? '-';
      const deltaStr = lastAlert.signalDelta?.toFixed(1) ?? '-';
      const momentum = getMomentumState(lastAlert.triggerValue, lastAlert.signalDelta);

      toast(`${lastAlert.symbol} Alert`, {
        description: `${momentum} @ $${priceStr} (MACD-V: ${valueStr}, Δ: ${deltaStr})`,
        duration: TOAST_DURATION_MS,
        style: getToastStyle(lastAlert.triggerValue, lastAlert.signalDelta),
        action: {
          label: 'View',
          onClick: () => {
            window.location.hash = '#/signals';
          },
        },
      });

      clearLastAlert();
    }
  }, [lastAlert, currentHash, clearLastAlert]);

  return null;
}
