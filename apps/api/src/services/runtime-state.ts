/**
 * Runtime State Module
 *
 * Simple shared state for runtime status that can be:
 * - Updated by ControlChannelService
 * - Read by control.router for getStatus endpoint
 *
 * This avoids complex dependency injection for a simple use case.
 */

/**
 * Connection state for exchange adapters (Phase 26 CTL-04)
 */
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'starting' | 'warming' | 'active' | 'stopping' | 'stopped';

/**
 * Startup phases for progress tracking
 */
export type StartupPhase = 'idle' | 'indicators' | 'warmup' | 'boundary' | 'websocket' | 'complete';

/**
 * Startup progress info for UI display
 */
export interface StartupProgress {
  /** Current phase of startup */
  phase: StartupPhase;
  /** Human-readable phase label */
  phaseLabel: string;
  /** Overall progress percentage (0-100) */
  percent: number;
  /** Current item being processed (e.g., "BTC-USD 5m") */
  currentItem?: string;
  /** Total items in current phase */
  total?: number;
  /** Current item index in phase */
  current?: number;
}

export interface RuntimeState {
  isPaused: boolean;
  mode: string;
  startTime: number;
  /** @deprecated Use connectionState instead */
  exchangeConnected: boolean;
  /** Current connection state (Phase 26) */
  connectionState: ConnectionState;
  /** Error message if connectionState is 'error' */
  connectionError?: string;
  /** Timestamp when connection state last changed */
  connectionStateChangedAt?: number;
  queueDepth: number;
  /** Startup progress for UI (Phase 29) */
  startup?: StartupProgress;
}

/** Global runtime state - initialized on server start */
const state: RuntimeState = {
  isPaused: false,
  mode: 'position-monitor',
  startTime: Date.now(),
  exchangeConnected: false,
  connectionState: 'idle',
  connectionStateChangedAt: Date.now(),
  queueDepth: 0,
};

/**
 * Get current runtime state (for router)
 */
export function getRuntimeState(): Readonly<RuntimeState> {
  return { ...state };
}

/**
 * Update runtime state (for ControlChannelService)
 */
export function updateRuntimeState(updates: Partial<RuntimeState>): void {
  Object.assign(state, updates);
}

/**
 * Initialize runtime state on server start
 */
export function initRuntimeState(initial: Partial<RuntimeState>): void {
  Object.assign(state, {
    startTime: Date.now(),
    ...initial,
  });
}

// ============================================
// SYMBOL REGISTRY: Per-exchange monitored symbols
// Used by getCandleTimestamps to know which symbols to query
// ============================================

const symbolRegistry = new Map<number, string[]>();

export function setMonitoredSymbols(exchangeId: number, symbols: string[]): void {
  symbolRegistry.set(exchangeId, [...symbols]);
}

export function getMonitoredSymbols(exchangeId: number): string[] {
  return symbolRegistry.get(exchangeId) ?? [];
}

export function clearMonitoredSymbols(exchangeId: number): void {
  symbolRegistry.delete(exchangeId);
}
