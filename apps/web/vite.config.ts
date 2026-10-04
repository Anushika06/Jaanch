import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :8787; the dev server proxies API calls so the browser sees one
// origin (same as production, where the API serves the built app or a host rewrites /api).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/healthz': 'http://127.0.0.1:8787',
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
});
