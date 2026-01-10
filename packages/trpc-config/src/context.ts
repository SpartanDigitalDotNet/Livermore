import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { createLogger, type Logger } from '@livermore/utils';

/**
 * Base context interface
 * This will be extended with database, cache, and service instances
 * when setting up the actual API server
 */
export interface BaseContext {
  /** Logger instance for this request */
  logger: Logger;
  /** Request ID for tracing */
  requestId: string;
}

/**
 * Create tRPC context for each request
 *
 * This function is called for every request and sets up the context
 * that will be available in all tRPC procedures.
 */
export function createContext({ req }: CreateFastifyContextOptions): BaseContext {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  const logger = createLogger('trpc').child({ requestId });

  return {
    logger,
    requestId,
  };
}

/**
 * Generate a simple request ID for tracing
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Type helper for context
 */
export type Context = BaseContext;
