import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession, supabase } from '../../../lib/supabase';
import { env } from '../../../lib/env';
import Notice from '../../../components/common/Notice';
import { getAdminMe } from '../api';
import { isAuthorizedOwnerAdmin } from '../lib/orderStateMachine';

/**
 * Evaluates whether a given session user and optional `/api/me` response
 * are permitted to access `/admin/*` routes.
 */
export function evaluateAdminRouteAccess(params: {
  user: {
    id: string;
    email?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  } | null;
  serverRole?: string | null;
  apiConnected: boolean;
  devPreviewAcknowledged?: boolean;
}): {
  allowed: boolean;
  status: 'AUTHORIZED_ADMIN' | 'DEV_REFERENCE_PREVIEW' | 'DENIED_CUSTOMER' | 'DENIED_UNAUTHENTICATED';
  reason?: string;
} {
  const { user, serverRole, apiConnected, devPreviewAcknowledged = false } = params;

  if (!user) {
    return {
      allowed: false,
      status: 'DENIED_UNAUTHENTICATED',
      reason: 'Sign in with an authorized Owner Admin account to access the Admin Panel.',
    };
  }

  const appRole = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null;
  const userMetaRole = typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : null;

  // Explicit customer accounts are ALWAYS blocked from admin routes
  if (
    serverRole === 'CUSTOMER' ||
    appRole === 'CUSTOMER' ||
    userMetaRole === 'CUSTOMER'
  ) {
    return {
      allowed: false,
      status: 'DENIED_CUSTOMER',
      reason: 'Customer accounts are not authorized to access Balaji Faki Point administration.',
    };
  }

  // Verified Owner Admin via FastAPI /api/me or trusted Supabase app_metadata
  if (isAuthorizedOwnerAdmin({ role: serverRole, appMetadataRole: appRole })) {
    return {
      allowed: true,
      status: 'AUTHORIZED_ADMIN',
    };
  }

  // When FastAPI is connected, server verification of OWNER_ADMIN is mandatory
  if (apiConnected) {
    return {
      allowed: false,
      status: 'DENIED_CUSTOMER',
      reason: 'Your account does not have Owner Admin permissions verified by the server.',
    };
  }

  // When FastAPI is not connected yet, allow read-only design preview only if not a CUSTOMER role
  if (devPreviewAcknowledged) {
    return {
      allowed: true,
      status: 'DEV_REFERENCE_PREVIEW',
    };
  }

  return {
    allowed: false,
    status: 'DENIED_CUSTOMER',
    reason: 'Owner Admin role verification (/api/me) is required to unlock administrative routes.',
  };
}

export default function AdminRouteGuard({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useSession();
  const [serverRole, setServerRole] = useState<string | null>(null);
  const [checkingRole, setCheckingRole] = useState(Boolean(env.apiBaseUrl));
  const [devPreviewAck, setDevPreviewAck] = useState(!env.apiBaseUrl);

  // Inline Admin Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    let active = true;
    if (!session || !env.apiBaseUrl) {
      setCheckingRole(false);
      return;
    }
    setCheckingRole(true);
    getAdminMe()
      .then((profile) => {
        if (active) setServerRole(profile.role);
      })
      .catch(() => {
        if (active) setServerRole(null);
      })
      .finally(() => {
        if (active) setCheckingRole(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  async function handleAdminSignIn(e: FormEvent) {
    e.preventDefault();
    if (!supabase || loginBusy) return;
    setLoginError('');
    setLoginBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoginBusy(false);
    }
  }

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
    devPreviewAcknowledged: devPreviewAck,
  });

  if (!check.allowed) {
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
            <form onSubmit={handleAdminSignIn} style={{ marginTop: 12 }}>
              {loginError && <Notice tone="error">{loginError}</Notice>}
              <label htmlFor="admin-login-email">Admin email address</label>
              <input
                className="input"
                id="admin-login-email"
                type="email"
                autoComplete="username"
                placeholder="dp334218@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loginBusy}
              />
              <label htmlFor="admin-login-password">Password</label>
              <input
                className="input"
                id="admin-login-password"
                type="password"
                autoComplete="current-password"
                minLength={4}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loginBusy}
              />
              <button
                type="submit"
                className="btn btn--primary btn--full"
                disabled={!supabase || loginBusy}
                style={{ marginTop: 12 }}
              >
                {loginBusy ? 'Signing in…' : 'Sign in to Admin Panel'}
              </button>
            </form>
          ) : (
            <>
              <div
                className="card"
                style={{
                  padding: 12,
                  marginTop: 12,
                  marginBottom: 12,
                  background: '#fff',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="text-small text-secondary">Currently signed in as</div>
                <div style={{ fontWeight: 700 }}>{session.user.email}</div>
                <div className="text-small text-secondary">
                  Role: <code>{String(session.user.app_metadata?.role ?? 'CUSTOMER')}</code>
                </div>
              </div>
              <Notice tone="warning" title="Owner Admin Role Required">
                To grant this account Owner Admin permissions, set <code>role = &apos;OWNER_ADMIN&apos;</code> in <code>public.user_profiles</code>, then sign out and sign back in.
              </Notice>
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {supabase && session && (
              <button
                type="button"
                className="btn btn--primary btn--full"
                onClick={() => supabase?.auth.signOut()}
              >
                Log out &amp; sign in with Admin account
              </button>
            )}
            <Link to="/" className="btn btn--outline btn--full">
              ← Return to Customer Store
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
