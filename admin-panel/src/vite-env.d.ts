/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_NEON_AUTH_URL?: string;
  readonly VITE_SUPPORT_WHATSAPP?: string;
  readonly VITE_STORE_URL?: string;
  readonly VITE_ADMIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
