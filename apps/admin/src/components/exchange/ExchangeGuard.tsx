import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLivermoreUser } from '../UserSync';
import { trpc } from '../../lib/trpc';
import { ExchangeSetupModal } from './ExchangeSetupModal';

export function ExchangeGuard({ children }: { children: React.ReactNode }) {
  const { user } = useLivermoreUser();
  const [setupComplete, setSetupComplete] = useState(false);

  const { data, isLoading } = useQuery(
    trpc.exchangeSymbol.defaultExchange.queryOptions()
  );

  const needsSetup = !isLoading && data?.exchangeId === null && !setupComplete;

  return (
    <>
      {needsSetup && (
        <ExchangeSetupModal
          open={true}
          onComplete={() => setSetupComplete(true)}
          userName={user?.displayName ?? null}
        />
      )}
      {children}
    </>
  );
}
