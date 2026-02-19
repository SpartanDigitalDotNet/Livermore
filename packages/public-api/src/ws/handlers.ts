import type { WebSocketBridge } from './bridge.js';
import { ClientConnection } from './connection.js';
import { clientMessageSchema } from './schemas.js';
import { mapExternalChannel } from './types.js';
import type { WsEnvelope } from './types.js';

/**
 * Send an error envelope to a client connection.
 */
function sendError(
  connection: ClientConnection,
  code: string,
  message: string
): void {
  const envelope: WsEnvelope = {
    type: 'error',
    code,
    message,
  };
  connection.send(JSON.stringify(envelope));
}

/**
 * Handle an incoming client-to-server WebSocket message.
 *
 * Parses JSON, validates against Zod schema, and dispatches
 * subscribe/unsubscribe actions with channel format validation.
 *
 * @param _bridge - WebSocketBridge instance (reserved for future use)
 * @param connection - The client connection that sent the message
 * @param raw - Raw message data from the WebSocket
 */
export function handleClientMessage(
  _bridge: WebSocketBridge,
  connection: ClientConnection,
  raw: Buffer | string
): void {
  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
  } catch {
    sendError(connection, 'PARSE_ERROR', 'Invalid JSON');
    return;
  }

  // Validate against schema
  const result = clientMessageSchema.safeParse(parsed);
  if (!result.success) {
    sendError(connection, 'INVALID_MESSAGE', result.error.issues[0]?.message ?? 'Invalid message format');
    return;
  }

  const { action, channels } = result.data;

  if (action === 'subscribe') {
    handleSubscribe(connection, channels);
  } else {
    handleUnsubscribe(connection, channels);
  }
}

/**
 * Process subscribe action: validate each channel format, add valid ones
 * to the connection's subscription set, report invalid ones as errors.
 */
function handleSubscribe(
  connection: ClientConnection,
  channels: string[]
): void {
  const validChannels: string[] = [];

  for (const channel of channels) {
    const parsed = mapExternalChannel(channel);
    if (!parsed) {
      sendError(
        connection,
        'INVALID_CHANNEL',
        `Invalid channel format: ${channel}. Expected: candles:SYMBOL:TIMEFRAME or signals:SYMBOL:TIMEFRAME`
      );
      continue;
    }
    connection.addSubscription(channel);
    validChannels.push(channel);
  }

  if (validChannels.length > 0) {
    const envelope: WsEnvelope = {
      type: 'subscribed',
      channels: validChannels,
    };
    connection.send(JSON.stringify(envelope));
  }
}

/**
 * Process unsubscribe action: remove each channel from the connection's
 * subscription set and confirm removal.
 */
function handleUnsubscribe(
  connection: ClientConnection,
  channels: string[]
): void {
  const removed: string[] = [];

  for (const channel of channels) {
    connection.removeSubscription(channel);
    removed.push(channel);
  }

  const envelope: WsEnvelope = {
    type: 'unsubscribed',
    channels: removed,
  };
  connection.send(JSON.stringify(envelope));
}
