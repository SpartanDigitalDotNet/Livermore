import { getRedisClient, commandChannel, responseChannel } from '@livermore/cache';
import { createLogger } from '@livermore/utils';
import {
  CommandSchema,
  type Command,
  type CommandResponse,
  type CommandType,
} from '@livermore/schemas';
import { eq, and } from 'drizzle-orm';
import { users } from '@livermore/database';
import type Redis from 'ioredis';
import type { ServiceRegistry } from './types/service-registry';

const logger = createLogger({ name: 'control-channel', service: 'control' });

/**
 * Priority levels for command ordering (RUN-13)
 * Lower number = higher priority (processed first)
 *
 * Priority 1: Critical control commands (pause/resume)
 * Priority 10: Settings and mode changes
 * Priority 15: Symbol management
 * Priority 20: Resource-intensive operations
 */
const PRIORITY: Record<CommandType, number> = {
  pause: 1,
  resume: 1,
  'reload-settings': 10,
  'switch-mode': 10,
  'force-backfill': 20,
  'clear-cache': 20,
  'add-symbol': 15,
  'remove-symbol': 15,
};

/**
 * ControlChannelService
 *
 * Subscribes to Redis command channel for a specific user (identitySub).
 * Validates commands, publishes ACK immediately, executes, then publishes result.
 *
 * Architecture:
 * - Admin UI publishes to livermore:commands:{sub}
 * - This service subscribes and processes commands
 * - Responses published to livermore:responses:{sub}
 *
 * Requirements:
 * - RUN-01: Command channel subscription
 * - RUN-02: Response channel publishing
 * - RUN-03: Command handling
 * - RUN-10: Immediate ACK on command receipt
 * - RUN-11: Result published after execution
 * - RUN-12: Commands older than 30s rejected as expired
 * - RUN-13: Priority queue for command ordering
 */
export class ControlChannelService {
  private redis = getRedisClient();
  private subscriber: Redis | null = null;
  private identitySub: string;
  private commandChannelKey: string;
  private responseChannelKey: string;
  private commandQueueKey: string;
  private readonly COMMAND_TIMEOUT_MS = 30_000; // RUN-12: 30 second timeout

  /** Service registry for accessing other services (injected via constructor) */
  private services: ServiceRegistry | null = null;

  /** Paused state for pause/resume commands (RUN-04, RUN-05) */
  private isPaused = false;

  /**
   * Constructor accepts optional services parameter for backward compatibility.
   * When services are provided, ControlChannelService can execute runtime commands
   * like pause/resume that require access to other services.
   *
   * @param identitySub - User identity (Clerk sub) for scoped channels
   * @param services - Optional ServiceRegistry for runtime command execution
   */
  constructor(identitySub: string, services?: ServiceRegistry) {
    this.identitySub = identitySub;
    this.commandChannelKey = commandChannel(identitySub);
    this.responseChannelKey = responseChannel(identitySub);
    this.commandQueueKey = `livermore:command-queue:${identitySub}`;
    if (services) {
      this.services = services;
    }
  }

  /**
   * Get current paused state
   * @returns true if services are paused, false otherwise
   */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * Check if service registry is available for runtime commands
   * @returns true if services were injected, false otherwise
   */
  get hasServices(): boolean {
    return this.services !== null;
  }

  /**
   * Start the control channel service
   * Creates a duplicate Redis connection for pub/sub and subscribes to command channel
   */
  async start(): Promise<void> {
    logger.info(
      { identitySub: this.identitySub, channel: this.commandChannelKey },
      'Starting Control Channel Service'
    );

    // Create dedicated subscriber (CRITICAL - required for pub/sub mode)
    // The main redis client cannot be used for both commands and pub/sub
    this.subscriber = this.redis.duplicate();

    // Subscribe to command channel
    await this.subscriber.subscribe(this.commandChannelKey);

    // Handle messages
    this.subscriber.on('message', (_channel: string, message: string) => {
      this.handleMessage(message).catch((error) => {
        logger.error({ error }, 'Error handling control channel message');
      });
    });

    logger.info(
      { channel: this.commandChannelKey, responseChannel: this.responseChannelKey },
      'Control Channel Service subscribed and ready'
    );
  }

