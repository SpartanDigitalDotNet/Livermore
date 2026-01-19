/**
 * Coinbase API client exports
 */

export { CoinbaseRestClient, type CoinbaseAccount, type CoinbaseOrder, type CoinbaseTransactionSummary, type FilledOrdersOptions } from './rest/client';
export { CoinbaseAuth } from './rest/auth';
export { CoinbaseWebSocketClient, type CoinbaseWSMessage, type MessageHandler } from './websocket/client';
