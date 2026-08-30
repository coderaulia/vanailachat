import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { ApprovalService, describeToolCall, normalizeApprovalDetails } from './approvals.js';
import { DatabaseService } from './database.js';
import { resolveHarnessProvider } from './harnessProvider.js';
import type { CodingEvent, CodingHarness, CodingHarnessStatus, CodingRunInput } from './codingHarness.js';

const READ_ONLY_PI_TOOLS = new Set(['find', 'grep', 'ls', 'read']);
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const TOOL_POLICIES = ['readonly', 'approval', 'autonomous'] as const;

type PiThinkingLevel = typeof THINKING_LEVELS[number];
type PiToolPolicy = typeof TOOL_POLICIES[number];

interface PiHarnessConfig {
  agentDir: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  systemPrompt: string;
  thinkingLevel: PiThinkingLevel;
  toolPolicy: PiToolPolicy;
}

function setting(key: string, envKey?: string): string {
  try {
    return DatabaseService.getSetting(key)?.trim() ?? '';
  } catch {
    return envKey ? process.env[envKey]?.trim() ?? '' : '';
  }
}

function getConfig(): PiHarnessConfig {
  const thinking = setting('pi_thinking_level', 'PI_THINKING_LEVEL').toLowerCase() as PiThinkingLevel;
  const toolPolicy = setting('pi_tool_policy', 'PI_TOOL_POLICY').toLowerCase() as PiToolPolicy;
  return {
    agentDir: setting('pi_agent_dir', 'PI_CODING_AGENT_DIR') || join(process.env.HOME || tmpdir(), '.pi', 'agent'),
    apiKey: setting('pi_api_key', 'PI_API_KEY'),
    baseUrl: setting('pi_base_url', 'PI_BASE_URL'),
    model: setting('pi_model', 'PI_MODEL'),
    provider: setting('pi_provider', 'PI_PROVIDER'),
    systemPrompt: setting('pi_system_prompt', 'PI_SYSTEM_PROMPT'),
    thinkingLevel: THINKING_LEVELS.includes(thinking) ? thinking : 'medium',
    toolPolicy: TOOL_POLICIES.includes(toolPolicy) ? toolPolicy : 'approval',
  };
}

function toolCategory(toolName: string): 'command' | 'file_edit' | 'file_read' | 'file_write' {
  if (toolName === 'bash') return 'command';
  if (toolName === 'edit') return 'file_edit';
  if (toolName === 'write') return 'file_write';
  return 'file_read';
}

function toolText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : ''
    ))
    .join('');
}

function toolEvent(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  status: 'start' | 'done' | 'error',
  detail?: string,
): CodingEvent {
  const normalized = normalizeApprovalDetails(toolName, args);
  return {
    type: 'tool',
    id: toolCallId,
    name: toolName,
    status,
    category: toolCategory(toolName),
    file: normalized.path,
    command: normalized.command,
    detail,
    input: args,
  };
}

async function createModelRuntime(config: PiHarnessConfig): Promise<{
  modelRuntime: Awaited<ReturnType<typeof ModelRuntime.create>>;
  tempDir?: string;
}> {
  if (!config.baseUrl) {
    const modelRuntime = await ModelRuntime.create();
    if (config.apiKey && config.provider) {
      await modelRuntime.setRuntimeApiKey(config.provider, config.apiKey);
    }
    return { modelRuntime };
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'vanaila-pi-'));
  const modelsPath = join(tempDir, 'models.json');
  await writeFile(modelsPath, JSON.stringify({
    providers: {
      [config.provider]: {
        api: 'openai-completions',
        apiKey: config.apiKey || 'vanaila-local',
        baseUrl: config.baseUrl,
        models: [{ id: config.model, name: config.model }],
      },
    },
  }));
  return { modelRuntime: await ModelRuntime.create({ modelsPath }), tempDir };
}

export class PiHarness implements CodingHarness {
  readonly id = 'pi-harness' as const;

  async status(): Promise<CodingHarnessStatus> {
    const config = getConfig();
    const resolved = resolveHarnessProvider(undefined, config.provider, config.model);
    const label = resolved.provider === 'openrouter'
      ? 'Pi Harness (via OpenRouter)'
      : resolved.provider === '9router'
        ? 'Pi Harness (via 9Router)'
        : resolved.provider === 'ollama'
          ? 'Pi Harness (via Ollama)'
          : resolved.provider.startsWith('custom')
            ? 'Pi Harness (via Custom Provider)'
            : 'Pi Harness';
    return { id: this.id, label, available: true };
  }

