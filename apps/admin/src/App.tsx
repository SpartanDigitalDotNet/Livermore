import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import { Dashboard } from './pages/Dashboard';
import { Signals } from './pages/Signals';
import { Logs } from './pages/Logs';
import { ControlPanel } from './pages/ControlPanel';
import { Symbols } from './pages/Symbols';
import { ExchangeSymbols } from './pages/ExchangeSymbols';
import { Settings } from './pages/Settings';
import { UserSync } from './components/UserSync';
import { Toaster } from '@/components/ui/sonner';
import { AlertProvider } from '@/contexts/AlertContext';
import { AlertToastHandler } from '@/components/AlertToastHandler';

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
        <UserSync>
          <AlertProvider currentHash={hash}>
            <AlertToastHandler />
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
                  <a
                    href="#/control"
                    className={`${hash === '#/control' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
                  >
                    Control
                  </a>
                  <a
                    href="#/symbols"
                    className={`${hash === '#/symbols' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
                  >
                    Symbols
                  </a>
                  <a
                    href="#/exchange-symbols"
                    className={`${hash === '#/exchange-symbols' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
                  >
                    Exchange Symbols
                  </a>
                  <a
                    href="#/settings"
                    className={`${hash === '#/settings' ? 'text-gray-900 font-medium' : 'text-gray-600'} hover:text-gray-900`}
                  >
                    Settings
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
          </AlertProvider>
        </UserSync>
        <Toaster />
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
    case '#/control':
      return <ControlPanel />;
    case '#/symbols':
      return <Symbols />;
    case '#/exchange-symbols':
      return <ExchangeSymbols />;
    case '#/settings':
      return <Settings />;
    default:
      return <Dashboard />;
  }
}

export default App;
