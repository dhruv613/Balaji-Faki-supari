/**
 * Supabase client & genuine Supabase Auth JWT session management (browser-side).
 *
 * Security invariants:
 * - Uses genuine Supabase Auth (`signInWithPassword`, `signUp`, `updateUser`, `signOut`, `getSession`).
 * - Never fabricates synthetic browser sessions or substitutes the public `anon` key as a user `access_token`.
 * - Purges legacy `bfp-simple-db-session-*` entries from `localStorage` on startup and sign-out.
 * - Verifies that active sessions carry a valid 3-part user JWT (`sub === user.id`, non-`anon` role).
 */

import { createClient, type Session, type User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { env } from './env';

export const LEGACY_SYNTHETIC_SESSION_KEYS = [
  'bfp-simple-db-session-v1',
  'bfp-simple-db-session-v2',
] as const;

export function purgeLegacySyntheticSessions(
  storage: Pick<Storage, 'removeItem'> | null = typeof window !== 'undefined' && window.localStorage
    ? window.localStorage
    : null,
): void {
  if (!storage) return;
  for (const key of LEGACY_SYNTHETIC_SESSION_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage access errors in restricted environments
    }
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const g = globalThis as {
      atob?: (data: string) => string;
      Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } };
    };
    const json =
      typeof g.atob === 'function'
        ? g.atob(padded)
        : g.Buffer
          ? g.Buffer.from(padded, 'base64').toString('utf8')
          : '';
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Verifies that a session contains a genuine signed Supabase Auth user JWT
 * rather than a synthetic session token or the public `anon` API key.
 */
export function isGenuineSupabaseUserSession(
  session: Session | null | undefined,
): session is Session {
  if (!session || typeof session !== 'object') return false;
  if (!session.user || typeof session.user.id !== 'string' || !session.user.id.trim()) return false;
  if (typeof session.access_token !== 'string' || !session.access_token.trim()) return false;
  if (env.supabaseAnonKey && session.access_token === env.supabaseAnonKey) return false;
  if (session.access_token.startsWith('bfp-session-')) return false;

  const payload = decodeJwtPayload(session.access_token);
  if (!payload) return false;

  // Genuine Supabase Auth user JWTs must carry `sub` matching `session.user.id` and `role === 'authenticated'`
  if (typeof payload.sub !== 'string' || payload.sub !== session.user.id) return false;
  if (payload.role === 'anon' || payload.role === 'service_role') return false;
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false;

  return true;
}

purgeLegacySyntheticSessions();

const rawSupabase = (() => {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  try {
    return createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch {
    return null;
  }
})();

export const supabase = rawSupabase
  ? {
      from: rawSupabase.from.bind(rawSupabase),
      rpc: rawSupabase.rpc.bind(rawSupabase),
      storage: rawSupabase.storage,
      auth: {
        async getSession(): Promise<{ data: { session: Session | null }; error: Error | null }> {
          purgeLegacySyntheticSessions();
          const { data, error } = await rawSupabase.auth.getSession();
          if (error) {
            return { data: { session: null }, error };
          }
          if (data.session && !isGenuineSupabaseUserSession(data.session)) {
            await rawSupabase.auth.signOut().catch(() => {});
            return { data: { session: null }, error: null };
          }
          return { data: { session: data.session }, error: null };
        },
        async signInWithPassword(credentials: { email: string; password: string }) {
          purgeLegacySyntheticSessions();
          return rawSupabase.auth.signInWithPassword({
            email: credentials.email.trim().toLowerCase(),
            password: credentials.password,
          });
        },
        async signUp(credentials: { email: string; password: string }) {
          purgeLegacySyntheticSessions();
          return rawSupabase.auth.signUp({
            email: credentials.email.trim().toLowerCase(),
            password: credentials.password,
          });
        },
        async updateUser(attributes: {
          password?: string;
          data?: { fullName?: string; phone?: string; [key: string]: unknown };
        }): Promise<{ data: { user: User | null }; error: Error | null }> {
          // Strip any attempt to pass role or privilege flags in editable user_metadata
          const sanitizedData = attributes.data ? { ...attributes.data } : undefined;
          if (sanitizedData) {
            delete sanitizedData.role;
            delete sanitizedData.is_active;
            delete sanitizedData.isActive;
          }

          const { data, error } = await rawSupabase.auth.updateUser({
            ...(attributes.password !== undefined ? { password: attributes.password } : {}),
            ...(sanitizedData !== undefined ? { data: sanitizedData } : {}),
          });

          if (error) {
            return { data: { user: null }, error };
          }

          const fullName =
            typeof sanitizedData?.fullName === 'string' ? sanitizedData.fullName.trim() : '';
          const phone =
            typeof sanitizedData?.phone === 'string' ? sanitizedData.phone.trim() : '';
          if (fullName && phone) {
            // Best-effort sync to public.user_profiles & public.customers via authenticated RPC
            await rawSupabase
              .rpc('sync_my_profile', {
                p_full_name: fullName,
                p_phone: phone,
              })
              .then(() => undefined, () => undefined);
          }

          return { data: { user: data.user }, error: null };
        },
        async signOut(): Promise<{ error: Error | null }> {
          purgeLegacySyntheticSessions();
          const { error } = await rawSupabase.auth.signOut();
          return { error };
        },
        onAuthStateChange(callback: (event: string, session: Session | null) => void) {
          return rawSupabase.auth.onAuthStateChange((event, session) => {
            const verified = isGenuineSupabaseUserSession(session) ? session : null;
            callback(event, verified);
          });
        },
      },
    }
  : null;

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) {
          setSession(data.session);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setSession(null);
          setLoading(false);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, current) => {
      if (active) {
        setSession(current);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
