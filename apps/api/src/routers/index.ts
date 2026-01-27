import { router } from '@livermore/trpc-config';
import { indicatorRouter } from './indicator.router';
import { alertRouter } from './alert.router';
import { positionRouter } from './position.router';
import { logsRouter } from './logs.router';
import { userRouter } from './user.router';

/**
 * Main application router
 *
 * Combines all sub-routers into a single tRPC router.
 */
export const appRouter = router({
  indicator: indicatorRouter,
  alert: alertRouter,
  position: positionRouter,
  logs: logsRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

// Re-export sub-routers for type inference
export { indicatorRouter } from './indicator.router';
export { alertRouter } from './alert.router';
export { positionRouter } from './position.router';
export { logsRouter } from './logs.router';
export { userRouter } from './user.router';
