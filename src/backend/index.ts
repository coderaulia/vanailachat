import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { DatabaseService } from './services/database.js';
import { OllamaService } from './services/ollama.js';

const port = Number(process.env.PORT) || 3000;

console.log(`[SERVER] Starting on port ${port}...`);

try {
  DatabaseService.initialize();
  console.log('[DB] SQLite initialized');
} catch (error) {
  console.error('[FATAL] Failed to initialize SQLite database:', error);
  process.exit(1);
}

const app = createApp();

OllamaService.startServer()
  .then(() => {
    serve({
      fetch: app.fetch,
      port,
    });
  })
  .catch((error) => {
    console.error('[FATAL] Failed to start Ollama:', error);
    process.exit(1);
  });
