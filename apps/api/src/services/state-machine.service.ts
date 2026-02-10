import type { ConnectionState, InstanceStatus } from '@livermore/schemas';
import { VALID_TRANSITIONS } from '@livermore/schemas';
import { createLogger } from '@livermore/utils';
import { updateRuntimeState } from './runtime-state';
import type { InstanceRegistryService } from './instance-registry.service';

const logger = createLogger({ name: 'state-machine', service: 'network' });

/**
 * Map new 6-state ConnectionState to legacy 5-state for backward compatibility
 * with the existing ControlPanel UI which reads connectionState from RuntimeState.
 *
 * New states:  idle | starting | warming | active | stopping | stopped
 * Legacy:      idle | connecting | connected | disconnected | error
 */
function mapToLegacyState(
  state: ConnectionState
): 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'starting':
    case 'warming':
      return 'connecting';
    case 'active':
      return 'connected';
    case 'stopping':
    case 'stopped':
      return 'disconnected';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

interface TransitionRecord {
  from: ConnectionState;
  to: ConnectionState;
  at: string;
}

const MAX_HISTORY = 50;

/**
 * StateMachineService
 *
 * Validates and executes state transitions for exchange instance lifecycle.
 * Uses VALID_TRANSITIONS from @livermore/schemas as the transition map.
 *
 * On each valid transition:
 * - Updates the Redis payload via InstanceRegistryService.updateStatus()
 * - Updates in-memory RuntimeState for backward compatibility with ControlPanel UI
 * - Records the transition in a capped history buffer
 */
export class StateMachineService {
  private currentState: ConnectionState = 'idle';
  private registry: InstanceRegistryService;
  private transitionHistory: TransitionRecord[] = [];

  constructor(registry: InstanceRegistryService) {
    this.registry = registry;
  }

  /**
   * Attempt a state transition. Validates against VALID_TRANSITIONS.
   *
   * @throws Error if the transition is not allowed from the current state.
   */
  async transition(to: ConnectionState): Promise<void> {
    const from = this.currentState;
    const allowed = VALID_TRANSITIONS[from] as readonly ConnectionState[];

    if (!allowed.includes(to)) {
      logger.error({ from, to }, 'Invalid state transition');
      throw new Error(`Invalid state transition: ${from} -> ${to}`);
    }

    // Record in history (FIFO, capped at 50)
    this.transitionHistory.push({ from, to, at: new Date().toISOString() });
    if (this.transitionHistory.length > MAX_HISTORY) {
      this.transitionHistory = this.transitionHistory.slice(-MAX_HISTORY);
    }

    // Update current state
    this.currentState = to;

    // Update Redis payload via registry
    const statusUpdate: Partial<InstanceStatus> = {
      connectionState: to,
      lastStateChange: new Date().toISOString(),
    };

    if (to === 'active') {
      statusUpdate.connectedAt = new Date().toISOString();
    }

    await this.registry.updateStatus(statusUpdate);

    // Update in-memory RuntimeState for backward compatibility
    updateRuntimeState({
      connectionState: mapToLegacyState(to),
      connectionStateChangedAt: Date.now(),
      exchangeConnected: to === 'active',
    });

    logger.info({ from, to }, 'State transition');
  }

  /**
   * Get the current connection state.
   */
  getCurrentState(): ConnectionState {
    return this.currentState;
  }

  /**
   * Get a copy of the transition history (most recent last).
   */
  getTransitionHistory(): TransitionRecord[] {
    return [...this.transitionHistory];
  }

  /**
   * Force-reset state to 'idle' without transition validation.
   * Used during error recovery or crash recovery.
   */
  resetToIdle(): void {
    const from = this.currentState;
    logger.warn({ from }, 'Force-resetting state to idle (recovery)');

    this.currentState = 'idle';

    updateRuntimeState({
      connectionState: 'idle',
      connectionStateChangedAt: Date.now(),
      exchangeConnected: false,
    });
  }
}
