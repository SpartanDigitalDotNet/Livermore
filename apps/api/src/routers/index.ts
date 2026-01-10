import { router } from '@livermore/trpc-config';
import { indicatorRouter } from './indicator.router';
import { alertRouter } from './alert.router';

/**
 * Main application router
 *
 * Combines all sub-routers into a single tRPC router.
 */
export const appRouter = router({
  indicator: indicatorRouter,
  alert: alertRouter,
});

export type AppRouter = typeof appRouter;

// Re-export sub-routers for type inference
export { indicatorRouter } from './indicator.router';
export { alertRouter } from './alert.router';
