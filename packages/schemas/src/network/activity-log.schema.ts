import { z } from 'zod';
import { ConnectionStateSchema } from './instance-status.schema';

// ============================================
// Base Log Entry (shared fields, not exported)
// ============================================

const BaseLogEntrySchema = z.object({
  timestamp: z.string(),       // ISO 8601
  exchangeId: z.string(),      // String because Redis Streams store all values as strings
  exchangeName: z.string(),
  hostname: z.string(),
  ip: z.string(),              // Empty string if unknown
});

// ============================================
// State Transition Entry (LOG-02)
// ============================================

export const StateTransitionEntrySchema = BaseLogEntrySchema.extend({
  event: z.literal('state_transition'),
  fromState: ConnectionStateSchema,
  toState: ConnectionStateSchema,
  adminEmail: z.string(),      // Empty string if not yet known
});

export type StateTransitionEntry = z.infer<typeof StateTransitionEntrySchema>;

// ============================================
// Error Entry (LOG-03)
// ============================================

export const ErrorEntrySchema = BaseLogEntrySchema.extend({
  event: z.literal('error'),
  error: z.string(),
  state: ConnectionStateSchema,
});

export type ErrorEntry = z.infer<typeof ErrorEntrySchema>;

// ============================================
// Discriminated Union (LOG-05)
// ============================================

export const NetworkActivityEntrySchema = z.discriminatedUnion('event', [
  StateTransitionEntrySchema,
  ErrorEntrySchema,
]);

export type NetworkActivityEntry = z.infer<typeof NetworkActivityEntrySchema>;
