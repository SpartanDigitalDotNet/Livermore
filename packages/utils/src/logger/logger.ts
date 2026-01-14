import pino from 'pino';
import { FileTransport } from './file-transport';
import { PerformanceTracker, createNoOpPerformanceTracker } from './performance';
import {
  type LogLevel,
  type LogConfig,
  getLogLevel,
  getServiceFromName,
  buildRuntimeConfig,
  shouldLog,
  LOG_LEVEL_PRIORITY,
} from './log-config';

/**
 * Logger options for creating a new logger
 */
export interface LoggerOptions {
  /** Logger name (e.g., 'indicators:macdv') */
  name: string;
  /** Service for file grouping (auto-detected from name if not provided) */
  service?: string;
  /** Minimum log level (auto-detected from config if not provided) */
  level?: LogLevel;
  /** Enable file logging (default: from config) */
  enableFileLogging?: boolean;
  /** Enable performance logging (default: from config) */
  enablePerfLogging?: boolean;
  /** Custom log config (default: runtime config) */
  config?: LogConfig;
}

/**
 * Extended logger interface with file transport and perf tracking
 */
export interface Logger {
  trace: (obj: Record<string, unknown> | string, msg?: string) => void;
  debug: (obj: Record<string, unknown> | string, msg?: string) => void;
  info: (obj: Record<string, unknown> | string, msg?: string) => void;
  warn: (obj: Record<string, unknown> | string, msg?: string) => void;
  error: (obj: Record<string, unknown> | string, msg?: string) => void;
  fatal: (obj: Record<string, unknown> | string, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => Logger;
  perf: PerformanceTracker;
  flush: () => Promise<void>;
}

// Singleton file transports per service
const fileTransports: Map<string, FileTransport> = new Map();

// Singleton runtime config
let runtimeConfig: LogConfig | null = null;

/**
 * Get or create file transport for a service
 */
function getFileTransport(service: string, config: LogConfig): FileTransport {
  if (!fileTransports.has(service)) {
    fileTransports.set(
      service,
      new FileTransport({
        logDir: config.logDir,
        service,
        separateErrorLog: true,
      })
    );
  }
  return fileTransports.get(service)!;
}

/**
 * Get runtime config (cached)
 */
function getRuntimeConfig(): LogConfig {
  if (!runtimeConfig) {
    runtimeConfig = buildRuntimeConfig();
  }
  return runtimeConfig;
}

/**
 * Create a structured logger instance
 *
 * Features:
 * - Console output with pino-pretty in development
 * - File output with rotation (JSON format)
 * - Separate error logs
 * - Performance tracking
 * - Child loggers with context propagation
 *
 * @param options - Logger configuration options (or just a name string for backward compatibility)
 * @returns Configured Logger instance
 */
export function createLogger(options: LoggerOptions | string): Logger {
  // Handle backward compatibility: createLogger('name') -> createLogger({ name: 'name' })
  const opts: LoggerOptions =
    typeof options === 'string' ? { name: options } : options;

  const config = opts.config || getRuntimeConfig();
  const service = opts.service || getServiceFromName(opts.name);
  const level = opts.level || getLogLevel(opts.name, config);
  const enableFileLogging = opts.enableFileLogging ?? config.enableFileLogging;
  const enablePerfLogging = opts.enablePerfLogging ?? config.enablePerfLogging;

  const isDevelopment = process.env.NODE_ENV === 'development';

  // Create pino logger for console output
  const pinoLogger = pino({
    name: opts.name,
    level,
    ...(isDevelopment && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    }),
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  // Get file transport if enabled
  const fileTransport = enableFileLogging
    ? getFileTransport(service, config)
    : null;

  // Create performance tracker
  const perfTracker = enablePerfLogging
    ? new PerformanceTracker(fileTransport)
    : createNoOpPerformanceTracker();

  /**
   * Create a log method that writes to both console and file
   */
  function createLogMethod(
    logLevel: LogLevel,
    pinoMethod: pino.LogFn
  ): (obj: Record<string, unknown> | string, msg?: string) => void {
    return (obj: Record<string, unknown> | string, msg?: string) => {
      // Normalize arguments
      const logObj: Record<string, unknown> =
        typeof obj === 'string' ? { msg: obj } : { ...obj, msg };

      // Log to console via pino
      if (typeof obj === 'string') {
        pinoMethod.call(pinoLogger, obj);
      } else {
        pinoMethod.call(pinoLogger, obj, msg);
      }

      // Log to file if enabled
      if (fileTransport && shouldLog(logLevel, level)) {
        fileTransport.write({
          timestamp: new Date().toISOString(),
          level: logLevel.toUpperCase(),
          name: opts.name,
          service,
          ...logObj,
        });
      }
    };
  }

  /**
   * Create a child logger with additional context
   */
  function createChild(bindings: Record<string, unknown>): Logger {
    const childName = bindings.name
      ? `${opts.name}:${bindings.name}`
      : opts.name;

    // Create child pino logger
    const childPino = pinoLogger.child(bindings);

    // Create log methods with child context
    function createChildLogMethod(
      logLevel: LogLevel,
      pinoMethod: pino.LogFn
    ): (obj: Record<string, unknown> | string, msg?: string) => void {
      return (obj: Record<string, unknown> | string, msg?: string) => {
        const logObj: Record<string, unknown> =
          typeof obj === 'string' ? { msg: obj } : { ...obj, msg };

        if (typeof obj === 'string') {
          pinoMethod.call(childPino, obj);
        } else {
          pinoMethod.call(childPino, obj, msg);
        }

        if (fileTransport && shouldLog(logLevel, level)) {
          fileTransport.write({
            timestamp: new Date().toISOString(),
            level: logLevel.toUpperCase(),
            name: childName,
            service,
            ...bindings,
            ...logObj,
          });
        }
      };
    }

    return {
      trace: createChildLogMethod('trace', childPino.trace.bind(childPino)),
      debug: createChildLogMethod('debug', childPino.debug.bind(childPino)),
      info: createChildLogMethod('info', childPino.info.bind(childPino)),
      warn: createChildLogMethod('warn', childPino.warn.bind(childPino)),
      error: createChildLogMethod('error', childPino.error.bind(childPino)),
      fatal: createChildLogMethod('fatal', childPino.fatal.bind(childPino)),
      child: (childBindings: Record<string, unknown>) =>
        createChild({ ...bindings, ...childBindings }),
      perf: perfTracker,
      flush: async () => {
        if (fileTransport) await fileTransport.flush();
      },
    };
  }

  return {
    trace: createLogMethod('trace', pinoLogger.trace.bind(pinoLogger)),
    debug: createLogMethod('debug', pinoLogger.debug.bind(pinoLogger)),
    info: createLogMethod('info', pinoLogger.info.bind(pinoLogger)),
    warn: createLogMethod('warn', pinoLogger.warn.bind(pinoLogger)),
    error: createLogMethod('error', pinoLogger.error.bind(pinoLogger)),
    fatal: createLogMethod('fatal', pinoLogger.fatal.bind(pinoLogger)),
    child: createChild,
    perf: perfTracker,
    flush: async () => {
      if (fileTransport) await fileTransport.flush();
    },
  };
}

/**
 * Global logger instance for general use
 * (Backward compatible with existing code)
 */
export const logger = createLogger('livermore');

/**
 * Flush all file transports (for graceful shutdown)
 */
export async function flushAllLogs(): Promise<void> {
  const flushPromises: Promise<void>[] = [];
  for (const transport of fileTransports.values()) {
    flushPromises.push(transport.flush());
  }
  await Promise.all(flushPromises);
}

/**
 * Close all file transports (for shutdown)
 */
export function closeAllLogs(): void {
  for (const transport of fileTransports.values()) {
    transport.closeStreams();
  }
  fileTransports.clear();
}

// Re-export types for convenience
export type { LogLevel, LogConfig };
export { LOG_LEVEL_PRIORITY };
