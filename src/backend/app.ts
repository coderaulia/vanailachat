import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { DatabaseService } from './services/database.js';
import { OllamaService } from './services/ollama.js';
import { ToolService } from './services/tools.js';
import type { AppDependencies } from './types.js';

import { projectsRouter } from './routes/projects.js';
import { chatsRouter } from './routes/chats.js';
import { messagesRouter } from './routes/messages.js';
import { dataRouter } from './routes/data.js';
import { modelsRouter } from './routes/models.js';
import { chatRouter } from './routes/chat.js';

const defaultDependencies: AppDependencies = {
  executeTool: ToolService.executeTool.bind(ToolService),
  fetchFn: fetch,
  getBaseUrl: OllamaService.getBaseUrl.bind(OllamaService),
  getInstalledModels: OllamaService.getInstalledModels.bind(OllamaService),
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
  app.route('/api', dataRouter(dependencies)); // Mounts /export, /import, /pick-directory
  app.route('/api/models', modelsRouter(dependencies)); // Note: model-details, models, config handled here or in app.ts
  
  // Expose /api/config
  app.get('/api/config', (context) => {
    return context.json({
      apiUrl: '/api',
      ollamaUrl: dependencies.getBaseUrl(),
    });
  });

  // Re-map model-details here or ensure it's in modelsRouter? Let's keep it here for exact match
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

  app.route('/api/chat', chatRouter(dependencies));

  return app;
}
