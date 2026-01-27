import { useEffect, useRef, useState, createContext, useContext } from 'react';
import { useUser } from '@clerk/clerk-react';
import { trpcClient } from '../lib/trpc';

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
  const syncedRef = useRef(false);

  useEffect(() => {
    // Wait for Clerk to load
    if (!clerkLoaded) return;

    // No user signed in
    if (!clerkUser) {
      setIsLoading(false);
      return;
    }

    // Prevent double sync in React strict mode
    if (syncedRef.current) return;
    syncedRef.current = true;

    const syncUser = async () => {
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
        console.log('[UserSync] User synced:', result.id, result.email);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to sync user';
        setError(message);
        console.error('[UserSync] Error syncing user:', message);
      } finally {
        setIsLoading(false);
      }
    };

    syncUser();
  }, [clerkUser, clerkLoaded]);

  // Show loading state while syncing
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600 mx-auto"></div>
          <p className="text-gray-600">Setting up your account...</p>
        </div>
      </div>
    );
  }

  // Show error state if sync failed
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="text-center max-w-md mx-auto p-6 bg-white rounded-lg shadow">
          <h2 className="text-lg font-semibold text-red-600 mb-2">Account Setup Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
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
