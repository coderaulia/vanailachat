import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync, watchFile } from 'node:fs';
import { request } from 'node:http';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Dynamic backend proxy plugin.
 * Reads the backend port from .port on every request so tsx watch restarts
 * are always proxied to the correct (possibly new) port.
 */
function backendProxyPlugin(): Plugin {
  let targetPort = 0;
  const portFile = path.resolve(__dirname, '.port');

  function loadPort() {
    try {
      const raw = readFileSync(portFile, 'utf-8').trim();
      const p = Number(raw);
      if (p > 0 && Number.isFinite(p)) targetPort = p;
    } catch {
      // .port file missing or unreadable — backend not started yet
    }
  }

  return {
    name: 'dynamic-backend-proxy',
    configureServer(server) {
      // Load immediately in case backend already ran
      loadPort();

      // Re-load when backend writes a new port (tsx watch restart)
      watchFile(portFile, { interval: 200 }, () => {
        loadPort();
        if (targetPort) {
          console.log(`[vite] Backend proxy → http://127.0.0.1:${targetPort}`);
        }
      });

      server.middlewares.use('/api', (req: IncomingMessage, res: ServerResponse) => {
        // Reload on every request to pick up restarts immediately
        loadPort();

        if (!targetPort) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Backend not yet started' }));
          return;
        }

        const opts = {
          hostname: '127.0.0.1',
          port: targetPort,
          path: '/api' + req.url,  // req.url is stripped of the '/api' mount prefix
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
        };

        const proxy = request(opts, (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });

        proxy.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Backend unreachable' }));
          }
        });

        req.pipe(proxy, { end: true });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), backendProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // No static proxy — handled dynamically by backendProxyPlugin above
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
