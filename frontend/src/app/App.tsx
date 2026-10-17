import { AppRouter } from './router';
import { OrderProvider } from '../context/OrderContext';
import AuthGate from '../components/common/AuthGate';

/**
 * Root Application shell.
 * Enforces authentication + profile completion (`AuthGate`),
 * scopes checkout draft state to the signed-in user (`OrderProvider`),
 * and mounts customer & admin routes (`AppRouter`).
 */
export default function App() {
  return (
    <AuthGate>
      {(user) => (
        <OrderProvider key={user.id} user={user}>
          <AppRouter />
        </OrderProvider>
      )}
    </AuthGate>
  );
}
