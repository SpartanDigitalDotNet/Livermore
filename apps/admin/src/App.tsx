import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import { Dashboard } from './pages/Dashboard';
import { Signals } from './pages/Signals';
import { Logs } from './pages/Logs';

function App() {
  const [hash, setHash] = useState(window.location.hash || '#/');

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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
                <a
                  href="#/"
                  className={`${hash === '#/' || hash === '' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
                >
                  Portfolio
                </a>
                <a
                  href="#/signals"
                  className={`${hash === '#/signals' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
                >
                  Signals
                </a>
                <a
                  href="#/logs"
                  className={`${hash === '#/logs' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
                >
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
            <HashRouter hash={hash} />
          </main>
        </div>
      </SignedIn>
    </>
  );
}

function HashRouter({ hash }: { hash: string }) {
  switch (hash) {
    case '#/signals':
      return <Signals />;
    case '#/logs':
      return <Logs />;
    default:
      return <Dashboard />;
  }
}

export default App;
