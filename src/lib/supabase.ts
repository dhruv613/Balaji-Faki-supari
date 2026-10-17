/**
 * Supabase client & Simple Database-Backed Authentication (browser-side).
 *
 * Login behavior:
 * - Checks `public.user_profiles` via RPC `public.simple_auth_login(p_email, p_password)`:
 *   - If email is NOT in Database -> creates account in DB and logs in immediately (no email confirmation).
 *   - If email IS in Database -> verifies password and logs in immediately.
 * - Updates customer profile details (`fullName`, `phone`) directly in `public.user_profiles`
 *   and `public.customers` via RPC `public.simple_auth_update_profile`.
 */

import { createClient, type Session, type User } from '@supabase/supabase-js';
import { env } from './env';
import { useEffect, useState } from 'react';

const SESSION_STORAGE_KEY = 'bfp-simple-db-session-v2';

interface SimpleDbUserPayload {
  id: string;
  email: string;
  fullName?: string;
  phone?: string;
  role?: 'CUSTOMER' | 'OWNER_ADMIN';
  isActive?: boolean;
}

interface SimpleDbLoginResult {
  action: 'CREATED' | 'LOGGED_IN';
  user: SimpleDbUserPayload;
}

/**
 * Clean, unmutated Supabase client for PostgREST RPC & table calls.
 * Keeping `rawSupabase` separate from our custom `auth` facade ensures
 * PostgREST never receives a synthetic non-JWT `Authorization: Bearer` header.
 */
const rawSupabase = (() => {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  try {
    return createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    return null;
  }
})();

type AuthListener = (event: string, session: Session | null) => void;
const listeners = new Set<AuthListener>();

function buildSessionFromDbUser(dbUser: SimpleDbUserPayload): Session {
  const nowSec = Math.floor(Date.now() / 1000);
  const user: User = {
    id: dbUser.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: dbUser.email,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: {
      provider: 'email',
      role: dbUser.role ?? 'CUSTOMER',
    },
    user_metadata: {
      fullName: dbUser.fullName ?? '',
      phone: dbUser.phone ?? '',
      role: dbUser.role ?? 'CUSTOMER',
    },
    identities: [],
    created_at: new Date().toISOString(),
  };

  return {
    access_token: env.supabaseAnonKey || `bfp-session-${dbUser.id}`,
    refresh_token: `bfp-refresh-${dbUser.id}`,
    expires_in: 60 * 60 * 24 * 30,
    expires_at: nowSec + 60 * 60 * 24 * 30,
    token_type: 'bearer',
    user,
  };
}

function readStoredSession(): Session | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    // Clean up old v1 key that stored a non-JWT access_token
    window.localStorage.removeItem('bfp-simple-db-session-v1');
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.user?.id || !parsed?.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: Session | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!session) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota errors
  }
}

let currentSession: Session | null = readStoredSession();

function notifyListeners(event: string, session: Session | null): void {
  currentSession = session;
  writeStoredSession(session);
  for (const listener of listeners) {
    listener(event, session);
  }
}

async function authenticateWithDatabase(credentials: {
  email: string;
  password: string;
}): Promise<{
  data: { session: Session | null; user: User | null; action?: 'CREATED' | 'LOGGED_IN' };
  error: Error | null;
}> {
  if (!rawSupabase) {
    return {
      data: { session: null, user: null },
      error: new Error('Database connection is not configured.'),
    };
  }

  const cleanEmail = credentials.email.trim().toLowerCase();
  const { data, error } = await rawSupabase.rpc('simple_auth_login', {
    p_email: cleanEmail,
    p_password: credentials.password,
  });

  if (error) {
    return {
      data: { session: null, user: null },
      error: new Error(error.message || 'Invalid login credentials'),
    };
  }

  const result = data as unknown as SimpleDbLoginResult;
  if (!result?.user?.id) {
    return {
      data: { session: null, user: null },
      error: new Error('Unexpected response from database login.'),
    };
  }

  const session = buildSessionFromDbUser(result.user);
  notifyListeners('SIGNED_IN', session);

  return {
    data: {
      session,
      user: session.user,
      action: result.action,
    },
    error: null,
  };
}

export const supabase = rawSupabase
  ? {
      from: rawSupabase.from.bind(rawSupabase),
      rpc: rawSupabase.rpc.bind(rawSupabase),
      storage: rawSupabase.storage,
      auth: {
        async getSession() {
          return { data: { session: currentSession }, error: null };
        },
        async signInWithPassword(credentials: { email: string; password: string }) {
          return authenticateWithDatabase(credentials);
        },
        async signUp(credentials: { email: string; password: string }) {
          return authenticateWithDatabase(credentials);
        },
        async updateUser(attributes: {
          password?: string;
          data?: { fullName?: string; phone?: string; [key: string]: unknown };
        }): Promise<{ data: { user: User | null }; error: Error | null }> {
          if (!currentSession) {
            return { data: { user: null }, error: new Error('Not signed in.') };
          }
          const fullName =
            typeof attributes.data?.fullName === 'string'
              ? attributes.data.fullName
              : (currentSession.user.user_metadata?.fullName as string | undefined) ?? '';
          const phone =
            typeof attributes.data?.phone === 'string'
              ? attributes.data.phone
              : (currentSession.user.user_metadata?.phone as string | undefined) ?? '';

          const { data, error } = await rawSupabase.rpc('simple_auth_update_profile', {
            p_user_id: currentSession.user.id,
            p_full_name: fullName,
            p_phone: phone,
          });

          if (error) {
            return {
              data: { user: null },
              error: new Error(error.message || 'Unable to save your details.'),
            };
          }

          const updatedUser = data as unknown as SimpleDbUserPayload;
          const nextSession = buildSessionFromDbUser({
            id: currentSession.user.id,
            email: currentSession.user.email ?? updatedUser?.email ?? '',
            fullName: updatedUser?.fullName ?? fullName,
            phone: updatedUser?.phone ?? phone,
            role:
              updatedUser?.role ??
              (currentSession.user.app_metadata?.role as 'CUSTOMER' | 'OWNER_ADMIN') ??
              'CUSTOMER',
          });
          notifyListeners('USER_UPDATED', nextSession);
          return { data: { user: nextSession.user }, error: null };
        },
        async signOut(): Promise<{ error: Error | null }> {
          notifyListeners('SIGNED_OUT', null);
          return { error: null };
        },
        onAuthStateChange(callback: (event: string, session: Session | null) => void) {
          listeners.add(callback);
          queueMicrotask(() => {
            if (listeners.has(callback)) {
              callback('INITIAL_SESSION', currentSession);
            }
          });
          return {
            data: {
              subscription: {
                unsubscribe() {
                  listeners.delete(callback);
                },
              },
            },
          };
        },
      },
    }
  : null;

export function useSession() {
  const [session, setSession] = useState<Session | null>(() => currentSession);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!supabase) return;
    setSession(currentSession);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
