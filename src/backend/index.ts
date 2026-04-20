import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { OllamaService } from './services/ollama.js';

const app = createApp();
const port = Number(process.env.PORT) || 3000;

console.log(`[SERVER] Starting on port ${port}...`);

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
