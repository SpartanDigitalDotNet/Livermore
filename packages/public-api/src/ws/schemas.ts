import { z } from 'zod';

/**
 * Zod schemas for client-to-server WebSocket messages.
 *
 * Clients send JSON messages with an `action` field to subscribe/unsubscribe
 * from data channels. Channel format: `candles:BTC-USD:1h` or `signals:ETH-USD:15m`.
 */

/** Schema for subscribe action */
export const subscribeSchema = z.object({
  action: z.literal('subscribe').describe('Action to subscribe to channels'),
  channels: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe('Array of channel names to subscribe to (1-20). Format: "candles:SYMBOL:TIMEFRAME" or "signals:SYMBOL:TIMEFRAME"'),
});

/** Schema for unsubscribe action */
export const unsubscribeSchema = z.object({
  action: z.literal('unsubscribe').describe('Action to unsubscribe from channels'),
  channels: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe('Array of channel names to unsubscribe from (1-20)'),
});

/**
 * Discriminated union of all client-to-server messages.
 * Discriminates on the `action` field.
 */
export const clientMessageSchema = z.discriminatedUnion('action', [
  subscribeSchema,
  unsubscribeSchema,
]);

export type ClientMessagePayload = z.infer<typeof clientMessageSchema>;
