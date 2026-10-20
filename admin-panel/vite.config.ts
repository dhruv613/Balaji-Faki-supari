import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Self-contained Admin Panel. Product photos are stored as /images/... paths that live in the store's public folder,
// so they are forwarded to the store: by admin-panel/vercel.json in production and by this proxy in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/images/products': 'http://localhost:5173', '/images/hero-product.jpg': 'http://localhost:5173' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
            return 'vendor';
          }
        },
      },
    },
  },
});
