import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The server only answers its own origin: present the dev viewer as the server's own page.
    proxy: { '/api': { target: API_TARGET, changeOrigin: true, headers: { origin: API_TARGET } } },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
