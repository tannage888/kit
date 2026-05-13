import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  preview: {
    port: 3143,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3141',
    },
  },
});
