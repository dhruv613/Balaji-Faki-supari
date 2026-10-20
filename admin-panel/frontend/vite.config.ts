import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Admin Panel reuses the storefront's shared code (API client, Supabase auth, common components, styles) from
// frontend/src through the `@shared` alias, and the same .env file and public images.
const storeFrontend = fileURLToPath(new URL('../../frontend', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': `${storeFrontend}/src` },
    dedupe: ['react', 'react-dom', 'react-router-dom', '@supabase/supabase-js'],
  },
  envDir: storeFrontend,
  publicDir: `${storeFrontend}/public`,
  server: {
    port: 5174,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
            return 'vendor';
          }
        },
      },
    },
  },
});
