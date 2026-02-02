import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getRedisClient, commandChannel, responseChannel } from '@livermore/cache';
import { CommandTypeSchema, type CommandResponse } from '@livermore/schemas';
import { getRuntimeState } from '../services/runtime-state';
import crypto from 'crypto';

/**
 * Priority levels for command ordering (matches control-channel.service.ts)
 */
const PRIORITY: Record<string, number> = {
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
 * Control Router
 *
 * Provides endpoints for Admin UI to:
 * - Poll API runtime status
 * - Execute control commands via Redis pub/sub
 *
 * Commands are published to Redis and processed by ControlChannelService.
 * Admin UI receives ACK immediately, then final result when complete.
 */
export const controlRouter = router({
  /**
   * GET /control.getStatus
   *
   * Returns current API runtime status for dashboard display.
   * Called via polling (5s interval) from Admin UI.
   *
   * Note: This is a placeholder that returns mock status.
   * Full implementation requires exposing ControlChannelService state,
   * which will be done when we integrate with server.ts context.
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.debug('Fetching API status');

    const state = getRuntimeState();
    return {
      isPaused: state.isPaused,
      mode: state.mode,
      uptime: Math.floor((Date.now() - state.startTime) / 1000),
      startTime: state.startTime,
      exchangeConnected: state.exchangeConnected,
      queueDepth: state.queueDepth,
    };
  }),

  /**
   * POST /control.executeCommand
   *
   * Execute a control command via Redis pub/sub.
   * Publishes command to Redis channel, subscribes to response channel,
   * waits for success/error response (with 30s timeout).
   *
   * Flow:
   * 1. Create command with correlationId
   * 2. Subscribe to response channel
   * 3. Publish command to command channel
   * 4. Wait for response matching correlationId
   * 5. Return response data or throw error
   */
  executeCommand: protectedProcedure
    .input(
      z.object({
        type: CommandTypeSchema,
        payload: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const correlationId = crypto.randomUUID();
      const redis = getRedisClient();
      const clerkId = ctx.auth.userId;

      const command = {
        correlationId,
        type: input.type,
        payload: input.payload,
        timestamp: Date.now(),
        priority: PRIORITY[input.type] ?? 50,
      };

      ctx.logger.info(
        { correlationId, type: input.type },
        'Executing control command'
      );

      // Create subscriber for response
      const subscriber = redis.duplicate();
      const responseChannelKey = responseChannel(clerkId);
      const commandChannelKey = commandChannel(clerkId);

      return new Promise<{ success: boolean; data?: unknown; message?: string }>(
        async (resolve, reject) => {
          // 30 second timeout
          const timeout = setTimeout(() => {
            subscriber.unsubscribe();
            subscriber.quit();
            reject(
              new TRPCError({
                code: 'TIMEOUT',
                message: 'Command timed out after 30 seconds',
              })
            );
          }, 30_000);

          subscriber.on('message', (_channel: string, message: string) => {
            try {
              const response = JSON.parse(message) as CommandResponse;

              // Only process responses for our command
              if (response.correlationId !== correlationId) {
                return;
              }

              if (response.status === 'success') {
                clearTimeout(timeout);
                subscriber.unsubscribe();
                subscriber.quit();
                resolve({ success: true, data: response.data });
              } else if (response.status === 'error') {
                clearTimeout(timeout);
                subscriber.unsubscribe();
                subscriber.quit();
                resolve({
                  success: false,
                  message: response.message ?? 'Command failed',
                });
              }
              // 'ack' status is ignored - wait for final status
            } catch (err) {
              ctx.logger.error({ err, message }, 'Failed to parse response');
            }
          });

          // Subscribe before publishing to avoid race condition
          await subscriber.subscribe(responseChannelKey);

          // Publish command
          await redis.publish(commandChannelKey, JSON.stringify(command));

          ctx.logger.debug(
            { correlationId, channel: commandChannelKey },
            'Command published'
          );
        }
      );
    }),
});

export type ControlRouter = typeof controlRouter;
