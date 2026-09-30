import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { isLoopbackHost } from './middleware/accessToken.js';
import { DatabaseService } from './services/database.js';
import { OllamaService } from './services/ollama.js';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setDefaultResultOrder } from 'node:dns';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

// Prefer IPv4 over IPv6 to avoid connection timeouts (ETIMEDOUT / internalConnectMultiple)
// on networks where IPv6 is configured on the host but not routed externally.
try {
  setDefaultResultOrder('ipv4first');
} catch {
  // best-effort
}

// Automatically configure Node.js global fetch to respect system proxy variables
// (HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy, NO_PROXY, no_proxy)
try {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxyUrl) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
} catch {
  // best-effort proxy setup
}

// Automatically load local .env and .env.local files if present
for (const envFileName of ['.env', '.env.local']) {
  const envFilePath = resolve(process.cwd(), envFileName);
  if (existsSync(envFilePath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envFilePath);
      }
    } catch {
      // best-effort env loading
    }
  }
}

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

// Binding beyond loopback exposes filesystem and shell tools, so it is only
// allowed together with an access token.
const HOST = process.env.HOST?.trim() || '127.0.0.1';
if (!isLoopbackHost(HOST) && !process.env.VANAILA_ACCESS_TOKEN?.trim()) {
  console.error(`[FATAL] HOST=${HOST} is not loopback. Set VANAILA_ACCESS_TOKEN to expose the API on the network.`);
  process.exit(1);
}

const app = createApp();

function startServer(port: number, retries: number): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: HOST,
      },
      (info: { port: number }) => {
        console.log(`[SERVER] Listening on http://${HOST}:${info.port}`);
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

startServer(BASE_PORT, 5)
  .catch((error) => {
    // Ollama is optional — cloud providers (OpenAI, 9Router, custom) work without it
    console.warn('[SERVER] Unable to start:', error instanceof Error ? error.message : error);
    throw error;
  })
  .then((port) => {
    console.log(`[SERVER] Ready on port ${port}`);
    void OllamaService.startServer().catch((error) => {
      console.warn('[OLLAMA] Unavailable, continuing without local models:', error instanceof Error ? error.message : error);
    });
  })
  .catch((error) => {
    console.error('[FATAL] Server start failed:', error);
    process.exit(1);
  });
