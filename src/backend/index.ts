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

// Chat proxy with Tool Support (OpenAI Compatible)
app.post('/api/chat', async (c) => {
  const body = await c.req.json();
  const ollamaUrl = OllamaService.getBaseUrl();

  try {
    const clientWantsStreaming = body.stream !== false;
    const tools = ToolService.getToolDefinitions();

    // System prompt based on user search preference
    let systemPrompt = 'You are a helpful assistant.';
    if (body.search) {
      systemPrompt += ' Web search is enabled. ALWAYS use search_web if the user asks for real-time information, news, or facts you are unsure about.';
    }
    systemPrompt += ' You can also read local project files using read_file.';

    let messages = [
      { role: 'system', content: systemPrompt },
      ...body.messages 
    ];

    let currentTurn = 0;
    const maxTurns = 5;
    let lastData: any = null;

    while (currentTurn < maxTurns) {
      const response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          stream: false,
          tools,
          messages
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data: any = await response.json();
      lastData = data;
      lastMessage = data.choices[0].message;
      messages.push(lastMessage);

      if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        for (const call of lastMessage.tool_calls) {
          const result = await ToolService.executeTool(call.function.name, JSON.parse(call.function.arguments));
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: result,
          });
        }
        currentTurn++;
      } else {
        break; // No more tool calls
      }
    }

    // 3. Final response handling
    if (clientWantsStreaming) {
        const sseContent = `data: ${JSON.stringify({
            message: { role: 'assistant', content: lastMessage.content },
            usage: lastData?.usage,
            done: true
        })}\n\n`;
        
        return c.body(sseContent, {
            headers: { 'Content-Type': 'text/event-stream' }
        });
    }
    return c.json({ 
      choices: [{ message: lastMessage }],
      usage: lastData?.usage 
    });

  } catch (err: any) {
    console.error(`[CHAT ERROR] ${err.message}`);
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
