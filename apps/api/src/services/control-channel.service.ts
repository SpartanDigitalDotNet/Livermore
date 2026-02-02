import { getRedisClient, commandChannel, responseChannel, deleteKeysClusterSafe, type RedisClient } from '@livermore/cache';
import { createLogger } from '@livermore/utils';
import {
  CommandSchema,
  type Command,
  type CommandResponse,
  type CommandType,
  type Timeframe,
} from '@livermore/schemas';
import { StartupBackfillService } from '@livermore/coinbase-client';
import { eq, and, sql } from 'drizzle-orm';
import { users } from '@livermore/database';
import type { ServiceRegistry } from './types/service-registry';
import { updateRuntimeState } from './runtime-state';

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
  'bulk-add-symbols': 15,
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
  private subscriber: RedisClient | null = null;
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
      case 'bulk-add-symbols':
        return this.handleBulkAddSymbols(payload);
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
    updateRuntimeState({ isPaused: true, exchangeConnected: false });
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
    updateRuntimeState({ isPaused: false, exchangeConnected: true });
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
    // Update runtime state so UI reflects the selection (even though strategy doesn't change)
    updateRuntimeState({ mode });
    logger.info({ mode }, 'Mode switched (stub - strategy implementation pending)');

    return {
      switched: true,
      mode,
      message: `Mode set to ${mode} (strategy implementation pending)`,
      validModes,
    };
  }

  /**
   * Handle force-backfill command (RUN-08)
   * Triggers candle backfill for a specified symbol
   *
   * Payload:
   * - symbol: string (required) - e.g., "BTC-USD"
   * - timeframes: string[] (optional) - defaults to all supported
   */
  private async handleForceBackfill(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    const symbol = payload?.symbol as string | undefined;
    if (!symbol) {
      throw new Error('symbol is required in payload');
    }

    // Use specified timeframes or default to all
    const requestedTimeframes = payload?.timeframes as Timeframe[] | undefined;
    const timeframes: Timeframe[] = requestedTimeframes ?? ['1m', '5m', '15m', '1h', '4h', '1d'];

    logger.info({ symbol, timeframes }, 'Starting force backfill');

    // Create backfill service with credentials from config
    const backfillService = new StartupBackfillService(
      this.services.config.apiKeyId,
      this.services.config.privateKeyPem,
      this.services.redis
    );

    // Run backfill for the symbol
    await backfillService.backfill([symbol], timeframes);

    // Force indicator recalculation after backfill
    for (const timeframe of timeframes) {
      await this.services.indicatorService.forceRecalculate(symbol, timeframe);
    }

    logger.info({ symbol, timeframes }, 'Force backfill complete');

    return {
      backfilled: true,
      symbol,
      timeframes,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle clear-cache command (RUN-09)
   * Clears Redis cache with specified scope
   *
   * Payload:
   * - scope: 'all' | 'symbol' | 'timeframe' (required)
   * - symbol: string (required if scope='symbol')
   * - timeframe: string (required if scope='timeframe')
   */
  private async handleClearCache(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    const scope = payload?.scope as string | undefined;
    if (!scope) {
      throw new Error('scope is required in payload (all, symbol, or timeframe)');
    }

    const symbol = payload?.symbol as string | undefined;
    const timeframe = payload?.timeframe as Timeframe | undefined;

    // Hardcoded for now - will use identity mapping when multi-user is implemented
    const userId = 1;
    const exchangeId = 1;

    let deletedCount = 0;

    switch (scope) {
      case 'all': {
        // Delete all candles and indicators for this user
        const candlePattern = `candles:${userId}:${exchangeId}:*`;
        const indicatorPattern = `indicator:${userId}:${exchangeId}:*`;
        const tickerPattern = `ticker:${userId}:${exchangeId}:*`;

        const candleKeys = await this.services.redis.keys(candlePattern);
        const indicatorKeys = await this.services.redis.keys(indicatorPattern);
        const tickerKeys = await this.services.redis.keys(tickerPattern);

        const allKeys = [...candleKeys, ...indicatorKeys, ...tickerKeys];
        if (allKeys.length > 0) {
          deletedCount = await deleteKeysClusterSafe(this.services.redis, allKeys);
        }
        break;
      }

      case 'symbol': {
        if (!symbol) {
          throw new Error('symbol is required when scope=symbol');
        }

        // Delete all timeframes for this symbol
        const candlePattern = `candles:${userId}:${exchangeId}:${symbol}:*`;
        const indicatorPattern = `indicator:${userId}:${exchangeId}:${symbol}:*`;
        const tickerKey = `ticker:${userId}:${exchangeId}:${symbol}`;

        const candleKeys = await this.services.redis.keys(candlePattern);
        const indicatorKeys = await this.services.redis.keys(indicatorPattern);

        const allKeys = [...candleKeys, ...indicatorKeys, tickerKey];
        if (allKeys.length > 0) {
          deletedCount = await deleteKeysClusterSafe(this.services.redis, allKeys);
        }
        break;
      }

      case 'timeframe': {
        if (!timeframe) {
          throw new Error('timeframe is required when scope=timeframe');
        }

        // Delete all symbols for this timeframe
        const candlePattern = `candles:${userId}:${exchangeId}:*:${timeframe}`;
        const indicatorPattern = `indicator:${userId}:${exchangeId}:*:${timeframe}:*`;

        const candleKeys = await this.services.redis.keys(candlePattern);
        const indicatorKeys = await this.services.redis.keys(indicatorPattern);

        const allKeys = [...candleKeys, ...indicatorKeys];
        if (allKeys.length > 0) {
          deletedCount = await deleteKeysClusterSafe(this.services.redis, allKeys);
        }
        break;
      }

      default:
        throw new Error(`Invalid scope: ${scope}. Must be one of: all, symbol, timeframe`);
    }

    logger.info({ scope, symbol, timeframe, deletedCount }, 'Cache cleared');

    return {
      cleared: true,
      scope,
      symbol,
      timeframe,
      deletedCount,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle add-symbol command (SYM-01)
   * Adds symbol to user's watchlist and starts monitoring
   *
   * Payload:
   * - symbol: string (required) - e.g., "SOL-USD"
   */
  private async handleAddSymbol(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    const symbol = payload?.symbol as string;
    if (!symbol) {
      throw new Error('symbol is required in payload');
    }

    // Normalize symbol format
    const normalizedSymbol = symbol.toUpperCase().trim();

    logger.info({ symbol: normalizedSymbol }, 'Adding symbol to watchlist');

    // 1. Get current symbols from database
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

    const currentSymbols: string[] = (result[0].settings as Record<string, unknown>)?.symbols as string[] ?? [];

    // 2. Check if already exists
    if (currentSymbols.includes(normalizedSymbol)) {
      logger.info({ symbol: normalizedSymbol }, 'Symbol already in watchlist');
      return {
        status: 'already_exists',
        symbol: normalizedSymbol,
        message: 'Symbol is already in your watchlist',
      };
    }

    // 3. Update database (atomic JSONB operation)
    const newSymbols = [...currentSymbols, normalizedSymbol];
    await this.services.db.execute(sql`
      UPDATE users
      SET settings = jsonb_set(
        COALESCE(settings, '{}'),
        '{symbols}',
        ${JSON.stringify(newSymbols)}::jsonb,
        true
      ),
      updated_at = NOW()
      WHERE identity_provider = 'clerk' AND identity_sub = ${this.identitySub}
    `);

    // 4. Update in-memory list
    this.services.monitoredSymbols.push(normalizedSymbol);

    // 5. If not paused, start monitoring the new symbol
    if (!this.isPaused) {
      // 5a. Backfill historical data first
      const backfillService = new StartupBackfillService(
        this.services.config.apiKeyId,
        this.services.config.privateKeyPem,
        this.services.redis
      );
      await backfillService.backfill([normalizedSymbol], this.services.timeframes);

      // 5b. Add indicator configs
      const newConfigs = this.services.timeframes.map(tf => ({
        symbol: normalizedSymbol,
        timeframe: tf
      }));
      this.services.indicatorConfigs.push(...newConfigs);

      // 5c. Force indicator calculation from backfilled data
      for (const tf of this.services.timeframes) {
        await this.services.indicatorService.forceRecalculate(normalizedSymbol, tf);
      }

      // 5d. Resubscribe WebSocket with updated symbol list
      this.services.coinbaseAdapter.subscribe(this.services.monitoredSymbols, '5m');
    }

    logger.info(
      { symbol: normalizedSymbol, totalSymbols: this.services.monitoredSymbols.length },
      'Symbol added to watchlist'
    );

    return {
      added: true,
      symbol: normalizedSymbol,
      totalSymbols: this.services.monitoredSymbols.length,
      backfilled: !this.isPaused,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle remove-symbol command (SYM-02)
   * Removes symbol from watchlist and cleans up cache
   *
   * Payload:
   * - symbol: string (required) - e.g., "SOL-USD"
   */
  private async handleRemoveSymbol(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    const symbol = payload?.symbol as string;
    if (!symbol) {
      throw new Error('symbol is required in payload');
    }

    const normalizedSymbol = symbol.toUpperCase().trim();

    logger.info({ symbol: normalizedSymbol }, 'Removing symbol from watchlist');

    // 1. Get current symbols
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

    const currentSymbols: string[] = (result[0].settings as Record<string, unknown>)?.symbols as string[] ?? [];

    // 2. Check if exists
    if (!currentSymbols.includes(normalizedSymbol)) {
      return {
        status: 'not_found',
        symbol: normalizedSymbol,
        message: 'Symbol not in watchlist',
      };
    }

    // 3. Update database
    const newSymbols = currentSymbols.filter(s => s !== normalizedSymbol);
    await this.services.db.execute(sql`
      UPDATE users
      SET settings = jsonb_set(
        COALESCE(settings, '{}'),
        '{symbols}',
        ${JSON.stringify(newSymbols)}::jsonb,
        true
      ),
      updated_at = NOW()
      WHERE identity_provider = 'clerk' AND identity_sub = ${this.identitySub}
    `);

    // 4. Update in-memory list
    const idx = this.services.monitoredSymbols.indexOf(normalizedSymbol);
    if (idx > -1) {
      this.services.monitoredSymbols.splice(idx, 1);
    }

    // 5. Clean up Redis cache for removed symbol
    await this.cleanupSymbolCache(normalizedSymbol);

    // 6. If not paused, update running services
    if (!this.isPaused) {
      // Remove from indicator configs
      this.services.indicatorConfigs = this.services.indicatorConfigs.filter(
        c => c.symbol !== normalizedSymbol
      );

      // Resubscribe WebSocket without removed symbol
      // (CoinbaseAdapter handles unsubscribe internally when new list doesn't include symbol)
      this.services.coinbaseAdapter.subscribe(this.services.monitoredSymbols, '5m');
    }

    logger.info(
      { symbol: normalizedSymbol, totalSymbols: this.services.monitoredSymbols.length },
      'Symbol removed from watchlist'
    );

    return {
      removed: true,
      symbol: normalizedSymbol,
      totalSymbols: this.services.monitoredSymbols.length,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle bulk-add-symbols command (SYM-05)
   * Adds multiple validated symbols in one operation
   *
   * Payload:
   * - symbols: string[] (required) - Array of pre-validated symbols
   *
   * Note: Validation should happen in Admin UI via bulkValidate endpoint.
   * This handler assumes symbols are already validated.
   */
  private async handleBulkAddSymbols(payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    const symbols = payload?.symbols as string[];
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      throw new Error('symbols array is required in payload');
    }

    // Normalize all symbols
    const normalizedSymbols = symbols.map(s => s.toUpperCase().trim());

    logger.info({ count: normalizedSymbols.length }, 'Bulk adding symbols to watchlist');

    // 1. Get current symbols from database
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

    const currentSymbols: string[] = (result[0].settings as Record<string, unknown>)?.symbols as string[] ?? [];
    const existingSet = new Set(currentSymbols);

    // Filter out duplicates
    const toAdd = normalizedSymbols.filter(s => !existingSet.has(s));

    if (toAdd.length === 0) {
      return {
        added: 0,
        skipped: normalizedSymbols.length,
        message: 'All symbols already in watchlist',
        totalSymbols: this.services.monitoredSymbols.length,
      };
    }

    // 2. Update database with all new symbols at once
    const newSymbols = [...currentSymbols, ...toAdd];
    await this.services.db.execute(sql`
      UPDATE users
      SET settings = jsonb_set(
        COALESCE(settings, '{}'),
        '{symbols}',
        ${JSON.stringify(newSymbols)}::jsonb,
        true
      ),
      updated_at = NOW()
      WHERE identity_provider = 'clerk' AND identity_sub = ${this.identitySub}
    `);

    // 3. Update in-memory list
    this.services.monitoredSymbols.push(...toAdd);

    // 4. If not paused, initialize monitoring for new symbols
    const addedResults: Array<{ symbol: string; backfilled: boolean }> = [];

    if (!this.isPaused) {
      // Backfill all new symbols
      const backfillService = new StartupBackfillService(
        this.services.config.apiKeyId,
        this.services.config.privateKeyPem,
        this.services.redis
      );
      await backfillService.backfill(toAdd, this.services.timeframes);

      // Add indicator configs for all new symbols
      for (const symbol of toAdd) {
        const newConfigs = this.services.timeframes.map(tf => ({
          symbol,
          timeframe: tf
        }));
        this.services.indicatorConfigs.push(...newConfigs);

        // Force indicator calculation
        for (const tf of this.services.timeframes) {
          await this.services.indicatorService.forceRecalculate(symbol, tf);
        }

        addedResults.push({ symbol, backfilled: true });
      }

      // Resubscribe WebSocket with all symbols
      this.services.coinbaseAdapter.subscribe(this.services.monitoredSymbols, '5m');
    } else {
      // Paused - just record without backfill
      for (const symbol of toAdd) {
        addedResults.push({ symbol, backfilled: false });
      }
    }

    logger.info(
      { added: toAdd.length, skipped: normalizedSymbols.length - toAdd.length, total: this.services.monitoredSymbols.length },
      'Bulk add symbols complete'
    );

    return {
      added: toAdd.length,
      skipped: normalizedSymbols.length - toAdd.length,
      symbols: addedResults,
      totalSymbols: this.services.monitoredSymbols.length,
      timestamp: Date.now(),
    };
  }

  /**
   * Clean up Redis cache for a removed symbol
   * Deletes ticker, candles, and indicator keys
   */
  private async cleanupSymbolCache(symbol: string): Promise<void> {
    // Hardcoded userId/exchangeId - will be dynamic in multi-user
    const userId = 1;
    const exchangeId = 1;
    const keysToDelete: string[] = [];

    // Ticker key
    keysToDelete.push(`ticker:${userId}:${exchangeId}:${symbol}`);

    // Candle and indicator keys for all timeframes
    for (const tf of this.services!.timeframes) {
      keysToDelete.push(`candles:${userId}:${exchangeId}:${symbol}:${tf}`);
      keysToDelete.push(`indicator:${userId}:${exchangeId}:${symbol}:${tf}:macd-v`);
    }

    if (keysToDelete.length > 0) {
      const deleted = await deleteKeysClusterSafe(this.services!.redis, keysToDelete);
      logger.debug({ symbol, keysDeleted: deleted }, 'Cleaned up symbol cache');
    }
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
