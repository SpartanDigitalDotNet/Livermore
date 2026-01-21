/**
 * Log levels in order of verbosity (most verbose first)
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Log level priority (lower number = more verbose)
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Per-service log level configuration
 *
 * Service names follow the pattern: category:subcategory
 * e.g., 'indicators:macdv', 'candles:gaps'
 */
export interface LogConfig {
  /** Default log level for all services */
  defaultLevel: LogLevel;
  /** Per-service level overrides */
  services: Record<string, LogLevel>;
  /** Enable file logging */
  enableFileLogging: boolean;
  /** Enable performance logging */
  enablePerfLogging: boolean;
  /** Log directory path */
  logDir: string;
}

/**
 * Default log configuration
 *
 * Production: error-only for high-transaction services
 * To debug, set LOG_LEVEL=debug or LOG_LEVEL_INDICATORS=debug env var
 */
export const DEFAULT_LOG_CONFIG: LogConfig = {
  defaultLevel: 'info',
  services: {
    // Indicator-related (error-only in production, high transaction volume)
    indicators: 'error',
    'indicators:macdv': 'error',
    'indicators:atr': 'error',
    'indicators:scheduler': 'error',

    // Candle-related (error-only in production)
    candles: 'error',
    'candles:cache': 'error',
    'candles:gaps': 'error',
    'candles:fetch': 'error',

    // Scheduler (error-only in production)
    scheduler: 'error',
    'scheduler:boundary': 'error',
    'scheduler:recalculate': 'error',

    // API (standard level)
    api: 'info',
    'api:router': 'info',
    'api:trpc': 'info',

    // WebSocket (standard level)
    websocket: 'info',
    'websocket:coinbase': 'info',
    'websocket:heartbeat': 'info',

    // Cache (standard level)
    cache: 'info',
    'cache:redis': 'info',
    'cache:indicator': 'info',
  },
  enableFileLogging: true,
  enablePerfLogging: true,
  logDir: 'logs',
};

/**
 * Get the effective log level for a service
 *
 * Checks in order:
 * 1. Environment variable: LOG_LEVEL_{SERVICE} (e.g., LOG_LEVEL_INDICATORS=trace)
 * 2. Per-service config
 * 3. Parent service config (e.g., 'indicators' for 'indicators:macdv')
 * 4. Default level
 */
export function getLogLevel(
  serviceName: string,
  config: LogConfig = DEFAULT_LOG_CONFIG
): LogLevel {
  // Check environment variable override
  const envKey = `LOG_LEVEL_${serviceName.replace(/:/g, '_').toUpperCase()}`;
  const envLevel = process.env[envKey]?.toLowerCase() as LogLevel | undefined;
  if (envLevel && LOG_LEVEL_PRIORITY[envLevel] !== undefined) {
    return envLevel;
  }

  // Check global LOG_LEVEL environment variable
  const globalEnvLevel = process.env.LOG_LEVEL?.toLowerCase() as
    | LogLevel
    | undefined;
  if (globalEnvLevel && LOG_LEVEL_PRIORITY[globalEnvLevel] !== undefined) {
    return globalEnvLevel;
  }

  // Check exact service match
  if (config.services[serviceName]) {
    return config.services[serviceName];
  }

  // Check parent service (e.g., 'indicators' for 'indicators:macdv')
  const parentService = serviceName.split(':')[0];
  if (parentService !== serviceName && config.services[parentService]) {
    return config.services[parentService];
  }

  return config.defaultLevel;
}

/**
 * Check if a log level should be logged given the minimum level
 */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}

/**
 * Get the service name from a logger name (first segment before ':')
 */
export function getServiceFromName(name: string): string {
  return name.split(':')[0];
}

/**
 * Build runtime config by merging defaults with environment
 */
export function buildRuntimeConfig(): LogConfig {
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Relative path from apps/api to project root
  const defaultLogDir = '../../logs';

  return {
    ...DEFAULT_LOG_CONFIG,
    enableFileLogging:
      process.env.LOG_FILE_ENABLED !== 'false' && isDevelopment,
    enablePerfLogging:
      process.env.LOG_PERF_ENABLED !== 'false' && isDevelopment,
    logDir: process.env.LOG_DIR || defaultLogDir,
  };
}
