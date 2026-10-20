import { parseAppMode } from './appMode';

/**
 * Environment helpers.
 * All env access is centralised here so the rest of the app never
 * reads `import.meta.env` directly.
 */

export const env = {
  /** FastAPI base URL, e.g. http://localhost:8000/api. Production builds default to the same-origin `/api` (the backend service of the same Vercel project). */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '/api' : '')).replace(/\/$/, ''),

  /** Supabase project URL */
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',

  /** Supabase publishable key — safe for the client */
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY ??
    '',

  /** Support WhatsApp number in international format, digits only. */
  supportWhatsApp: import.meta.env.VITE_SUPPORT_WHATSAPP ?? '918000961030',

  /** True when running `vite build` */
  isProd: import.meta.env.PROD,

  /** `admin` = Admin Panel only, `customer` = storefront only, anything else = both (local development). */
  appMode: parseAppMode(import.meta.env.VITE_APP_MODE),

  /** Where the storefront lives when this build is admin-only; the admin "Store" links point there (hidden when empty). */
  storeUrl: import.meta.env.VITE_STORE_URL ?? '',
} as const;
