import pino from 'pino';

/**
 * Create a structured logger instance using Pino
 *
 * @param name - Name/context for the logger (e.g., 'api', 'websocket', 'indicators')
 * @returns Configured Pino logger instance
 */
export function createLogger(name: string) {
  const isDevelopment = process.env.NODE_ENV === 'development';

  return pino({
    name,
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
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
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Global logger instance for general use
 */
export const logger = createLogger('livermore');

/**
 * Helper type for logger instances
 */
export type Logger = ReturnType<typeof createLogger>;
