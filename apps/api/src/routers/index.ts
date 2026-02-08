import { router } from '@livermore/trpc-config';
import { indicatorRouter } from './indicator.router';
import { alertRouter } from './alert.router';
import { positionRouter } from './position.router';
import { logsRouter } from './logs.router';
import { userRouter } from './user.router';
import { settingsRouter } from './settings.router';
import { symbolRouter } from './symbol.router';
import { controlRouter } from './control.router';
import { exchangeSymbolRouter } from './exchange-symbol.router';

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
  settings: settingsRouter,
  symbol: symbolRouter,
  control: controlRouter,
  exchangeSymbol: exchangeSymbolRouter,
});

export type AppRouter = typeof appRouter;

// Re-export sub-routers for type inference
export { indicatorRouter } from './indicator.router';
export { alertRouter } from './alert.router';
export { positionRouter } from './position.router';
export { logsRouter } from './logs.router';
export { userRouter } from './user.router';
export { settingsRouter } from './settings.router';
export { symbolRouter } from './symbol.router';
export { controlRouter } from './control.router';
export { exchangeSymbolRouter } from './exchange-symbol.router';
