/**
 * One codebase, two Vercel projects: `admin` builds serve only the Admin Panel, `customer` builds only the storefront,
 * `all` (the default, used for local development) serves both.
 */
export type AppMode = 'all' | 'admin' | 'customer';

export function parseAppMode(value: unknown): AppMode {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return mode === 'admin' || mode === 'customer' ? mode : 'all';
}
