import { initTRPC } from '@trpc/server';
import { ZodError } from 'zod';
import type { Context } from './context';

/**
 * Initialize tRPC with context type
 */
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError
            ? error.cause.flatten()
            : null,
      },
    };
  },
});

/**
 * Export router and procedure helpers
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Reusable middleware can be defined here
 * For example, authenticated procedures, rate limiting, etc.
 */

/**
 * Example: Logging middleware
 * Logs the start and end of each procedure call
 */
export const loggingMiddleware = middleware(async ({ ctx, path, type, next }) => {
  const start = Date.now();
  ctx.logger.debug({ path, type }, 'tRPC procedure started');

  const result = await next();

  const duration = Date.now() - start;
  ctx.logger.debug({ path, type, duration }, 'tRPC procedure completed');

  return result;
});

/**
 * Procedure with logging enabled
 */
export const loggedProcedure = publicProcedure.use(loggingMiddleware);
