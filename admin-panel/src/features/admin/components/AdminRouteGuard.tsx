import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession, authClient, signOutFromButton } from '../../../lib/auth';
import { env } from '../../../lib/env';
import EmailSignIn from '../../../components/common/EmailSignIn';
import StoreLink from './StoreLink';
import Notice from '../../../components/common/Notice';
import { getAdminMe } from '../api';

export type AdminAccessStatus = 'AUTHORIZED_ADMIN' | 'DENIED_CUSTOMER' | 'DENIED_UNAUTHENTICATED' | 'DENIED_UNVERIFIED';

/**
 * Decides whether the admin UI may open. The ONLY source of truth is the server: FastAPI `GET /api/me` must have
 * answered successfully with `OWNER_ADMIN`. Claims held in the browser never unlock the UI,
 * and a failed or missing server check keeps it locked. (Every admin API call is enforced again on the server.)
 */
export function evaluateAdminRouteAccess(params: {
  user: { id: string; email?: string } | null;
  /** Role returned by `GET /api/me`; null when the call failed or was not made. */
  serverRole?: string | null;
  apiConnected: boolean;
}): { allowed: boolean; status: AdminAccessStatus; reason?: string } {
  const { user, serverRole, apiConnected } = params;

  if (!user) {
    return {
      allowed: false,
      status: 'DENIED_UNAUTHENTICATED',
      reason: 'Sign in with an authorized Owner Admin account to access the Admin Panel.',
    };
  }
  if (!apiConnected) {
    return {
      allowed: false,
      status: 'DENIED_UNVERIFIED',
      reason: 'The Admin Panel needs the Balaji Faki Point server to verify your role. It is not connected.',
    };
  }
  if (serverRole === 'OWNER_ADMIN') return { allowed: true, status: 'AUTHORIZED_ADMIN' };
  if (!serverRole) {
    return {
      allowed: false,
      status: 'DENIED_UNVERIFIED',
      reason: 'The server could not verify your role right now. Check that it is running and try again.',
    };
  }
  return {
    allowed: false,
    status: 'DENIED_CUSTOMER',
    reason: 'Your account does not have Owner Admin permissions verified by the server.',
  };
}

export default function AdminRouteGuard({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useSession();
  const [serverRole, setServerRole] = useState<string | null>(null);
  const [checkingRole, setCheckingRole] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setServerRole(null);
    if (!session || !env.apiBaseUrl) {
      setCheckingRole(false);
      return;
    }
    setCheckingRole(true);
    getAdminMe()
      .then((profile) => { if (active) setServerRole(profile.isActive === false ? 'CUSTOMER' : profile.role); })
      .catch(() => { if (active) setServerRole(null); })
      .finally(() => { if (active) setCheckingRole(false); });
    return () => { active = false; };
  }, [session?.user.id, attempt]);

  if (authLoading || checkingRole) {
    return (
      <main className="auth-page" role="status">
        <img className="auth-logo" src="/images/balaji-logo.png" width="140" height="72" alt="Balaji Faki Point" />
        <p>Verifying Owner Admin authorization…</p>
      </main>
    );
  }

  const check = evaluateAdminRouteAccess({
    user: session?.user ?? null,
    serverRole,
    apiConnected: Boolean(env.apiBaseUrl),
  });
  if (check.allowed) return <>{children}</>;

  return (
    <main className="auth-page">
      <img className="auth-logo" src="/images/balaji-logo.png" width="140" height="72" alt="Balaji Faki Point" />
      <section className="card card--tinted auth-card" aria-labelledby="admin-denied-heading">
        <span className="badge badge--orange">Admin Console</span>
        <h1 id="admin-denied-heading" style={{ marginTop: 8 }}>
          {session ? 'Owner Admin Access Only' : 'Admin Sign In'}
        </h1>
        <p className="text-secondary">{check.reason}</p>

        {!session ? (
          <EmailSignIn signInOnly />
        ) : (
          <>
            <div className="card" style={{ padding: 12, margin: '12px 0', background: '#fff', border: '1px solid var(--border)' }}>
              <div className="text-small text-secondary">Currently signed in as</div>
              <div style={{ fontWeight: 700 }}>{session.user.email}</div>
            </div>
            {check.status === 'DENIED_UNVERIFIED' ? (
              <button type="button" className="btn btn--primary btn--full" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            ) : (
              <Notice tone="warning" title="Owner Admin role required">
                The shop owner&apos;s account is promoted on the server by an administrator. Customer accounts cannot open this area.
              </Notice>
            )}
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {authClient && session && (
            <button type="button" className="btn btn--full" onClick={signOutFromButton}>
              Log out &amp; sign in with the Admin account
            </button>
          )}
          <StoreLink className="btn btn--outline btn--full">
            ← Return to Customer Store
          </StoreLink>
        </div>
      </section>
    </main>
  );
}