  /**
   * Handle incoming message from command channel
   * Parses, validates, checks expiry, then queues for processing
   */
  private async handleMessage(message: string): Promise<void> {
    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch (error) {
      logger.error({ error, message }, 'Failed to parse command message as JSON');
      return;
    }

    // Validate with Zod schema
    const result = CommandSchema.safeParse(parsed);
    if (!result.success) {
      logger.error(
        { errors: result.error.errors, message },
        'Command validation failed'
      );
      return;
    }

    const command = result.data;

    // RUN-12: Check command expiry (30 second timeout)
    const age = Date.now() - command.timestamp;
    if (age > this.COMMAND_TIMEOUT_MS) {
      logger.warn(
        { correlationId: command.correlationId, age, timeout: this.COMMAND_TIMEOUT_MS },
        'Command expired, rejecting'
      );

      await this.publishResponse({
        correlationId: command.correlationId,
        status: 'error',
        message: 'Command expired',
        timestamp: Date.now(),
      });
      return;
    }

    // RUN-13: Get priority from type (use command.priority as override if valid)
    const priority = command.priority || PRIORITY[command.type] || 50;

    logger.debug(
      { correlationId: command.correlationId, type: command.type, priority },
      'Valid command received, queuing'
    );

    // RUN-13: Queue command by priority in sorted set
    await this.redis.zadd(
      this.commandQueueKey,
      priority,
      JSON.stringify(command)
    );

    // Trigger queue processing
    await this.processQueue();
  }

  /**
   * Process commands from priority queue (RUN-13)
   * Processes one command at a time, lowest priority number first (highest urgency)
   */
  private async processQueue(): Promise<void> {
    // Get lowest priority (highest urgency) command
    const results = await this.redis.zpopmin(this.commandQueueKey, 1);
    if (!results || results.length === 0) {
      return;
    }

    // zpopmin returns [member, score] pairs
    const commandJson = results[0];
    const command = JSON.parse(commandJson) as Command;

    await this.handleCommand(command);

    // Process next if queue not empty
    const remaining = await this.redis.zcard(this.commandQueueKey);
    if (remaining > 0) {
      // Use setImmediate to prevent blocking event loop
      setImmediate(() => {
        this.processQueue().catch((err) => {
          logger.error({ error: err }, 'Error processing command queue');
        });
      });
    }
  }

  /**
   * Handle a validated command
   * Publishes immediate ACK, executes command, publishes result
   */
  private async handleCommand(command: Command): Promise<void> {
    // RUN-10: Publish immediate ACK
    await this.publishResponse({
      correlationId: command.correlationId,
      status: 'ack',
      timestamp: Date.now(),
    });

    logger.info(
      { correlationId: command.correlationId, type: command.type },
      'Command acknowledged, executing'
    );

    try {
      // Execute command
      const result = await this.executeCommand(command);

      // RUN-11: Publish success result
      await this.publishResponse({
        correlationId: command.correlationId,
        status: 'success',
        data: result,
        timestamp: Date.now(),
      });

      logger.info(
        { correlationId: command.correlationId, type: command.type },
        'Command executed successfully'
      );
    } catch (error) {
      // Publish error result
      const message = error instanceof Error ? error.message : String(error);
      await this.publishResponse({
        correlationId: command.correlationId,
        status: 'error',
        message,
        timestamp: Date.now(),
      });

      logger.error(
        { correlationId: command.correlationId, type: command.type, error: message },
        'Command execution failed'
      );
    }
  }

  /**
   * Execute a command by dispatching to the appropriate handler
   * Dispatches to type-specific handlers for pause/resume and other commands
   */
  private async executeCommand(command: Command): Promise<Record<string, unknown>> {
    const { type, payload } = command;

    logger.info({ type, payload }, 'Executing command');

    switch (type) {
      case 'pause':
        return this.handlePause();
      case 'resume':
        return this.handleResume();
      case 'reload-settings':
        return this.handleReloadSettings();
      case 'switch-mode':
        return this.handleSwitchMode(payload);
      case 'force-backfill':
        return this.handleForceBackfill(payload);
      case 'clear-cache':
        return this.handleClearCache(payload);
      case 'add-symbol':
        return this.handleAddSymbol(payload);
      case 'remove-symbol':
        return this.handleRemoveSymbol(payload);
      default:
        throw new Error(`Unknown command type: ${type}`);
    }
  }

  /**
   * Handle pause command (RUN-04)
   * Stops services in dependency order: downstream first (consumers before producers)
   */
  private async handlePause(): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    if (this.isPaused) {
      return { status: 'already_paused' };
    }

    logger.info('Pausing services...');

    // Stop in dependency order (downstream to upstream)
    // 1. AlertService - consumes indicator events
    await this.services.alertService.stop();
    logger.debug('AlertService stopped');

    // 2. CoinbaseAdapter - produces candle events (disconnect WebSocket)
    this.services.coinbaseAdapter.disconnect();
    logger.debug('CoinbaseAdapter disconnected');

    // 3. BoundaryRestService - produces candle events from REST
    await this.services.boundaryRestService.stop();
    logger.debug('BoundaryRestService stopped');

    // 4. IndicatorService - consumes candle events
    await this.services.indicatorService.stop();
    logger.debug('IndicatorService stopped');

    this.isPaused = true;
    logger.info('All services paused');

