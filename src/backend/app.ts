import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { DatabaseService } from './services/database.js';
import { EmbeddingService } from './services/embedding.js';
import { OllamaService } from './services/ollama.js';
import { OllamaProvider } from './services/ollamaProvider.js';
import { OpenAIProvider } from './services/openaiProvider.js';
import { NineRouterProvider } from './services/nineRouterProvider.js';
import { ToolService } from './services/tools.js';
import { ProviderRegistry } from './services/providerRegistry.js';
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
import { researchRouter } from './routes/research.js';

const defaultDependencies: Omit<AppDependencies, 'providerRegistry'> = {
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
  listEnabledSkills: DatabaseService.listEnabledSkills.bind(DatabaseService),
  getAllMemoryEntries: DatabaseService.getAllMemoryEntries.bind(DatabaseService),
  upsertMemory: DatabaseService.upsertMemory.bind(DatabaseService),
  deleteMemory: DatabaseService.deleteMemory.bind(DatabaseService),
  embed: EmbeddingService.embed.bind(EmbeddingService),
  searchMemories: EmbeddingService.searchWithVector.bind(EmbeddingService),
  searchMemoriesByText: EmbeddingService.search.bind(EmbeddingService),
  listSkills: DatabaseService.listSkills.bind(DatabaseService),
  upsertSkill: DatabaseService.upsertSkill.bind(DatabaseService),
  setSkillEnabled: DatabaseService.setSkillEnabled.bind(DatabaseService),
  deleteSkill: DatabaseService.deleteSkill.bind(DatabaseService),
  getAllSettings: DatabaseService.getAllSettings.bind(DatabaseService),
  getSetting: DatabaseService.getSetting.bind(DatabaseService),
  upsertSetting: DatabaseService.upsertSetting.bind(DatabaseService),
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

/** Build a fresh ProviderRegistry using injected fetchFn and getBaseUrl so tests can mock them. */
function buildProviderRegistry(fetchFn: typeof fetch, getBaseUrl: () => string): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new OllamaProvider(fetchFn, getBaseUrl));
  try {
    registry.register(new OpenAIProvider());
  } catch {
    // Ignore — missing API key at startup is fine
  }
  try {
    registry.register(new NineRouterProvider());
  } catch {
    // Ignore
  }
  return registry;
}

export function createApp(overrides: Partial<AppDependencies> = {}): Hono {
  // Merge non-registry deps first so fetchFn override is visible when building registry
  const baseDeps = { ...defaultDependencies, ...overrides };
  const registry = overrides.providerRegistry ?? buildProviderRegistry(baseDeps.fetchFn, baseDeps.getBaseUrl);
  const dependencies: AppDependencies = { ...baseDeps, providerRegistry: registry };

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

  // Rate limiting — must be before routes.
  // trustProxy is OFF by default (single anonymous bucket) since the app is
  // expected to run locally; enable in production behind a trusted proxy.
  app.use('/api/chat/*', rateLimiter({ maxRequests: 20, windowMs: 60_000 }));
  app.use('/api/models/*', rateLimiter({ maxRequests: 60, windowMs: 60_000 }));
  // Research runs N searches + N URL fetches + LLM synthesis — expensive
  app.use('/api/research/*', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
  // Memory writes embed + DB-write per call
  app.use('/api/memory/*', rateLimiter({ maxRequests: 60, windowMs: 60_000 }));
  // Skill install fans out to GitHub — modest cap
  app.use('/api/skills/install', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
  app.use('/api/skills/custom', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));

  app.route('/api/settings', settingsRouter(dependencies));
  app.route('/api/skills', skillsRouter(dependencies));
  app.route('/api/personas', personasRouter());
  app.route('/api/research', researchRouter(dependencies));
  app.route('/api/memory', memoryRouter(dependencies));
  app.route('/api/chat', chatRouter(dependencies));

  return app;
}
