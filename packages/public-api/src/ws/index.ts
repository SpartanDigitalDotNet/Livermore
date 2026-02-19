/**
 * WebSocket streaming module barrel export.
 *
 * Provides the WebSocket bridge engine, client connection management,
 * and message handling for the /stream endpoint.
 */

export { WebSocketBridge } from './bridge.js';
export { ClientConnection } from './connection.js';
export { handleClientMessage } from './handlers.js';
export { clientMessageSchema, subscribeSchema, unsubscribeSchema } from './schemas.js';
export type { ClientMessagePayload } from './schemas.js';
export { mapExternalChannel, VALID_TIMEFRAMES } from './types.js';
export type {
  WsEnvelope,
  WsMessageType,
  ClientAction,
  ClientMessage,
  ChannelType,
  ParsedChannel,
  ValidTimeframe,
} from './types.js';