    return {
      status: 'paused',
      timestamp: Date.now(),
    };
  }

  /**
   * Handle resume command (RUN-05)
   * Starts services in dependency order: upstream first (producers before consumers)
   */
  private async handleResume(): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    if (!this.isPaused) {
      return { status: 'already_running' };
    }

    logger.info('Resuming services...');

    // Start in dependency order (upstream to downstream)
    // 1. IndicatorService - needs to be listening before events arrive
    await this.services.indicatorService.start(this.services.indicatorConfigs);
    logger.debug('IndicatorService started');

    // 2. CoinbaseAdapter - connect WebSocket and subscribe
    await this.services.coinbaseAdapter.connect();
    this.services.coinbaseAdapter.subscribe(this.services.monitoredSymbols, '5m');
    logger.debug('CoinbaseAdapter connected and subscribed');

    // 3. BoundaryRestService - start listening for boundary events
    await this.services.boundaryRestService.start(this.services.monitoredSymbols);
    logger.debug('BoundaryRestService started');

    // 4. AlertService - start evaluating alerts
    await this.services.alertService.start(
      this.services.monitoredSymbols,
      this.services.timeframes
    );
    logger.debug('AlertService started');

    this.isPaused = false;
    logger.info('All services resumed');

    return {
      status: 'resumed',
      timestamp: Date.now(),
    };
  }

  /**
   * Handle reload-settings command (RUN-06)
   * Fetches user settings from database
   *
   * Note: Currently just validates settings exist. Future phases will
   * apply settings to running services (symbol list, alert thresholds, etc.)
   */
  private async handleReloadSettings(): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    logger.info({ identitySub: this.identitySub }, 'Reloading settings from database');

    // Fetch settings from database
    const result = await this.services.db
      .select({ settings: users.settings })
      .from(users)
      .where(
        and(
          eq(users.identityProvider, 'clerk'),
          eq(users.identitySub, this.identitySub)
        )
      )
      .limit(1);

    if (result.length === 0) {
      throw new Error(`User not found: ${this.identitySub}`);
    }

    const settings = result[0].settings;

    // Log what was loaded
    logger.info(
      { identitySub: this.identitySub, hasSettings: settings !== null },
      'Settings reloaded from database'
    );

    // TODO: Apply settings to running services
    // This will be expanded when symbol management and other
    // runtime-configurable settings are implemented

    return {
      reloaded: true,
      timestamp: Date.now(),
      hasSettings: settings !== null,
    };
  }

  /**
   * Handle switch-mode command (RUN-07)
   * STUB: Validates mode but does not actually switch
   *
   * Valid modes:
   * - position-monitor: Track positions only (current default)
   * - scalper-macdv: MACD-V based scalping signals
   * - scalper-orderbook: Orderbook imbalance scalping (v4.1)
   */
  private async handleSwitchMode(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const mode = payload?.mode as string | undefined;

    const validModes = ['position-monitor', 'scalper-macdv', 'scalper-orderbook'];

    if (!mode) {
      throw new Error('mode is required in payload');
    }

    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
    }

    // RUN-07 specifies this is a stub for now
    // scalper-orderbook requires orderbook imbalance detection (v4.1)
    // scalper-macdv requires strategy implementation
    logger.info({ mode }, 'Mode switch requested (stub - no actual change)');

    return {
      switched: false,
      mode,
      message: 'Mode switching is a stub - actual implementation pending strategy work',
      validModes,
    };
  }

  /**
   * Handle force-backfill command (RUN-08)
   * Stub - to be implemented in Plan 03
   */
  private async handleForceBackfill(_payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('force-backfill not yet implemented');
  }

  /**
   * Handle clear-cache command (RUN-09)
   * Stub - to be implemented in Plan 03
   */
  private async handleClearCache(_payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('clear-cache not yet implemented');
  }

  /**
   * Handle add-symbol command
   * Stub - to be implemented in Plan 03
   */
  private async handleAddSymbol(_payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('add-symbol not yet implemented');
  }

  /**
   * Handle remove-symbol command
   * Stub - to be implemented in Plan 03
   */
  private async handleRemoveSymbol(_payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('remove-symbol not yet implemented');
  }

  /**
   * Publish a response to the response channel
   */
  private async publishResponse(response: CommandResponse): Promise<void> {
    await this.redis.publish(this.responseChannelKey, JSON.stringify(response));

    logger.debug(
      { correlationId: response.correlationId, status: response.status },
      'Response published'
    );
  }

  /**
   * Get current queue depth for monitoring/observability
   */
  async getQueueDepth(): Promise<number> {
    return this.redis.zcard(this.commandQueueKey);
  }

  /**
   * Stop the control channel service
   * Unsubscribes from channel and cleans up Redis connection
   */
  async stop(): Promise<void> {
    logger.info(
      { identitySub: this.identitySub },
      'Stopping Control Channel Service'
    );

    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.commandChannelKey);
      await this.subscriber.quit();
      this.subscriber = null;
    }

    logger.info('Control Channel Service stopped');
  }
}
