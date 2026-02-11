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
 * Long-running commands that should fire-and-forget (publish only, no subscriber).
 * Progress is monitored via the status polling endpoint.
 */
const FIRE_AND_FORGET = new Set(['force-backfill', 'start']);

/**
 * Control Router
 *
 * Provides endpoints for Admin UI to:
 * - Poll API runtime status
 * - Execute control commands via Redis pub/sub
 *
 * Short commands (pause, resume, etc.) use request-response over pub/sub.
 * Long-running commands (backfill, start) publish and return immediately.
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
      // Phase 26: Connection state for start/stop UI
      connectionState: state.connectionState,
      // Phase 29: Startup progress for UI
      startup: state.startup,
    };
  }),

  /**
   * POST /control.executeCommand
   *
   * Execute a control command via Redis pub/sub.
   *
   * Long-running commands (backfill, start): publish and return immediately.
   * Short commands (pause, resume, etc.): publish, subscribe for response,
   * wait up to 30s for success/error.
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

      const commandChannelKey = commandChannel(clerkId);

      ctx.logger.info(
        { correlationId, type: input.type },
        'Executing control command'
      );

      // Long-running commands: just publish and return
      if (FIRE_AND_FORGET.has(input.type)) {
        await redis.publish(commandChannelKey, JSON.stringify(command));
        ctx.logger.debug(
          { correlationId, channel: commandChannelKey },
          'Command published (fire-and-forget)'
        );
        return { success: true };
      }

      // Short commands: publish and wait for response
      const subscriber = redis.duplicate();
      const responseChannelKey = responseChannel(clerkId);

      return new Promise<{ success: boolean; data?: unknown; message?: string }>(
        async (resolve, reject) => {
          let settled = false;

          const cleanup = () => {
            if (subscriber.status === 'ready') {
              subscriber.unsubscribe().catch((err: unknown) => {
                ctx.logger.error({ err }, 'Failed to unsubscribe Redis subscriber');
              });
            }
            subscriber.quit().catch((err: unknown) => {
              ctx.logger.error({ err }, 'Failed to quit Redis subscriber');
            });
          };

          subscriber.on('error', (err) => {
            ctx.logger.error({ err }, 'Redis subscriber connection error');
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              cleanup();
              reject(
                new TRPCError({
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'Redis subscriber error',
                })
              );
            }
          });

          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(
                new TRPCError({
                  code: 'TIMEOUT',
                  message: 'Command timed out after 30 seconds',
                })
              );
            }
          }, 30_000);

          subscriber.on('message', (_channel: string, message: string) => {
            try {
              const response = JSON.parse(message) as CommandResponse;
              if (response.correlationId !== correlationId) return;

              if (response.status === 'success' && !settled) {
                settled = true;
                clearTimeout(timeout);
                cleanup();
                resolve({ success: true, data: response.data });
              } else if (response.status === 'error' && !settled) {
                settled = true;
                clearTimeout(timeout);
                cleanup();
                resolve({
                  success: false,
                  message: response.message ?? 'Command failed',
                });
              }
            } catch (err) {
              ctx.logger.error({ err, message }, 'Failed to parse response');
            }
          });

          await subscriber.subscribe(responseChannelKey);
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
