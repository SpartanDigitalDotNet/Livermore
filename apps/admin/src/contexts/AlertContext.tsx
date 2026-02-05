import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useAlertWebSocket } from '@/hooks/useAlertWebSocket';
import type { Signal } from '@/components/signals/SignalsTable';

interface AlertContextValue {
  /** Most recent alert from WebSocket (for Signals page to prepend) */
  lastAlert: Signal | null;
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Current route hash (to determine toast vs table behavior) */
  currentHash: string;
  /** Set of signal IDs that are "new" (for highlight animation) */
  highlightedIds: Set<number>;
  /** Clear a signal from highlighted set */
  removeHighlight: (id: number) => void;
  /** Clear lastAlert after processing */
  clearLastAlert: () => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

interface AlertProviderProps {
  children: ReactNode;
  currentHash: string;
}

const HIGHLIGHT_DURATION_MS = 5000;

export function AlertProvider({ children, currentHash }: AlertProviderProps) {
  const { lastAlert, isConnected, clearLastAlert } = useAlertWebSocket();
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());

  const removeHighlight = useCallback((id: number) => {
    setHighlightedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // When a new alert arrives on the Signals page, add it to highlighted set
  useEffect(() => {
    if (lastAlert && currentHash === '#/signals') {
      setHighlightedIds((prev) => new Set(prev).add(lastAlert.id));

      // Auto-remove highlight after duration
      const timeoutId = setTimeout(() => {
        removeHighlight(lastAlert.id);
      }, HIGHLIGHT_DURATION_MS);

      return () => clearTimeout(timeoutId);
    }
  }, [lastAlert, currentHash, removeHighlight]);

  return (
    <AlertContext.Provider
      value={{
        lastAlert,
        isConnected,
        currentHash,
        highlightedIds,
        removeHighlight,
        clearLastAlert,
      }}
    >
      {children}
    </AlertContext.Provider>
  );
}

export function useAlertContext(): AlertContextValue {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlertContext must be used within AlertProvider');
  }
  return context;
}
