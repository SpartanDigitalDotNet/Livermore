import { getRedisClient, commandChannel, responseChannel } from '@livermore/cache';
import { createLogger } from '@livermore/utils';
import { CommandSchema, type Command, type CommandResponse } from '@livermore/schemas';
import type Redis from 'ioredis';

const logger = createLogger({ name: 'control-channel', service: 'control' });

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
 */
export class ControlChannelService {
  private redis = getRedisClient();
  private subscriber: Redis | null = null;
  private identitySub: string;
  private commandChannelKey: string;
  private responseChannelKey: string;
  private readonly COMMAND_TIMEOUT_MS = 30_000; // RUN-12: 30 second timeout

  constructor(identitySub: string) {
    this.identitySub = identitySub;
    this.commandChannelKey = commandChannel(identitySub);
    this.responseChannelKey = responseChannel(identitySub);
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

    logger.debug(
      { correlationId: command.correlationId, type: command.type },
      'Valid command received, processing'
    );

    // Process command directly
    await this.handleCommand(command);
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
   * Execute a command
   * Phase 18: Returns stub, actual handlers implemented in Phase 19
   */
  private async executeCommand(command: Command): Promise<Record<string, unknown>> {
    logger.info(
      { type: command.type, payload: command.payload },
      'Executing command'
    );

    // Phase 18 stub - actual command handlers will be implemented in Phase 19
    // This allows the infrastructure to be tested end-to-end
    return {
      executed: true,
      type: command.type,
    };
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
