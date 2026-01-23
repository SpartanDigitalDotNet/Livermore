/**
 * Reconciliation module - event-driven higher timeframe fetching
 *
 * This module provides boundary-triggered REST fetching for higher timeframes.
 * When a 5m candle closes that aligns with a higher timeframe boundary,
 * the BoundaryRestService fetches fresh candles from Coinbase REST API.
 *
 * Key components:
 * - BoundaryRestService: Subscribes to 5m candle:close, fetches at boundaries
 * - detectBoundaries: Pure function to detect timeframe boundary alignment
 * - detectGaps: Pure function to identify missing candles in cache
 * - BoundaryRestConfig: Configuration for rate limiting and timeframes
 */

export { BoundaryRestService } from './boundary-rest-service';
export { detectBoundaries, isTimeframeBoundary } from './boundary-detector';
export { detectGaps, detectGapsForSymbol, getTimestampsOnly } from './gap-detector';
export type { BoundaryRestConfig, TimeframeBoundary, GapInfo } from './types';
export { DEFAULT_BOUNDARY_CONFIG } from './types';
