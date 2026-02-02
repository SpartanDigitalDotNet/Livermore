import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../../apps/api/src/routers';

/**
 * Token getter function - set by ClerkTokenProvider.
 * This allows us to use Clerk's React hooks which handle
 * token refresh properly, unlike window.Clerk.session.getToken().
 */
let tokenGetter: (() => Promise<string | null>) | null = null;

/**
 * Set the token getter function. Called by ClerkTokenProvider.
 */
export function setTokenGetter(getter: () => Promise<string | null>): void {
  tokenGetter = getter;
}

/**
 * Get Clerk token for authenticated API requests.
 * Uses the token getter set by ClerkTokenProvider (preferred)
 * or falls back to window.Clerk.session.getToken().
 */
const getAuthToken = async (): Promise<string | null> => {
  // Use React hook-based getter if available (handles refresh properly)
  if (tokenGetter) {
    return tokenGetter();
  }
  // Fallback to window.Clerk (may return stale tokens)
  if (typeof window !== 'undefined' && window.Clerk?.session) {
    return window.Clerk.session.getToken();
  }
  return null;
};

/**
 * tRPC vanilla client for direct API calls.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/trpc',
      headers: async () => {
        const token = await getAuthToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

/**
 * QueryClient instance for tRPC options proxy.
 * This is shared with the QueryClientProvider in main.tsx.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * tRPC options proxy for use with TanStack Query.
 * Usage: useQuery(trpc.indicator.getPortfolioAnalysis.queryOptions({ symbols }))
 */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
