import { AppRouter } from './router';
import { OrderProvider } from '../context/OrderContext';
import { useSession } from '../lib/supabase';

/**
 * Root Application shell.
 * Browsing is public. `OrderProvider` scopes the checkout draft to the signed-in account (or to a guest draft that
 * moves into the account at sign-in); protected pages ask for sign-in themselves, in place.
 */
export default function App() {
  const { session } = useSession();
  const user = session?.user ?? null;
  return (
    <OrderProvider key={user?.id ?? 'guest'} user={user}>
      <AppRouter />
    </OrderProvider>
  );
}
