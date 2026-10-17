/**
 * Environment helpers.
 * All env access is centralised here so the rest of the app never
 * reads `import.meta.env` directly.
 */

export const env = {
  /** FastAPI base URL, e.g. http://localhost:8000/api */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''),

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
} as const;
