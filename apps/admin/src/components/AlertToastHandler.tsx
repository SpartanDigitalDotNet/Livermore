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
 * In dark mode, returns a colored glass tint (semi-transparent bg + border glow).
 * In light mode, returns a colored left border.
 *
 * signalDelta = macdV - signal (EMA of macdV, 9)
 * - Positive: macdV > signal = bullish momentum / recovering
 * - Negative: macdV < signal = bearish momentum / falling
 */
function getToastStyle(macdV: number | null, signalDelta: number | null): React.CSSProperties {
  if (macdV === null) return {};

  const isDark = document.documentElement.classList.contains('dark');
  const isRecovering = signalDelta !== null && signalDelta > 0;
  const absMacdV = Math.abs(macdV);

  let color: string;  // hex color
  let rgb: string;    // r g b for rgba()

  // Extreme zones (±150+)
  if (absMacdV >= 150) {
    if (macdV < 0 && isRecovering) { color = '#e040fb'; rgb = '224 64 251'; }   // neon purple
    else { color = '#ef4444'; rgb = '239 68 68'; }                                // red
  }
  // Positive side
  else if (macdV > 0) {
    if (macdV <= 50) { color = '#64748b'; rgb = '100 116 139'; }       // slate (chop)
    else if (macdV <= 75) { color = '#06b6d4'; rgb = '6 182 212'; }    // cyan (early rally)
    else if (macdV <= 125) { color = '#84cc16'; rgb = '132 204 22'; }  // lime (strong rally)
    else if (macdV <= 140) { color = '#eab308'; rgb = '234 179 8'; }   // yellow (extended)
    else { color = '#f97316'; rgb = '249 115 22'; }                     // orange (near exhaustion)
  }
  // Negative side
  else if (macdV >= -50) { color = '#64748b'; rgb = '100 116 139'; }   // slate (chop)
  else if (isRecovering) { color = '#14b8a6'; rgb = '20 184 166'; }    // teal (potential Long)
  else { color = '#64748b'; rgb = '100 116 139'; }                      // slate (still falling)

  if (isDark) {
    return {
      background: `rgba(${rgb} / 0.12)`,
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderColor: `rgba(${rgb} / 0.25)`,
      borderWidth: '1px',
      borderStyle: 'solid',
      boxShadow: `0 0 20px rgba(${rgb} / 0.1), inset 0 1px 0 rgba(255 255 255 / 0.05)`,
    };
  }

  return { borderLeft: `4px solid ${color}` };
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

      const tfStr = lastAlert.timeframe ? ` ${lastAlert.timeframe}` : '';
      toast(`${lastAlert.symbol}${tfStr} Alert`, {
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
