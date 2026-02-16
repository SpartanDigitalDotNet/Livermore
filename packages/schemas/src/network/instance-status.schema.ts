import { z } from 'zod';

// ============================================
// Connection State: 6-state lifecycle model
// ============================================

export const ConnectionStateSchema = z.enum([
  'idle',
  'starting',
  'warming',
  'active',
  'stopping',
  'stopped',
]);

export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

// ============================================
// State Machine: Valid Transitions
// ============================================

/**
 * Defines allowed state transitions for exchange instance lifecycle.
 *
 * idle     -> starting                     (begin startup)
 * starting -> warming | stopping | idle    (idle for error recovery)
 * warming  -> active | stopping | idle     (idle for error recovery)
 * active   -> stopping                     (begin shutdown)
 * stopping -> stopped                      (shutdown complete)
 * stopped  -> idle                         (ready for restart)
 */
export const VALID_TRANSITIONS = {
  idle: ['starting'],
  starting: ['warming', 'stopping', 'idle'],
  warming: ['active', 'stopping', 'idle'],
  active: ['stopping'],
  stopping: ['stopped'],
  stopped: ['idle'],
} as const satisfies Record<ConnectionState, readonly ConnectionState[]>;

// ============================================
// Heartbeat Constants
// ============================================

/** Heartbeat interval in milliseconds (15 seconds) */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Heartbeat TTL in milliseconds (45 seconds, 3x interval) */
export const HEARTBEAT_TTL_MS = 45_000;

/** Heartbeat TTL in seconds (for Redis SET EX) */
export const HEARTBEAT_TTL_SECONDS = 45;

// ============================================
// Instance Status Schema
// ============================================

/**
 * Full identity payload for an exchange instance.
 * Stored in Redis as JSON with TTL for heartbeat-based expiration.
 *
 * Key pattern: exchange:{exchangeId}:status
 */
export const InstanceStatusSchema = z.object({
  // Identity
  exchangeId: z.number(),
  exchangeName: z.string(),
  hostname: z.string(),
  ipAddress: z.string().nullable(),
  countryCode: z.string().nullable().default(null), // ISO 3166-1 alpha-2 (e.g. "US", "GB")
  adminEmail: z.string().nullable(),
  adminDisplayName: z.string().nullable(),

  // State
  connectionState: ConnectionStateSchema,
  symbolCount: z.number(),

  // Timestamps (ISO strings)
  connectedAt: z.string().nullable(), // Set when entering 'active'
  lastHeartbeat: z.string(), // Updated every heartbeat
  lastStateChange: z.string(), // Updated on every transition
  registeredAt: z.string(), // Set once at registration

  // Error tracking
  lastError: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
});

export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;
