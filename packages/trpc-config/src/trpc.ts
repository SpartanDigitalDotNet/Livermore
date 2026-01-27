import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import type { Context, AuthenticatedContext } from './context';

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
 * Auth middleware - checks if user is authenticated
 * Narrows ctx.auth.userId from string | null to string
 */
const isAuthed = t.middleware(async function isAuthed(opts) {
  const { ctx } = opts;

  if (!ctx.auth.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be signed in to access this resource',
    });
  }

  // Return narrowed context with guaranteed userId
  return opts.next({
    ctx: {
      ...ctx,
      auth: {
        ...ctx.auth,
        userId: ctx.auth.userId,
      },
    } as AuthenticatedContext,
  });
});

/**
 * Export router and procedure helpers
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);
export const middleware = t.middleware;

/**
 * Reusable middleware can be defined here
 * For example, authenticated procedures, rate limiting, etc.
 */

/**
 * Logging middleware
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
