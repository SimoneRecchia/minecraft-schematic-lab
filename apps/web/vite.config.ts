import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          drei: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
