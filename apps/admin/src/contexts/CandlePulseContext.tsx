import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

interface CandlePulseContextValue {
  /** Get timestamp for a specific exchange/symbol/timeframe */
  getTimestamp: (exchangeId: number, symbol: string, tf: string) => number | null;
  /** Seed timestamps from initial tRPC snapshot */
  seedTimestamps: (exchangeId: number, data: Record<string, Record<string, number | null>>) => void;
  /** Get symbol list for an exchange (from seeded data) */
  getSymbols: (exchangeId: number) => string[];
  /** Tick counter that increments every 2s — drives re-renders */
  displayTick: number;
  /** Whether WebSocket is connected */
  isConnected: boolean;
}

const CandlePulseContext = createContext<CandlePulseContextValue | null>(null);

const WS_URL = import.meta.env.VITE_API_WS_URL || 'ws://localhost:4000';
const RECONNECT_DELAY_MS = 3000;
const TICK_INTERVAL_MS = 2000;

interface CandlePulseMessage {
  type: 'candle_pulse';
  data: {
    exchangeId: number;
    symbol: string;
    timeframe: string;
    timestamp: number;
  };
}

// Store shape: exchangeId -> symbol -> timeframe -> timestamp
type TimestampStore = Map<number, Map<string, Map<string, number>>>;
// Symbol list shape: exchangeId -> string[]
type SymbolStore = Map<number, string[]>;

export function CandlePulseProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [displayTick, setDisplayTick] = useState(0);
  const storeRef = useRef<TimestampStore>(new Map());
  const symbolsRef = useRef<SymbolStore>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      const ws = new WebSocket(`${WS_URL}/ws/candle-pulse`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (mounted) setIsConnected(true);
      };

      ws.onclose = () => {
        if (mounted) {
          setIsConnected(false);
          reconnectRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {};

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as CandlePulseMessage;
          if (msg.type === 'candle_pulse') {
            const { exchangeId, symbol, timeframe, timestamp } = msg.data;
            const store = storeRef.current;

            if (!store.has(exchangeId)) store.set(exchangeId, new Map());
            const exMap = store.get(exchangeId)!;

            if (!exMap.has(symbol)) exMap.set(symbol, new Map());
            exMap.get(symbol)!.set(timeframe, timestamp);
          }
        } catch {
          // ignore parse errors
        }
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // 2-second tick timer to drive re-renders
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayTick((t) => t + 1);
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const getTimestamp = useCallback((exchangeId: number, symbol: string, tf: string): number | null => {
    return storeRef.current.get(exchangeId)?.get(symbol)?.get(tf) ?? null;
  }, []);

  const seedTimestamps = useCallback((exchangeId: number, data: Record<string, Record<string, number | null>>) => {
    const store = storeRef.current;
    if (!store.has(exchangeId)) store.set(exchangeId, new Map());
    const exMap = store.get(exchangeId)!;

    const symbols: string[] = [];

    for (const [symbol, timeframes] of Object.entries(data)) {
      symbols.push(symbol);
      if (!exMap.has(symbol)) exMap.set(symbol, new Map());
      const symMap = exMap.get(symbol)!;

      for (const [tf, ts] of Object.entries(timeframes)) {
        if (ts !== null) {
          symMap.set(tf, ts);
        }
      }
    }

    symbolsRef.current.set(exchangeId, symbols);
  }, []);

  const getSymbols = useCallback((exchangeId: number): string[] => {
    return symbolsRef.current.get(exchangeId) ?? [];
  }, []);

  return (
    <CandlePulseContext.Provider
      value={{ getTimestamp, seedTimestamps, getSymbols, displayTick, isConnected }}
    >
      {children}
    </CandlePulseContext.Provider>
  );
}

export function useCandlePulse(): CandlePulseContextValue {
  const context = useContext(CandlePulseContext);
  if (!context) {
    throw new Error('useCandlePulse must be used within CandlePulseProvider');
  }
  return context;
}
