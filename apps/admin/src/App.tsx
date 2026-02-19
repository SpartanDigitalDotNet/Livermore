import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import { Sun, Moon } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { Signals } from './pages/Signals';
import { Logs } from './pages/Logs';
import { ControlPanel } from './pages/ControlPanel';
import { Network } from './pages/Network';
import { Symbols } from './pages/Symbols';
import { ExchangeSymbols } from './pages/ExchangeSymbols';
import { Settings } from './pages/Settings';
import { UserSync } from './components/UserSync';
import { ExchangeGuard } from './components/exchange/ExchangeGuard';
import { Toaster } from '@/components/ui/sonner';
import { AlertProvider } from '@/contexts/AlertContext';
import { AlertToastHandler } from '@/components/AlertToastHandler';

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return [dark, () => setDark((d) => !d)] as const;
}

function App() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  const [dark, toggleTheme] = useTheme();

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-950">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <UserSync>
          <ExchangeGuard>
          <AlertProvider currentHash={hash}>
            <AlertToastHandler />
            <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
              <header className="bg-white shadow dark:bg-gray-900 dark:shadow-gray-950">
              <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Livermore Admin</h1>
                <nav className="flex items-center gap-6">
                  <a
                    href="#/"
                    className={`${hash === '#/' || hash === '' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Portfolio
                  </a>
                  <a
                    href="#/signals"
                    className={`${hash === '#/signals' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Signals
                  </a>
                  <a
                    href="#/logs"
                    className={`${hash === '#/logs' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Logs
                  </a>
                  <a
                    href="#/control"
                    className={`${hash === '#/control' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Control
                  </a>
                  <a
                    href="#/network"
                    className={`${hash === '#/network' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Network
                  </a>
                  <a
                    href="#/symbols"
                    className={`${hash === '#/symbols' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Symbols
                  </a>
                  <a
                    href="#/exchange-symbols"
                    className={`${hash === '#/exchange-symbols' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Exchange Symbols
                  </a>
                  <a
                    href="#/settings"
                    className={`${hash === '#/settings' ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'} hover:text-gray-900 dark:hover:text-gray-100`}
                  >
                    Settings
                  </a>
                  <button
                    onClick={toggleTheme}
                    className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </button>
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
          </ExchangeGuard>
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
    case '#/network':
      return <Network />;
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
