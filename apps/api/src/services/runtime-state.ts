/**
 * Runtime State Module
 *
 * Simple shared state for runtime status that can be:
 * - Updated by ControlChannelService
 * - Read by control.router for getStatus endpoint
 *
 * This avoids complex dependency injection for a simple use case.
 */

export interface RuntimeState {
  isPaused: boolean;
  mode: string;
  startTime: number;
  exchangeConnected: boolean;
  queueDepth: number;
}

/** Global runtime state - initialized on server start */
const state: RuntimeState = {
  isPaused: false,
  mode: 'position-monitor',
  startTime: Date.now(),
  exchangeConnected: false,
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
