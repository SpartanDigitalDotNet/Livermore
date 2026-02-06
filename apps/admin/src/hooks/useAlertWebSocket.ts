import { useState, useEffect, useRef, useCallback } from 'react';
import type { Signal } from '@/components/signals/SignalsTable';

interface AlertWebSocketMessage {
  type: 'alert_trigger';
  data: {
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
  };
}

interface UseAlertWebSocketReturn {
  lastAlert: Signal | null;
  isConnected: boolean;
  clearLastAlert: () => void;
}

const WS_URL = import.meta.env.VITE_API_WS_URL || 'ws://localhost:4000';
const RECONNECT_DELAY_MS = 3000;

export function useAlertWebSocket(): UseAlertWebSocketReturn {
  const [lastAlert, setLastAlert] = useState<Signal | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const clearLastAlert = useCallback(() => {
    setLastAlert(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      const ws = new WebSocket(`${WS_URL}/ws/alerts`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (mounted) {
          setIsConnected(true);
          console.log('[AlertWS] Connected');
        }
      };

      ws.onclose = () => {
        if (mounted) {
          setIsConnected(false);
          console.log('[AlertWS] Disconnected, reconnecting...');
          reconnectTimeoutRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = (error) => {
        console.error('[AlertWS] Error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as AlertWebSocketMessage;
          if (message.type === 'alert_trigger') {
            const signal: Signal = {
              id: message.data.id,
              symbol: message.data.symbol,
              alertType: message.data.alertType,
              timeframe: message.data.timeframe,
              price: message.data.price,
              triggerValue: message.data.triggerValue,
              signalDelta: message.data.signalDelta,
              triggeredAt: message.data.triggeredAt,
            };
            setLastAlert(signal);
            console.log('[AlertWS] Alert received:', signal.symbol, signal.alertType);
          }
        } catch (error) {
          console.error('[AlertWS] Failed to parse message:', error);
        }
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return { lastAlert, isConnected, clearLastAlert };
}
