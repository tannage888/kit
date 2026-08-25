import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/api\/.*/,
            handler: 'NetworkFirst',
            options: { cacheName: 'kit-api', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  preview: {
    port: 3143,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3141',
    },
  },
});