  async *run(input: CodingRunInput): AsyncIterable<CodingEvent> {
    const storedConfig = getConfig();
    const config = { ...storedConfig, ...resolveHarnessProvider(input.model, storedConfig.provider, storedConfig.model) };

    const modelId = config.model.includes('/')
      ? config.model.split('/').slice(1).join('/')
      : config.model;
    if (!modelId) throw new Error('Pi Harness requires a model ID.');

    const { modelRuntime, tempDir } = await createModelRuntime(config);
    const model = modelRuntime.getModel(config.provider, modelId);
    if (!model) throw new Error(`Unknown Pi model: ${config.provider}/${modelId}`);
    if (!config.apiKey && !modelRuntime.hasConfiguredAuth(config.provider)) {
      throw new Error(`Pi provider ${config.provider} has no configured API key.`);
    }

    const settingsManager = SettingsManager.create(input.cwd, config.agentDir);
    const resourceLoader = new DefaultResourceLoader({
      agentDir: config.agentDir,
      cwd: input.cwd,
      noExtensions: true,
      noPromptTemplates: true,
      settingsManager,
      ...(config.systemPrompt ? { systemPromptOverride: () => config.systemPrompt } : {}),
    });
    await resourceLoader.reload();

    const eventQueue: CodingEvent[] = [];
    let wakeConsumer: (() => void) | null = null;
    let producerDone = false;
    let producerError: unknown;

    const pushEvent = (event: CodingEvent) => {
      eventQueue.push(event);
      wakeConsumer?.();
      wakeConsumer = null;
    };

    const readOnlyTools = createReadOnlyTools(input.cwd);
    const codingTools = createCodingTools(input.cwd);
    const allTools = [
      ...readOnlyTools,
      ...codingTools.filter((t) => !readOnlyTools.some((r) => r.name === t.name)),
    ] as ToolDefinition[];
    const enabledTools = config.toolPolicy === 'readonly'
      ? allTools.filter((tool) => READ_ONLY_PI_TOOLS.has(tool.name))
      : allTools.map((tool) => this.wrapTool(tool, input, pushEvent));

    const sessionManager = input.sessionId
      ? SessionManager.open(input.sessionId)
      : SessionManager.inMemory(input.cwd);
    const { session } = await createAgentSession({
      agentDir: config.agentDir,
      customTools: enabledTools,
      cwd: input.cwd,
      model,
      modelRuntime,
      resourceLoader,
      sessionManager,
      settingsManager,
      thinkingLevel: config.thinkingLevel,
      tools: enabledTools.map((tool) => tool.name),
    });

    const abort = () => session.agent.abort();
    input.signal.addEventListener('abort', abort, { once: true });

    try {
      yield { type: 'session', sessionId: session.sessionManager.getSessionId() };
      let usageEmitted = false;
      const toolArgs = new Map<string, Record<string, unknown>>();

      session.subscribe((event) => {
        if (event.type === 'tool_execution_start' && READ_ONLY_PI_TOOLS.has(event.toolName)) {
          const args = event.args as Record<string, unknown>;
          toolArgs.set(event.toolCallId, args);
          pushEvent(toolEvent(event.toolCallId, event.toolName, args, 'start'));
        }

        if (event.type === 'tool_execution_end' && READ_ONLY_PI_TOOLS.has(event.toolName)) {
          const args = toolArgs.get(event.toolCallId) ?? {};
          toolArgs.delete(event.toolCallId);
          const detail = toolText(event.result?.content)
            || describeToolCall(event.toolName, args);
          pushEvent(toolEvent(
            event.toolCallId,
            event.toolName,
            args,
            event.isError ? 'error' : 'done',
            detail,
          ));
        }

        if (event.type === 'message_update') {
          const update = event.assistantMessageEvent as Record<string, unknown>;
          if (update.type === 'text_delta' && typeof update.delta === 'string') {
            pushEvent({ type: 'text', text: update.delta });
          }

          const usage = (event.message as { role?: string; usage?: {
            input?: number;
            output?: number;
            totalTokens?: number;
          } } | undefined)?.usage;
          if (!usageEmitted && usage) {
            usageEmitted = true;
            pushEvent({
              type: 'usage',
              usage: {
                prompt_tokens: usage.input,
                completion_tokens: usage.output,
                total_tokens: usage.totalTokens,
              },
            });
          }
        }
      });

      void session.prompt(input.prompt).then(
        () => pushEvent({ type: 'done' }),
        (error: unknown) => {
          producerError = error;
          producerDone = true;
          wakeConsumer?.();
          wakeConsumer = null;
        },
      );

      while (true) {
        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          yield event;
          if (event.type === 'done') return;
        }

        if (producerDone) {
          if (input.signal.aborted) throw new Error('Pi Harness run cancelled');
          if (producerError) throw producerError;
          return;
        }

        await new Promise<void>((resolve) => {
          wakeConsumer = resolve;
        });
      }
    } finally {
      input.signal.removeEventListener('abort', abort);
      session.dispose();
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    }
  }

  private wrapTool(
    definition: ToolDefinition,
    input: CodingRunInput,
    pushEvent: (event: CodingEvent) => void,
  ): ToolDefinition {
    if (READ_ONLY_PI_TOOLS.has(definition.name)) return definition;

    return {
      ...definition,
      execute: async (toolCallId, params, signal, onUpdate, context) => {
        const normalized = normalizeApprovalDetails(definition.name, params as Record<string, unknown>);
        const summary = describeToolCall(definition.name, params as Record<string, unknown>);
        const toolInput = params as Record<string, unknown>;
        const finish = (status: 'done' | 'error', detail: string) => {
          pushEvent(toolEvent(toolCallId, definition.name, toolInput, status, detail));
        };

        pushEvent(toolEvent(
          toolCallId,
          definition.name,
          toolInput,
          'start',
          input.autoApprove ? summary : `Waiting for approval: ${summary}`,
        ));

        if (!input.autoApprove) {
          input.onApproval?.({
            id: toolCallId,
            tool: definition.name,
            summary,
            details: toolInput,
          });
          const approved = await ApprovalService.request(toolCallId);
          if (!approved) {
            finish('error', 'Declined by user');
            return {
              content: [{ type: 'text', text: `User declined ${definition.name}.` }],
              details: normalized,
            };
          }
        }

        const result = await definition.execute(toolCallId, params, signal, onUpdate, context);
        finish('done', summary);
        return result;
      },
    };
  }
}
