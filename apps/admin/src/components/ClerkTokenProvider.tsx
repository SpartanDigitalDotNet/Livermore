import { useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setTokenGetter } from '@/lib/trpc';

/**
 * ClerkTokenProvider
 *
 * Connects Clerk's useAuth hook to the tRPC client.
 * The useAuth().getToken() method properly handles token refresh,
 * unlike window.Clerk.session.getToken() which can return stale tokens.
 *
 * Must be rendered inside ClerkProvider.
 */
export function ClerkTokenProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  // Memoize the token getter to avoid unnecessary updates
  const tokenGetter = useCallback(async () => {
    return getToken();
  }, [getToken]);

  // Register the token getter with tRPC client
  useEffect(() => {
    setTokenGetter(tokenGetter);
  }, [tokenGetter]);

  return <>{children}</>;
}
