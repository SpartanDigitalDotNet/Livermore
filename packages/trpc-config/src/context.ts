import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { getAuth } from '@clerk/fastify';
import type { SignedInAuthObject, SignedOutAuthObject } from '@clerk/backend/internal';
import { createLogger, type Logger } from '@livermore/utils';

/**
 * Clerk auth can be signed in (has userId) or signed out (userId is null)
 */
type ClerkAuth = SignedInAuthObject | SignedOutAuthObject;

/**
 * Base context interface with Clerk auth
 * Available in all tRPC procedures
 */
export interface BaseContext {
  /** Logger instance for this request */
  logger: Logger;
  /** Request ID for tracing */
  requestId: string;
  /** Clerk auth object (may be signed in or signed out) */
  auth: ClerkAuth;
}

/**
 * Context after isAuthed middleware - userId guaranteed to be string
 * Use this type in protectedProcedure handlers
 */
export interface AuthenticatedContext extends Omit<BaseContext, 'auth'> {
  auth: SignedInAuthObject & { userId: string };
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
  const auth = getAuth(req);

  return {
    logger,
    requestId,
    auth,
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
