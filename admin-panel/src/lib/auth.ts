import { createAuthClient } from '@neondatabase/auth';
import { useSyncExternalStore } from 'react';
import { env } from './env';

export interface User {
  id: string;
  email?: string;
  fullName?: string;
  phone?: string;
}
export interface Profile {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: string;
  isActive: boolean;
}
export interface Session { user: User }
export interface SessionSnapshot { session: Session | null; profile: Profile | null; loading: boolean }

export const authClient = env.neonAuthUrl ? createAuthClient(env.neonAuthUrl) : null;
let snapshot: SessionSnapshot = { session: null, profile: null, loading: Boolean(authClient) };
const listeners = new Set<() => void>();
let started = false;
let revision = 0;
/** True once a check found nobody signed in; cleared whenever a sign-in may have happened. */
let knownSignedOut = false;
function publish(next: SessionSnapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

/**
 * The signed-in user's short-lived Neon Auth JWT, or null. Only the API verifies it and decides permissions.
 * The SDK keeps the JWT on the cached session (`session.token`, refreshed before it expires); `authClient.token()`
 * is answered from that same cache without the token, so it is not used.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!authClient || knownSignedOut) return null; // guests browse without a round trip to the sign-in service
  try {
    const { data } = await authClient.getSession();
    if (!data?.user?.emailVerified) return null;
    const jwt = (data.session as { token?: unknown } | undefined)?.token;
    return typeof jwt === 'string' && jwt.split('.').length === 3 ? jwt : null;
  } catch {
    return null; // public pages keep working; protected calls answer 401
  }
}

function userFrom(id: string, email: string | undefined, profile: Profile | null, fallbackName?: string): User {
  return { id, email, fullName: profile?.fullName ?? fallbackName, phone: profile?.phone };
}

export function setProfile(profile: Profile) {
  if (!snapshot.session) return;
  const { id, email } = snapshot.session.user;
  publish({ ...snapshot, profile, session: { user: userFrom(id, email, profile) } });
}

export async function refreshSession() {
  const current = ++revision;
  if (!authClient) return;
  knownSignedOut = false;
  try {
    const { data, error } = await authClient.getSession();
    if (current !== revision) return;
    if (error) throw error;
    if (!data?.user || !data.user.emailVerified) {
      knownSignedOut = true;
      publish({ session: null, profile: null, loading: false });
      return;
    }
    const user = data.user;
    // Keep what is already known about the same user, so a refresh (e.g. on window focus) never blanks the form.
    let profile = snapshot.session?.user.id === user.id ? snapshot.profile : null;
    // Profile data and the role come from the API, never editable browser claims. Publish once, with the profile.
    if (env.apiBaseUrl) {
      const { apiFetch } = await import('./api');
      try {
        profile = await apiFetch<Profile>('/api/me');
      } catch {
        // The API is unreachable or refused this account; show the user as signed in without a server profile.
      }
      if (current !== revision) return;
    }
    publish({ session: { user: userFrom(user.id, user.email, profile, user.name) }, profile, loading: false });
  } catch {
    // A temporary sign-in service error is not a sign-out: keep the current state.
    if (current === revision) publish({ ...snapshot, loading: false });
  }
}

export async function signOut() {
  if (!authClient) return;
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message || 'Unable to sign out. Please try again.');
  revision++;
  knownSignedOut = true;
  publish({ session: null, profile: null, loading: false });
}

/** Sign out from a button: a failure is shown to the user instead of being lost. */
export function signOutFromButton() {
  signOut().catch((error: unknown) => {
    window.alert(error instanceof Error ? error.message : 'Unable to sign out. Please try again.');
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started && authClient) {
    started = true;
    void refreshSession();
    window.addEventListener('focus', () => { void refreshSession(); });
  }
  return () => { listeners.delete(listener); };
}

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
