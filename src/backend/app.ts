import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { DatabaseService } from './services/database.js';
import { EmbeddingService } from './services/embedding.js';
import { OllamaService } from './services/ollama.js';
import { OllamaProvider } from './services/ollamaProvider.js';
import { OpenAIProvider } from './services/openaiProvider.js';
import { OpenRouterProvider } from './services/openRouterProvider.js';
import { NineRouterProvider } from './services/nineRouterProvider.js';
import { CustomOpenAIProvider } from './services/customOpenAIProvider.js';
import { ToolService } from './services/tools.js';
import { ProviderRegistry } from './services/providerRegistry.js';
import { CodingHarnessRegistry } from './services/codingHarness.js';
import { ClaudeCodeHarness } from './services/claudeCodeHarness.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { LOOPBACK_ORIGIN, originGuard } from './middleware/originGuard.js';
import { sanitizeError } from './helpers/index.js';
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
import { trainingRouter } from './routes/training.js';
import { abRouter } from './routes/ab.js';
import { attachmentsRouter } from './routes/attachments.js';
import { codingRouter } from './routes/coding.js';
import { filesystemRouter } from './routes/filesystem.js';
import { freeClaudeCodeRouter } from './routes/freeClaudeCodeRoute.js';

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
  searchMessages: DatabaseService.searchMessages.bind(DatabaseService),
  insertMessage: DatabaseService.insertMessage.bind(DatabaseService),
  getMessage: DatabaseService.getMessage.bind(DatabaseService),
  upsertFeedback: DatabaseService.upsertFeedback.bind(DatabaseService),
  getFeedback: DatabaseService.getFeedback.bind(DatabaseService),
  listFeedbackForChat: DatabaseService.listFeedbackForChat.bind(DatabaseService),
  listTrainingPairs: DatabaseService.listTrainingPairs.bind(DatabaseService),
  autoPositiveForChat: DatabaseService.autoPositiveForChat.bind(DatabaseService),
  listHighScoringChats: DatabaseService.listHighScoringChats.bind(DatabaseService),
  listDistillationPairs: DatabaseService.listDistillationPairs.bind(DatabaseService),
  recordAbPick: DatabaseService.recordAbPick.bind(DatabaseService),
  listEnabledSkills: DatabaseService.listEnabledSkills.bind(DatabaseService),
  getAllMemoryEntries: DatabaseService.getAllMemoryEntries.bind(DatabaseService),
  upsertMemory: DatabaseService.upsertMemory.bind(DatabaseService),
  deleteMemory: DatabaseService.deleteMemory.bind(DatabaseService),
  embed: EmbeddingService.embed.bind(EmbeddingService),
  embedOrNull: EmbeddingService.embedOrNull.bind(EmbeddingService),
  searchMemoriesByKeyword: EmbeddingService.searchByKeyword.bind(EmbeddingService),
  searchMemories: EmbeddingService.searchWithVector.bind(EmbeddingService),
  searchMemoriesByText: EmbeddingService.search.bind(EmbeddingService),
  listSkills: DatabaseService.listSkills.bind(DatabaseService),
  upsertSkill: DatabaseService.upsertSkill.bind(DatabaseService),
  setSkillEnabled: DatabaseService.setSkillEnabled.bind(DatabaseService),
  deleteSkill: DatabaseService.deleteSkill.bind(DatabaseService),
  getAllSettings: DatabaseService.getAllSettings.bind(DatabaseService),
  getSetting: DatabaseService.getSetting.bind(DatabaseService),
  upsertSetting: DatabaseService.upsertSetting.bind(DatabaseService),
  codingHarnesses: new CodingHarnessRegistry([new ClaudeCodeHarness()]),
  getCodingSession: DatabaseService.getCodingSession.bind(DatabaseService),
  upsertCodingSession: DatabaseService.upsertCodingSession.bind(DatabaseService),
  runInTransaction: DatabaseService.runInTransaction.bind(DatabaseService),
  // Native folder picker. Every platform ships a different one, so each is
  // tried in turn and a missing dialog just yields null (the UI still accepts
  // a typed path).
  pickDirectory: async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFilePromise = promisify(execFile);

    // A native dialog blocks until someone clicks it. Without a cap the HTTP
    // request hangs forever and the dialog process leaks — one stuck picker
    // per click, invisible, with the UI showing nothing at all.
    const DIALOG_TIMEOUT_MS = 2 * 60_000;

    // FolderBrowserDialog has no owner by default, so it can open behind the
    // browser window and look like nothing happened. A topmost owner form
    // forces it in front.
    const windowsScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      '$owner.ShowInTaskbar = $false',
      '$owner.Opacity = 0',
      '$owner.Show()',
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Select the folder Claude Code should work in'",
      '$dialog.ShowNewFolderButton = $true',
      "if ($dialog.ShowDialog($owner) -eq 'OK') { Write-Output $dialog.SelectedPath }",
      '$owner.Close()',
      '$owner.Dispose()',
    ].join('; ');

    const candidates: Array<[string, string[]]> =
      process.platform === 'win32'
        ? [['powershell.exe', ['-NoProfile', '-STA', '-Command', windowsScript]]]
        : process.platform === 'darwin'
          ? [[
              'osascript',
              ['-e', 'POSIX path of (choose folder with prompt "Select Project Root")'],
            ]]
          : [
              ['zenity', ['--file-selection', '--directory', '--title=Select Project Root']],
              ['kdialog', ['--getexistingdirectory', '.']],
            ];

    for (const [binary, args] of candidates) {
      try {
        const { stdout } = await execFilePromise(binary, args, {
          timeout: DIALOG_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          windowsHide: false,
        });
        const picked = stdout.trim();
        if (picked) return picked;
      } catch (error) {
        // Cancelling the dialog exits non-zero, which is not an error worth
        // reporting; a missing dialog binary just means trying the next one.
        const failure = error as { killed?: boolean; code?: string };
        if (failure?.killed || failure?.code === 'ETIMEDOUT') {
          console.warn(`[PICKER] ${binary} timed out after ${DIALOG_TIMEOUT_MS}ms`);
        }
      }
    }
    return null;
  },
};

