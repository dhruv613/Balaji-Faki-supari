import { useSyncExternalStore } from 'react';

/**
 * The Admin Panel's one fixed login. The store's backend checks the email and password (ADMIN_EMAIL / ADMIN_PASSWORD,
 * server-side only) and returns a 12-hour admin session token; every admin API call sends it as a Bearer token.
 * The token is kept for this browser tab only (sessionStorage), so closing the tab signs out.
 */
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

const TOKEN_KEY = 'bfp_admin_session';
let memoryToken: string | null = null;
let snapshot: SessionSnapshot = { session: null, profile: null, loading: true };
const listeners = new Set<() => void>();
let started = false;

function readToken(): string | null {
  if (memoryToken) return memoryToken;
  try { memoryToken = sessionStorage.getItem(TOKEN_KEY); } catch { /* storage blocked: memory only */ }
  return memoryToken;
}
function storeToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: memory only */ }
}
function publish(next: SessionSnapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}
const signedOut: SessionSnapshot = { session: null, profile: null, loading: false };

export async function getAccessToken(): Promise<string | null> {
  return readToken();
}

/** Signs in with the fixed admin email and password; throws the server's message when they are wrong. */
export async function signIn(email: string, password: string) {
  const { apiFetch } = await import('./api');
  const { token } = await apiFetch<{ token: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), password }),
  });
  storeToken(token);
  await refreshSession();
}

export function setProfile(profile: Profile) {
  if (!snapshot.session) return;
  publish({ ...snapshot, profile, session: { user: { id: profile.id, email: profile.email, fullName: profile.fullName, phone: profile.phone } } });
}

export async function refreshSession() {
  if (!readToken()) return publish(signedOut);
  const { apiFetch, ApiError } = await import('./api');
  try {
    const profile = await apiFetch<Profile>('/api/me');
    publish({
      session: { user: { id: profile.id, email: profile.email, fullName: profile.fullName, phone: profile.phone } },
      profile,
      loading: false,
    });
  } catch (error) {
    // An ended session (401/403) signs out; a server or network hiccup keeps the current state for "Try again".
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      storeToken(null);
      publish(signedOut);
    } else {
      publish({ ...snapshot, loading: false });
    }
  }
}

export async function signOut() {
  storeToken(null);
  publish(signedOut);
}

export function signOutFromButton() {
  void signOut();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    void refreshSession();
  }
  return () => { listeners.delete(listener); };
}

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
