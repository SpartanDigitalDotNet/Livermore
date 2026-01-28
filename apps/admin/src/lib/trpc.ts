import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../../../apps/api/src/routers';

/**
 * Get Clerk token for authenticated API requests.
 * Clerk exposes session on window after ClerkProvider initializes.
 */
const getAuthToken = async (): Promise<string | null> => {
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
