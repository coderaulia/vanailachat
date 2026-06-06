import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { DatabaseService } from './services/database.js';
import { OllamaService } from './services/ollama.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Use PORT env or random ephemeral port to avoid EADDRINUSE
const BASE_PORT = Number(process.env.PORT) || (49152 + Math.floor(Math.random() * 16000));

console.log(`[SERVER] Starting on port ${BASE_PORT}...`);

try {
  DatabaseService.initialize();
  console.log('[DB] SQLite initialized');
} catch (error) {
  console.error('[FATAL] Failed to initialize SQLite database:', error);
  process.exit(1);
}

const app = createApp();

function startServer(port: number, retries: number): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server: Server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: '127.0.0.1',
      },
      (info: { port: number }) => {
        console.log(`[SERVER] Listening on http://127.0.0.1:${info.port}`);
        try {
          const portFile = resolve(import.meta.dirname, '../../.port');
          writeFileSync(portFile, String(info.port));
        } catch {
          // .port file write is best-effort
        }
        resolvePromise(info.port);
      },
    );

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && retries > 0) {
        console.log(`[SERVER] Port ${port} in use, trying ${port + 1} (${retries} retries left)...`);
        resolvePromise(startServer(port + 1, retries - 1));
      } else {
        reject(err);
      }
    });
  });
}

OllamaService.startServer()
  .then(() => startServer(BASE_PORT, 5))
  .then((port) => {
    console.log(`[SERVER] Ready on port ${port}`);
  })
  .catch((error) => {
    console.error('[FATAL] Server start failed:', error);
    process.exit(1);
  });
