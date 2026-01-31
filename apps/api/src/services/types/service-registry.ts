import type { CoinbaseAdapter, BoundaryRestService } from '@livermore/coinbase-client';
import type { Database } from '@livermore/database';
import type { Timeframe } from '@livermore/schemas';
import type Redis from 'ioredis';
import type { IndicatorCalculationService } from '../indicator-calculation.service';
import type { AlertEvaluationService } from '../alert-evaluation.service';

/**
 * Runtime configuration for services that need API credentials
 * Used by force-backfill and other operations requiring Coinbase API access
 */
export interface RuntimeConfig {
  apiKeyId: string;
  privateKeyPem: string;
}

/**
 * ServiceRegistry interface
 *
 * Provides type-safe access to all services from ControlChannelService.
 * Services are injected via constructor to enable runtime commands like:
 * - pause/resume: Stop and restart data pipeline services
 * - force-backfill: Trigger cache backfill via StartupBackfillService
 * - clear-cache: Delete Redis keys via redis client
 * - reload-settings: Refresh settings from database
 *
 * Architecture notes:
 * - Services are references, not recreated on resume
 * - Existing start/stop methods are called, not new instances
 * - Config holds credentials for operations requiring API access
 */
export interface ServiceRegistry {
  /** CoinbaseAdapter - WebSocket connection for real-time data */
  coinbaseAdapter: CoinbaseAdapter;

  /** IndicatorCalculationService - Calculates MACD-V from cached candles */
  indicatorService: IndicatorCalculationService;

  /** AlertEvaluationService - Monitors MACD-V levels and triggers alerts */
  alertService: AlertEvaluationService;

  /** BoundaryRestService - Fetches higher timeframes at boundaries */
  boundaryRestService: BoundaryRestService;

  /** Redis client for cache operations (clearing, pattern deletion) */
  redis: Redis;

  /** Database client for settings reload and queries */
  db: Database;

  /** Runtime config with API credentials for backfill operations */
  config: RuntimeConfig;

  /** Symbols currently being monitored (for resume resubscription) */
  monitoredSymbols: string[];

  /** Indicator configs for all symbol/timeframe combinations */
  indicatorConfigs: Array<{ symbol: string; timeframe: Timeframe }>;

  /** Supported timeframes for alert service */
  timeframes: Timeframe[];
}
