/**
 * Environment helpers.
 * All env access is centralised here so the rest of the app never
 * reads `import.meta.env` directly.
 */

export const env = {
  /** FastAPI base URL, e.g. http://localhost:8000/api. Production builds default to the same-origin `/api` (the backend service of the same Vercel project). */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '/api' : '')).replace(/\/$/, ''),

  /** Support WhatsApp number in international format, digits only. */
  supportWhatsApp: import.meta.env.VITE_SUPPORT_WHATSAPP ?? '918000961030',

  /** True when running `vite build` */
  isProd: import.meta.env.PROD,

  /** The storefront's address, for the Admin Panel's "Store" links (hidden when empty). */
  storeUrl: import.meta.env.VITE_STORE_URL ?? (import.meta.env.DEV ? 'http://localhost:5173' : ''),

  /** The Admin Panel's address (a separate site), for the storefront's "Admin Panel" link shown to the Owner Admin. */
  adminUrl: import.meta.env.VITE_ADMIN_URL ?? (import.meta.env.DEV ? 'http://localhost:5174' : ''),
} as const;
