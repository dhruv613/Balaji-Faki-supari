import { Navigate, useSearchParams } from 'react-router-dom';
import EmailSignIn from '../../../components/common/EmailSignIn';
import { safeNextPath } from '../../../lib/navigation';
import { useSession } from '../../../lib/supabase';

/** Explicit Sign in / Create account. A signed-in visitor continues to `?next=` (default: Home). */
export default function LoginPage() {
  const { session, loading } = useSession();
  const [params] = useSearchParams();
  if (!loading && session) return <Navigate to={safeNextPath(params.get('next'))} replace />;
  return (
    <div className="wrapper">
      {loading
        ? <p role="status">Checking your sign-in…</p>
        : <EmailSignIn initialMode={params.get('mode') === 'register' ? 'register' : 'signin'} />}
    </div>
  );
}
