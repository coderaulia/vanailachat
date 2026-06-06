import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { DatabaseService } from './services/database.js';
import { OllamaService } from './services/ollama.js';
import { OllamaProvider } from './services/ollamaProvider.js';
import { OpenAIProvider } from './services/openaiProvider.js';
import { ToolService } from './services/tools.js';
import { providerRegistry } from './services/providerRegistry.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import type { AppDependencies } from './types.js';

import { projectsRouter } from './routes/projects.js';
import { chatsRouter } from './routes/chats.js';
import { messagesRouter } from './routes/messages.js';
import { dataRouter } from './routes/data.js';
import { modelsRouter } from './routes/models.js';
import { chatRouter } from './routes/chat.js';
import { memoryRouter } from './routes/memory.js';
import { settingsRouter } from './routes/settings.js';
import { personasRouter } from './routes/personas.js';
import { skillsRouter } from './routes/skills.js';

// Register providers at startup
providerRegistry.register(new OllamaProvider());
try {
  providerRegistry.register(new OpenAIProvider());
} catch {
  // Ignore
}

const defaultDependencies: AppDependencies = {
  executeTool: ToolService.executeTool.bind(ToolService),
  fetchFn: fetch,
  getBaseUrl: OllamaService.getBaseUrl.bind(OllamaService),
  getInstalledModels: OllamaService.getInstalledModels.bind(OllamaService),
  getInstalledModelMetadata: OllamaService.getInstalledModelMetadata.bind(OllamaService),
  getModelDetails: OllamaService.getModelDetails.bind(OllamaService),
  getToolDefinitions: ToolService.getToolDefinitions.bind(ToolService),
  listProjects: DatabaseService.listProjects.bind(DatabaseService),
  getProject: DatabaseService.getProject.bind(DatabaseService),
  createProject: DatabaseService.createProject.bind(DatabaseService),
  updateProject: DatabaseService.updateProject.bind(DatabaseService),
  deleteProject: DatabaseService.deleteProject.bind(DatabaseService),
  listChats: DatabaseService.listChats.bind(DatabaseService),
  getChat: DatabaseService.getChat.bind(DatabaseService),
  upsertChat: DatabaseService.upsertChat.bind(DatabaseService),
  deleteChat: DatabaseService.deleteChat.bind(DatabaseService),
  listMessages: DatabaseService.listMessages.bind(DatabaseService),
  insertMessage: DatabaseService.insertMessage.bind(DatabaseService),
  pickDirectory: async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFilePromise = promisify(execFile);
    try {
      const { stdout } = await execFilePromise('zenity', [
        '--file-selection',
        '--directory',
        '--title=Select Project Root',
      ]);
      return stdout.trim();
    } catch {
      try {
        const { stdout } = await execFilePromise('kdialog', ['--getexistingdirectory', '.']);
        return stdout.trim();
      } catch {
        return null;
      }
    }
  },
  providerRegistry,
};

export function createApp(overrides: Partial<AppDependencies> = {}): Hono {
  const dependencies = { ...defaultDependencies, ...overrides };
  const app = new Hono();

  app.use('*', logger());
  app.use('*', cors());

  app.get('/api/health', (context) => context.json({ status: 'ok' }));

  app.route('/api/projects', projectsRouter(dependencies));
  app.route('/api/chats', chatsRouter(dependencies));
  app.route('/api/messages', messagesRouter(dependencies));
  app.route('/api', dataRouter(dependencies));
  app.route('/api/models', modelsRouter(dependencies));

  // Expose /api/config
  app.get('/api/config', (context) => {
    return context.json({
      apiUrl: '/api',
      ollamaUrl: dependencies.getBaseUrl(),
      providers: dependencies.providerRegistry.list().map(p => ({ id: p.id, label: p.label })),
    });
  });

  // Model details endpoint
  app.get('/api/model-details', async (context) => {
    const model = context.req.query('model');
    if (!model) {
      return context.json({ error: 'Model required' }, 400);
    }

    try {
      const details = await dependencies.getModelDetails(model);
      return context.json({ model, ...(details as object) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return context.json({ error: message }, 500);
    }
  });

  // Rate limiting — must be before routes
  app.use('/api/chat/*', rateLimiter({ maxRequests: 20, windowMs: 60_000 }));
  app.use('/api/models/*', rateLimiter({ maxRequests: 60, windowMs: 60_000 }));

  app.route('/api/settings', settingsRouter());
  app.route('/api/skills', skillsRouter());
  app.route('/api/personas', personasRouter());
  app.route('/api/memory', memoryRouter(dependencies));
  app.route('/api/chat', chatRouter(dependencies));

  return app;
}