/** Build a fresh ProviderRegistry using injected fetchFn and getBaseUrl so tests can mock them. */
function buildProviderRegistry(
  fetchFn: typeof fetch,
  getBaseUrl: () => string,
  getInstalledModels: () => Promise<string[]>,
  getModelDetails: (modelName: string) => Promise<unknown>,
): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(
    new OllamaProvider(
      fetchFn,
      getBaseUrl,
      getInstalledModels,
      async (modelName) =>
        (await getModelDetails(modelName)) as Record<string, unknown> | null,
    ),
  );
  try {
    registry.register(new OpenAIProvider());
  } catch {
    // Ignore — missing API key at startup is fine
  }
  try {
    registry.register(new OpenRouterProvider());
  } catch {
    // Ignore
  }
  try {
    registry.register(new NineRouterProvider());
  } catch {
    // Ignore
  }
  try {
    registry.register(new CustomOpenAIProvider());
  } catch {
    // Ignore
  }
  return registry;
}

export function createApp(overrides: Partial<AppDependencies> = {}): Hono {
  // Merge non-registry deps first so fetchFn override is visible when building registry
  const baseDeps = { ...defaultDependencies, ...overrides };
  const registry =
    overrides.providerRegistry ??
    buildProviderRegistry(
      baseDeps.fetchFn,
      baseDeps.getBaseUrl,
      baseDeps.getInstalledModels,
      baseDeps.getModelDetails,
    );
  const dependencies: AppDependencies = { ...baseDeps, providerRegistry: registry };

  const app = new Hono();

  app.use('*', logger());

  // Security headers. The API returns JSON only, so the CSP is maximally
  // restrictive — nothing here is ever rendered as a document.
  // HSTS is opt-in via ENABLE_HSTS=1: the server speaks plaintext HTTP on
  // 127.0.0.1 by default, and pinning localhost to HTTPS would break it.
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
      xFrameOptions: 'DENY',
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'no-referrer',
      crossOriginResourcePolicy: 'same-origin',
      strictTransportSecurity:
        process.env.ENABLE_HSTS === '1' ? 'max-age=31536000; includeSubDomains' : false,
    }),
  );

  // CORS is restricted to loopback origins on any port. The frontend reaches
  // the API same-origin through the Vite proxy, so no cross-site access is
  // needed — and a wildcard would let any page the user visits drive this API,
  // which exposes filesystem and shell tools.
  app.use(
    '*',
    cors({
      origin: (origin) => (origin && LOOPBACK_ORIGIN.test(origin) ? origin : null),
      credentials: false,
    }),
  );

  // Blocks cross-site writes that CORS alone does not stop — CORS gates reading
  // the response, not sending the request.
  app.use('*', originGuard());

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
      const message = sanitizeError(error, 'Unknown error');
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
  app.route('/api/training', trainingRouter(dependencies));
  app.use('/api/ab/*', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
  app.route('/api/ab', abRouter(dependencies));
  // Document extraction is CPU-bound unzip/parse work — cap it like the
  // other expensive endpoints.
  app.use('/api/attachments/*', rateLimiter({ maxRequests: 30, windowMs: 60_000 }));
  app.route('/api/attachments', attachmentsRouter());
  app.route('/api/coding', codingRouter(dependencies));
  app.route('/api/fcc', freeClaudeCodeRouter(dependencies));
  // Directory listing for the in-app folder picker (names only, no contents).
  app.use('/api/fs/*', rateLimiter({ maxRequests: 120, windowMs: 60_000 }));
  app.route('/api/fs', filesystemRouter());

  app.route('/api/chat', chatRouter(dependencies));

  return app;
}
