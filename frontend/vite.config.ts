import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'markdown-utf8-content-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const requestPath = (req.url || '').split('?')[0];
          if (requestPath.endsWith('.md')) {
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          }
          next();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (id.includes('@xyflow/react')) {
            return 'xyflow';
          }
          if (id.includes('react-markdown')) {
            return 'markdown';
          }
          if (id.includes('@dagrejs/dagre')) {
            return 'dagre';
          }
          if (
            id.includes('react-router-dom')
            || id.includes('/react-router/')
            || id.includes('/react-dom/')
            || id.includes('/react/')
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.idea/**', '.git/**', '.cache/**'],
  },
});
