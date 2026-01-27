import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';

function App() {
  return (
    <>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center bg-gray-100">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <div className="min-h-screen bg-gray-100">
          <header className="bg-white shadow">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
              <h1 className="text-xl font-bold text-gray-900">Livermore Admin</h1>
              <nav className="flex items-center gap-6">
                <a href="#/" className="text-gray-600 hover:text-gray-900">
                  Portfolio
                </a>
                <a href="#/signals" className="text-gray-600 hover:text-gray-900">
                  Signals
                </a>
                <a href="#/logs" className="text-gray-600 hover:text-gray-900">
                  Logs
                </a>
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: {
                      avatarBox: 'h-8 w-8',
                    },
                  }}
                />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8">
            <HashRouter />
          </main>
        </div>
      </SignedIn>
    </>
  );
}

/**
 * Simple hash-based router for SPA.
 * No external router library needed for 3 pages.
 */
function HashRouter() {
  // Use window.location.hash for routing
  const hash = typeof window !== 'undefined' ? window.location.hash : '#/';

  // Placeholder pages - will be replaced in 15-02
  switch (hash) {
    case '#/signals':
      return (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold">Trade Signals</h2>
          <p className="mt-2 text-gray-600">Coming soon...</p>
        </div>
      );
    case '#/logs':
      return (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold">Logs</h2>
          <p className="mt-2 text-gray-600">Coming soon...</p>
        </div>
      );
    default:
      return (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold">Portfolio Analysis</h2>
          <p className="mt-2 text-gray-600">Coming soon...</p>
        </div>
      );
  }
}

export default App;
