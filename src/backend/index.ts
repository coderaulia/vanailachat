import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { OllamaService } from './services/ollama.js';
import { ToolService } from './services/tools.js';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// List models
app.get('/api/models', async (c) => {
  try {
    const models = await OllamaService.getInstalledModels();
    return c.json({ models });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Config info
app.get('/api/config', async (c) => {
  return c.json({
    apiUrl: '/api',
    ollamaUrl: OllamaService.getBaseUrl(),
  });
});

// Model details
app.get('/api/model-details', async (c) => {
  const model = c.req.query('model');
  if (!model) return c.json({ error: 'Model required' }, 400);
  
  const details = await OllamaService.getModelDetails(model);
  return c.json({ model, ...details });
});

// Chat proxy with Tool Support
app.post('/api/chat', async (c) => {
  const body = await c.req.json();
  const ollamaUrl = OllamaService.getBaseUrl();

  try {
    // 1. Initial request to Ollama (checking for tools)
    const clientWantsStreaming = body.stream !== false;
    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_web',
          description: 'Search the web for real-time information using DuckDuckGo',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query'
              }
            },
            required: ['query']
          }
        }
      }
    ];

    const initialBody = { ...body, stream: false, tools };

    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initialBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: errorText }, response.status as any);
    }

    const data: any = await response.json();
    const message = data.message;

    // 2. Handle Tool Calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolResults = [];
      for (const call of message.tool_calls) {
        const result = await ToolService.executeTool(call.function.name, call.function.arguments);
        toolResults.push({
          role: 'tool',
          content: result,
        });
      }

      // Re-prompt with tool results
      const finalBody = {
        ...body,
        messages: [...body.messages, message, ...toolResults],
        tools,
        stream: clientWantsStreaming
      };

      const finalResponse = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalBody),
      });

      if (clientWantsStreaming) {
        return c.body(finalResponse.body as any, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          }
        });
      } else {
        const finalData = await finalResponse.json();
        return c.json(finalData);
      }
    }

    // 3. Normal response
    if (clientWantsStreaming) {
        // Wrap single JSON into SSE for consistency if client expected stream
        return c.body(`data: ${JSON.stringify(data)}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' }
        });
    }
    return c.json(data);

  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

const port = Number(process.env.PORT) || 3000;

console.log(`[SERVER] Starting on port ${port}...`);

OllamaService.startServer()
  .then(() => {
    serve({
      fetch: app.fetch,
      port
    });
  })
  .catch((err) => {
    console.error('[FATAL] Failed to start Ollama:', err);
    process.exit(1);
  });
