/**
 * Coinbase API client exports
 */

export { CoinbaseRestClient, type CoinbaseAccount, type CoinbaseOrder, type CoinbaseTransactionSummary, type FilledOrdersOptions } from './rest/client';
export { CoinbaseAuth } from './rest/auth';
export { CoinbaseWebSocketClient, type CoinbaseWSMessage, type MessageHandler } from './websocket/client';

// Adapter base class
export * from './adapter';

// Backfill service
export { StartupBackfillService, DEFAULT_BACKFILL_DEFAULTS, TIMEFRAME_PRIORITY } from './backfill';
export type { BackfillConfig } from './backfill';

// Reconciliation service (event-driven boundary REST fetching)
export { BoundaryRestService, detectBoundaries, isTimeframeBoundary, DEFAULT_BOUNDARY_CONFIG } from './reconciliation';
export { detectGaps, detectGapsForSymbol, getTimestampsOnly } from './reconciliation';
export type { BoundaryRestConfig, TimeframeBoundary, GapInfo } from './reconciliation';

// Smart warmup (Phase 35)
export * from './warmup';
