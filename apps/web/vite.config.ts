import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Pages load their code on demand, but the styles stay in one file. Split stylesheets
    // would apply in the order pages were visited, which would change how rules override.
    cssCodeSplit: false,
  },
  resolve: {
    alias: {
      '@vip/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (_error, _req, res) => {
            if (res && 'writeHead' in res && 'headersSent' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'API is starting. Retry in a moment.' }));
            }
          });
        },
      },
    },
  },
});
