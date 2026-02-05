import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAlertContext } from '@/contexts/AlertContext';

const TOAST_DURATION_MS = 5000;

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

      toast(`${lastAlert.symbol} Alert`, {
        description: `${lastAlert.alertType} @ $${priceStr} (MACD-V: ${valueStr})`,
        duration: TOAST_DURATION_MS,
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
