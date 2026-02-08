import type { BoundaryRestService } from '@livermore/exchange-core';
import type { Database } from '@livermore/database';
import type { Timeframe, IExchangeAdapter, IRestClient } from '@livermore/schemas';
import type { RedisClient } from '@livermore/cache';
import type { IndicatorCalculationService } from '../indicator-calculation.service';
import type { AlertEvaluationService } from '../alert-evaluation.service';
import type { ExchangeAdapterFactory } from '../exchange/adapter-factory';
import type { SymbolSourceService, ClassifiedSymbol } from '../symbol-source.service';

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
  /** Exchange adapter - WebSocket connection for real-time data (Phase 29: via factory) */
  coinbaseAdapter: IExchangeAdapter;

  /** IndicatorCalculationService - Calculates MACD-V from cached candles */
  indicatorService: IndicatorCalculationService;

  /** AlertEvaluationService - Monitors MACD-V levels and triggers alerts */
  alertService: AlertEvaluationService;

  /** BoundaryRestService - Fetches higher timeframes at boundaries */
  boundaryRestService: BoundaryRestService;

  /** Redis client for cache operations (clearing, pattern deletion) */
  redis: RedisClient;

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

  /** Active exchange ID (null until start, set from user_exchanges) */
  exchangeId: number | null;

  /** REST client for the active exchange (null until start) */
  restClient: IRestClient | null;

  /** Phase 29: Exchange adapter factory for creating adapters */
  adapterFactory?: ExchangeAdapterFactory;

  /** Phase 29: Symbol source service for tier classification */
  symbolSourceService?: SymbolSourceService;

  /** Phase 29: Classified symbols with tier info */
  classifiedSymbols?: ClassifiedSymbol[];
}
