import { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { useUser } from '@clerk/clerk-react';
import { trpcClient } from '../lib/trpc';
import chartBackground from '../assets/chart-background.svg';

/**
 * User context type - the synced Livermore user record
 */
interface LivermoreUser {
  id: number;
  username: string;
  email: string;
  displayName: string | null;
  role: string;
  identityProvider: string | null;
  identitySub: string | null;
}

interface UserContextType {
  user: LivermoreUser | null;
  isLoading: boolean;
  error: string | null;
}

const UserContext = createContext<UserContextType>({
  user: null,
  isLoading: true,
  error: null,
});

/**
 * Hook to access the synced Livermore user
 */
export function useLivermoreUser() {
  return useContext(UserContext);
}

/**
 * Check if an error is a network/connection error (API offline)
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('failed to fetch') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('connection refused') ||
      message.includes('timeout')
    );
  }
  return false;
}

/**
 * UserSync component - syncs Clerk user to Livermore database on sign-in
 *
 * This ensures users are onboarded seamlessly during Admin login.
 * Wraps children and provides the Livermore user via context.
 */
export function UserSync({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
  const [livermoreUser, setLivermoreUser] = useState<LivermoreUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isApiOffline, setIsApiOffline] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const syncedRef = useRef(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const syncUser = useCallback(async () => {
    if (!clerkUser) return;

    try {
      const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress;
      if (!primaryEmail) {
        throw new Error('No email address found for user');
      }

      const result = await trpcClient.user.syncFromClerk.mutate({
        clerkId: clerkUser.id,
        email: primaryEmail,
        displayName: clerkUser.fullName || undefined,
        pictureUrl: clerkUser.imageUrl || undefined,
      });

      setLivermoreUser(result);
      setError(null);
      setIsApiOffline(false);
      console.log('[UserSync] User synced:', result.id, result.email);
    } catch (err) {
      if (isNetworkError(err)) {
        setIsApiOffline(true);
        setError(null);
        console.log('[UserSync] API offline, will retry...');
        // Schedule retry
        retryTimeoutRef.current = setTimeout(() => {
          setRetryCount((c) => c + 1);
        }, 3000);
      } else {
        const message = err instanceof Error ? err.message : 'Failed to sync user';
        setError(message);
        setIsApiOffline(false);
        console.error('[UserSync] Error syncing user:', message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [clerkUser]);

  useEffect(() => {
    // Wait for Clerk to load
    if (!clerkLoaded) return;

    // No user signed in
    if (!clerkUser) {
      setIsLoading(false);
      return;
    }

    // Prevent double sync in React strict mode (only on initial mount)
    if (syncedRef.current && retryCount === 0) return;
    syncedRef.current = true;

    syncUser();

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [clerkUser, clerkLoaded, retryCount, syncUser]);

  // Show loading state while syncing
  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          backgroundImage: `url(${chartBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="text-center max-w-md mx-auto p-8 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-300/50 dark:border-gray-700/50 shadow-2xl">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-3 border-gray-300 dark:border-gray-600 border-t-blue-500 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-300">Setting up your account...</p>
        </div>
      </div>
    );
  }

  // Show waiting state when API is offline
  if (isApiOffline) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          backgroundImage: `url(${chartBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="text-center max-w-md mx-auto p-8 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-300/50 dark:border-gray-700/50 shadow-2xl">
          {/* Pulsing ring animation */}
          <div className="relative mx-auto mb-6 w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-amber-500/30 animate-ping"></div>
            <div className="absolute inset-2 rounded-full border-2 border-amber-500/50 animate-pulse"></div>
            <div className="absolute inset-4 rounded-full bg-amber-500/20 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-amber-500 animate-pulse"></div>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-amber-600 dark:text-amber-400 mb-3">Waiting for API</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-2">The API server is starting up...</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm">Retrying automatically ({retryCount} attempts)</p>
          {/* Subtle progress indicator */}
          <div className="mt-6 flex justify-center gap-1">
            <div className="w-2 h-2 rounded-full bg-amber-500/60 animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-amber-500/60 animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-amber-500/60 animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state if sync failed (non-network error)
  if (error) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          backgroundImage: `url(${chartBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="text-center max-w-md mx-auto p-8 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl border border-red-300/50 dark:border-red-900/50 shadow-2xl">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Account Setup Error</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ user: livermoreUser, isLoading, error }}>
      {children}
    </UserContext.Provider>
  );
}
