import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { OrderProvider } from '../../context/OrderContext';

interface AppProvidersProps {
  user: User;
  children: ReactNode;
}

export function AppProviders({ user, children }: AppProvidersProps) {
  return (
    <OrderProvider key={user.id} user={user}>
      {children}
    </OrderProvider>
  );
}
