import { z } from 'zod';

/**
 * Command types for the control channel
 *
 * Phase 18 (Control Channel Foundation):
 * - pause: Pause data collection (keeps control channel active)
 * - resume: Resume data collection
 *
 * Phase 19 (Runtime Commands):
 * - reload-settings: Reload user settings from database
 * - switch-mode: Switch between paper/live trading mode
 * - force-backfill: Force re-backfill historical data
 * - clear-cache: Clear Redis cache for user
 *
 * Phase 20 (Symbol Management):
 * - add-symbol: Add symbol to tracking list
 * - remove-symbol: Remove symbol from tracking list
 *
 * Phase 26 (Startup Control):
 * - start: Initiate exchange connections (exits idle mode)
 * - stop: Gracefully disconnect from exchanges (enters idle mode)
 */
export const CommandTypeSchema = z.enum([
  // Phase 18 - Control channel foundation
  'pause',
  'resume',
  // Phase 19 - Runtime commands
  'reload-settings',
  'switch-mode',
  'force-backfill',
  'clear-cache',
  // Phase 20 - Symbol management
  'add-symbol',
  'remove-symbol',
  'bulk-add-symbols',
  // Phase 26 - Startup control
  'start',
  'stop',
]);

/**
 * Command message schema
 * Published by Admin UI to livermore:commands:{sub} channel
 * Subscribed by API service
 */
export const CommandSchema = z.object({
  /** Unique identifier for correlating request/response */
  correlationId: z.string().uuid(),
  /** Type of command to execute */
  type: CommandTypeSchema,
  /** Optional command-specific payload */
  payload: z.record(z.unknown()).optional(),
  /** Unix timestamp (milliseconds) when command was issued */
  timestamp: z.number(),
  /** Priority 1-100 (100 = highest, used for command ordering) */
  priority: z.number().min(1).max(100),
});

/**
 * Command response status
 * - ack: Command received, processing started
 * - success: Command completed successfully
 * - error: Command failed
 */
export const CommandResponseStatusSchema = z.enum(['ack', 'success', 'error']);

/**
 * Command response message schema
 * Published by API service to livermore:responses:{sub} channel
 * Subscribed by Admin UI
 */
export const CommandResponseSchema = z.object({
  /** Correlation ID matching the original command */
  correlationId: z.string().uuid(),
  /** Response status */
  status: CommandResponseStatusSchema,
  /** Optional human-readable message */
  message: z.string().optional(),
  /** Optional response data (command-specific) */
  data: z.unknown().optional(),
  /** Unix timestamp (milliseconds) when response was generated */
  timestamp: z.number(),
});

// Export inferred TypeScript types
export type CommandType = z.infer<typeof CommandTypeSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type CommandResponseStatus = z.infer<typeof CommandResponseStatusSchema>;
export type CommandResponse = z.infer<typeof CommandResponseSchema>;
