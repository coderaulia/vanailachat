/**
 * DeepSeek Harness Adapter
 *
 * Integrated with DeepSeek Harness (deepseek-ai/deepseek-harness):
 * https://github.com/deepseek-ai/deepseek-harness.git
 *
 * Provides autonomous coding agent execution powered by DeepSeek AI (dsh)
 * with support for CLI subprocess execution (`dsh --profile headless`) and
 * direct DeepSeek API / custom endpoint tool execution loop with interactive approvals.
 */

import { spawn } from 'node:child_process';
import { DatabaseService } from './database.js';
import { ToolService } from './tools.js';
import { ApprovalService, describeToolCall, normalizeApprovalDetails } from './approvals.js';
import type {
  CodingEvent,
  CodingHarness,
  CodingHarnessStatus,
  CodingRunInput,
} from './codingHarness.js';

const DEEPSEEK_SYSTEM_PROMPT = `You are DeepSeek Harness (dsh), an autonomous coding agent runtime developed by DeepSeek AI (https://github.com/deepseek-ai/deepseek-harness.git).
You operate inside the user's workspace repository to inspect code, run commands, create and edit files, and solve software engineering tasks.

Guidelines:
1. First inspect the relevant files in the workspace with read_file, search_files, or list_directory.
2. Present your thoughts and reasoning concisely in clean Markdown paragraphs. Do not output standalone punctuation or empty filler turns.
3. Make precise edits using edit_file for targeted changes or write_file for new files.
4. Verify changes with run_command or test suites when appropriate.
5. Provide a crisp, structured summary of what was accomplished once the task is complete.`;

const DSH_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          content: { type: 'string', description: 'The entire file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: 'Replace an exact unique string in a file with new content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          old_string: { type: 'string', description: 'Exact existing string to replace' },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List files and directories in a workspace path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative folder path (or empty for root)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: 'Search for text or regex pattern across workspace files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or regex' },
          path: { type: 'string', description: 'Optional relative directory path' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Execute a shell command in the workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command line to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_status',
      description: 'Get git status of the workspace repository.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_diff',
      description: 'Get git diff of uncommitted changes in the workspace repository.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
}

export class DeepseekHarness implements CodingHarness {
  readonly id = 'deepseek-harness' as const;

  /**
   * Resolves effective API key, base URL, and model from settings or active provider.
   * Enables DeepSeek Harness to work with zero setup via OpenRouter, Ollama, Custom API, or direct DeepSeek.
   */
  private getEffectiveConfig(inputModel?: string): {
    apiKey: string;
    baseUrl: string;
    model: string;
  } {
    // 1. Explicit DeepSeek settings
    let explicitDeepseekKey = '';
    let explicitDeepseekUrl = '';
    let explicitDeepseekModel = '';

    try {
      explicitDeepseekKey = DatabaseService.getSetting('deepseek_api_key')?.trim() ?? '';
      explicitDeepseekUrl = DatabaseService.getSetting('deepseek_base_url')?.trim() ?? '';
      explicitDeepseekModel = DatabaseService.getSetting('deepseek_model')?.trim() ?? '';
    } catch {
      // Database not ready yet
    }

    if (!explicitDeepseekKey) explicitDeepseekKey = process.env.DEEPSEEK_API_KEY?.trim() ?? '';
    if (!explicitDeepseekUrl) explicitDeepseekUrl = process.env.DEEPSEEK_BASE_URL?.trim() ?? '';
    if (!explicitDeepseekModel) explicitDeepseekModel = process.env.DEEPSEEK_DEFAULT_MODEL?.trim() ?? '';

    if (explicitDeepseekKey) {
      return {
        apiKey: explicitDeepseekKey,
        baseUrl: (explicitDeepseekUrl || 'https://api.deepseek.com').replace(/\/+$/, ''),
        model: this.cleanModel(inputModel) || explicitDeepseekModel || 'deepseek-chat',
      };
    }

    // 2. Explicit base URL without key (e.g. local Ollama / vLLM / LM Studio)
    if (explicitDeepseekUrl) {
      return {
        apiKey: 'dsh-local',
        baseUrl: explicitDeepseekUrl.replace(/\/+$/, ''),
        model: this.cleanModel(inputModel) || explicitDeepseekModel || 'deepseek-chat',
      };
    }

    // 3. Fallback to OpenRouter if connected
    let openrouterKey = '';
    let openrouterBase = '';
    try {
      openrouterKey = DatabaseService.getSetting('openrouter_api_key')?.trim() ?? '';
      openrouterBase = DatabaseService.getSetting('openrouter_base_url')?.trim() ?? '';
    } catch {
      // ignore
    }
    if (!openrouterKey) openrouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? '';
    if (!openrouterBase) openrouterBase = process.env.OPENROUTER_BASE_URL?.trim() ?? 'https://openrouter.ai/api/v1';

    if (openrouterKey) {
      let resolvedModel = this.cleanModel(inputModel) || explicitDeepseekModel || 'deepseek/deepseek-chat';
      if (!resolvedModel.includes('/')) {
        resolvedModel = `deepseek/${resolvedModel}`;
      }
      return {
        apiKey: openrouterKey,
        baseUrl: openrouterBase.replace(/\/+$/, ''),
        model: resolvedModel,
      };
    }

    // 4. Fallback to 9Router if connected
    let nineRouterKey = '';
    let nineRouterHost = '';
    try {
      nineRouterKey = DatabaseService.getSetting('nine_router_api_key')?.trim() ?? '';
      nineRouterHost = DatabaseService.getSetting('nine_router_host')?.trim() ?? '';
    } catch {
      // ignore
    }
    if (!nineRouterKey) nineRouterKey = process.env.NINE_ROUTER_API_KEY?.trim() ?? '';
    if (!nineRouterHost) nineRouterHost = process.env.NINE_ROUTER_HOST?.trim() ?? 'http://localhost:20128/v1';

    if (nineRouterKey) {
      return {
        apiKey: nineRouterKey,
        baseUrl: nineRouterHost.replace(/\/+$/, ''),
        model: this.cleanModel(inputModel) || explicitDeepseekModel || 'deepseek-chat',
      };
    }

    // 5. Fallback to Custom OpenAI endpoint if configured
    let customKey = '';
    let customBase = '';
    try {
      customKey = DatabaseService.getSetting('custom_openai_api_key')?.trim() ?? '';
      customBase = DatabaseService.getSetting('custom_openai_base_url')?.trim() ?? '';
    } catch {
      // ignore
    }
    if (!customKey) customKey = process.env.CUSTOM_OPENAI_API_KEY?.trim() ?? '';
    if (!customBase) customBase = process.env.CUSTOM_OPENAI_BASE_URL?.trim() ?? '';

    if (customBase) {
      return {
        apiKey: customKey || 'custom-key',
        baseUrl: customBase.replace(/\/+$/, ''),
        model: this.cleanModel(inputModel) || explicitDeepseekModel || 'deepseek-chat',
      };
    }

    // 6. Fallback to OpenAI API key if present
    let openaiKey = '';
    let openaiBase = '';
    try {
      openaiKey = DatabaseService.getSetting('openai_api_key')?.trim() ?? '';
      openaiBase = DatabaseService.getSetting('openai_base_url')?.trim() ?? '';
    } catch {
      // ignore
    }
    if (!openaiKey) openaiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
    if (!openaiBase) openaiBase = process.env.OPENAI_BASE_URL?.trim() ?? 'https://api.openai.com/v1';

    if (openaiKey) {
      return {
        apiKey: openaiKey,
        baseUrl: openaiBase.replace(/\/+$/, ''),
        model: this.cleanModel(inputModel) || explicitDeepseekModel || 'gpt-4o-mini',
      };
    }

    // 7. Fallback to Local Ollama
    let ollamaHost = '';
    try {
      ollamaHost = DatabaseService.getSetting('ollama_host')?.trim() ?? '';
    } catch {
      // ignore
    }
    if (!ollamaHost) ollamaHost = process.env.OLLAMA_HOST?.trim() ?? 'http://localhost:11434';

    return {
      apiKey: 'ollama',
      baseUrl: `${ollamaHost.replace(/\/+$/, '')}/v1`,
      model: this.cleanModel(inputModel) || explicitDeepseekModel || 'deepseek-coder-v2',
    };
  }

  private cleanModel(inputModel?: string): string {
    if (!inputModel || !inputModel.trim()) return '';
    return inputModel.trim().replace(/^(custom|openrouter|openai):/, '');
  }

  /**
   * Configured DSH CLI executable path (e.g. 'dsh' or 'npx @deepseek-ai/dsh').
   */
  private getDshPath(): string {
    try {
      const stored = DatabaseService.getSetting('dsh_path')?.trim();
      if (stored) return stored;
    } catch {
      // ignore
    }
    return process.env.DSH_PATH?.trim() || 'dsh';
  }

  /**
   * Configured DSH Profile (default 'headless').
   */
  private getDshProfile(): string {
    try {
      const stored = DatabaseService.getSetting('dsh_profile')?.trim();
      if (stored) return stored;
    } catch {
      // ignore
    }
    return 'headless';
  }

  async status(): Promise<CodingHarnessStatus> {
    const config = this.getEffectiveConfig();
    if (config.baseUrl.includes('openrouter')) {
      return {
        id: this.id,
        label: 'DeepSeek Harness (via OpenRouter)',
        available: true,
      };
    }

    if (config.baseUrl.includes('deepseek.com') && config.apiKey && config.apiKey !== 'dsh-local') {
      return {
        id: this.id,
        label: 'DeepSeek Harness (Direct DeepSeek AI)',
        available: true,
      };
    }

    return {
      id: this.id,
      label: 'DeepSeek Harness (deepseek-ai/deepseek-harness)',
      available: true,
    };
  }

  async *run(input: CodingRunInput): AsyncIterable<CodingEvent> {
    const sessionId = input.sessionId || `dsh_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    yield { type: 'session', sessionId };

    // Check if DSH CLI subprocess execution is configured & runnable
    const dshCmd = this.getDshPath();
    const canUseDshCli = Boolean(
      DatabaseService.getSetting('dsh_path') ||
      process.env.DSH_PATH ||
      process.env.USE_DSH_CLI === 'true'
    );

    if (canUseDshCli) {
      try {
        yield* this.runDshCli(input, dshCmd, sessionId);
        return;
      } catch (err) {
        console.warn('[DEEPSEEK HARNESS] DSH CLI execution fallback to agent loop:', err);
      }
    }

    // Default: Run built-in DeepSeek agent loop
    yield* this.runDeepseekAgentLoop(input, sessionId);
  }

  /**
   * Spawns `dsh` CLI subprocess (e.g., `dsh --profile headless "<prompt>"`).
   */
  private async *runDshCli(
    input: CodingRunInput,
    dshCmd: string,
    _sessionId: string,
  ): AsyncIterable<CodingEvent> {
    const profile = this.getDshProfile();
    const config = this.getEffectiveConfig(input.model);

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? true : false;
    const args = ['--profile', profile, input.prompt];

    const child = spawn(dshCmd, args, {
      cwd: input.cwd,
      shell,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: config.apiKey,
        DEEPSEEK_BASE_URL: config.baseUrl,
        DEEPSEEK_DEFAULT_MODEL: config.model,
      },
    });

    const abortHandler = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    };
    input.signal.addEventListener('abort', abortHandler, { once: true });

    const queue: CodingEvent[] = [];
    let resolveQueue: (() => void) | null = null;
    let finished = false;
    let childError: Error | null = null;

    const push = (evt: CodingEvent) => {
      queue.push(evt);
      const wake = resolveQueue;
      resolveQueue = null;
      wake?.();
    };

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      push({ type: 'text', text });
    });

    child.stderr.on('data', (data: Buffer) => {
      const errText = data.toString('utf-8');
      if (errText.includes('[tool]') || errText.includes('Tool:')) {
        push({
          type: 'tool',
          name: 'dsh_plugin',
          status: 'done',
          category: 'tool',
          detail: errText.trim(),
        });
      } else {
        push({ type: 'text', text: `\n${errText}` });
      }
    });

    child.on('error', (err) => {
      childError = err;
      finished = true;
      const wake = resolveQueue;
      resolveQueue = null;
      wake?.();
    });

    child.on('close', (code) => {
      if (code !== 0 && !childError) {
        childError = new Error(`DSH exited with status code ${code}`);
      }
      finished = true;
      push({ type: 'done' });
    });

    try {
      while (true) {
        while (queue.length > 0) {
          const evt = queue.shift()!;
          yield evt;
          if (evt.type === 'done') return;
        }

        if (finished) {
          if (input.signal.aborted) throw new Error('DeepSeek Harness run cancelled');
          if (childError) throw childError;
          return;
        }

        await new Promise<void>((res) => {
          resolveQueue = res;
        });
      }
    } finally {
      input.signal.removeEventListener('abort', abortHandler);
    }
  }

  /**
   * Autonomous tool-calling agent loop interacting directly with DeepSeek API.
   */
  private async *runDeepseekAgentLoop(
    input: CodingRunInput,
    _sessionId: string,
  ): AsyncIterable<CodingEvent> {
    const config = this.getEffectiveConfig(input.model);
    const apiKey = config.apiKey;
    const baseUrl = config.baseUrl;
    const model = config.model;

    if (!apiKey) {
      throw new Error(
        'No AI model provider configured for DeepSeek Harness. Please connect Ollama, OpenRouter, Custom API, or provide a DeepSeek API key in Settings.',
      );
    }

    const isAutoApprove = () => {
      if (input.autoApprove === true) return true;
      try {
        return DatabaseService.getSetting('require_tool_approval') === 'false';
      } catch {
        return false;
      }
    };

    const messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    }> = [
      { role: 'system', content: DEEPSEEK_SYSTEM_PROMPT },
      { role: 'user', content: input.prompt },
    ];

    const maxTurns = 16;
    let turn = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    const endpoint = baseUrl.endsWith('/v1')
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;

    while (turn < maxTurns) {
      if (input.signal.aborted) {
        throw new Error('DeepSeek Harness run cancelled');
      }

      turn++;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: DSH_TOOLS,
          tool_choice: 'auto',
          stream: true,
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`DeepSeek API error (HTTP ${response.status}): ${errBody || response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to read response stream from DeepSeek API');

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      const toolCallsMap: Record<number, ToolCallState> = {};

      let turnEmittedText = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(dataStr) as {
                choices?: Array<{
                  delta?: {
                    content?: string;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      type?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                }>;
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                  total_tokens?: number;
                };
              };

              if (parsed.usage) {
                if (parsed.usage.prompt_tokens) totalPromptTokens += parsed.usage.prompt_tokens;
                if (parsed.usage.completion_tokens) totalCompletionTokens += parsed.usage.completion_tokens;
                yield {
                  type: 'usage',
                  usage: {
                    prompt_tokens: totalPromptTokens,
                    completion_tokens: totalCompletionTokens,
                    total_tokens: totalPromptTokens + totalCompletionTokens,
                  },
                };
              }

              const delta = parsed.choices?.[0]?.delta;
              if (delta) {
                if (delta.content) {
                  if (turn > 1 && !turnEmittedText && assistantText === '') {
                    yield { type: 'text', text: '\n\n' };
                  }
                  turnEmittedText = true;
                  assistantText += delta.content;
                  yield { type: 'text', text: delta.content };
                }

                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallsMap[idx]) {
                      toolCallsMap[idx] = {
                        id: tc.id || `call_${Date.now()}_${idx}`,
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || '',
                      };
                    } else {
                      if (tc.id) toolCallsMap[idx].id = tc.id;
                      if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
                      if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
                    }
                  }
                }
              }
            } catch {
              // Ignore partial JSON
            }
          }
        }
      }

      const activeToolCalls = Object.values(toolCallsMap).filter((tc) => tc.name);

      if (activeToolCalls.length === 0) {
        // No tool calls requested: final turn completed
        if (totalPromptTokens === 0) {
          totalPromptTokens = Math.ceil(input.prompt.length / 4);
          totalCompletionTokens = Math.ceil(assistantText.length / 4);
          yield {
            type: 'usage',
            usage: {
              prompt_tokens: totalPromptTokens,
              completion_tokens: totalCompletionTokens,
              total_tokens: totalPromptTokens + totalCompletionTokens,
            },
          };
        }
        yield { type: 'done' };
        return;
      }

      // Record assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: assistantText || null,
        tool_calls: activeToolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      });

      // Execute tool calls sequentially
      for (const tc of activeToolCalls) {
        if (input.signal.aborted) throw new Error('DeepSeek Harness run cancelled');

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }

        const norm = normalizeApprovalDetails(tc.name, parsedArgs);
        const toolEventId = `dsh_tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const isReadOnly =
          tc.name === 'read_file' ||
          tc.name === 'list_directory' ||
          tc.name === 'search_files' ||
          tc.name === 'git_status' ||
          tc.name === 'git_diff';

        if (isReadOnly) {
          yield {
            type: 'tool',
            id: toolEventId,
            name: tc.name,
            status: 'done',
            category: norm.category,
            file: norm.path,
            detail: norm.path ? `Read ${norm.path}` : `Inspected ${tc.name}`,
            input: parsedArgs,
          };

          const toolResult = await this.executeDshTool(tc.name, parsedArgs, input.cwd);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
          continue;
        }

        // Mutating tool approval check
        if (isAutoApprove()) {
          yield {
            type: 'tool',
            id: toolEventId,
            name: tc.name,
            status: 'done',
            category: norm.category,
            file: norm.path,
            command: norm.command,
            detail: describeToolCall(tc.name, parsedArgs),
            input: parsedArgs,
          };

          const toolResult = await this.executeDshTool(tc.name, parsedArgs, input.cwd);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
          continue;
        }

        const approvalId = `dsh_appr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        input.onApproval?.({
          id: approvalId,
          tool: tc.name,
          summary: describeToolCall(tc.name, parsedArgs),
          details: norm,
        });

        yield {
          type: 'tool',
          id: toolEventId,
          name: tc.name,
          status: 'start',
          category: norm.category,
          file: norm.path,
          command: norm.command,
          detail: `Waiting for approval: ${describeToolCall(tc.name, parsedArgs)}`,
          input: parsedArgs,
        };

        const approved = await ApprovalService.request(approvalId);

        if (approved) {
          yield {
            type: 'tool',
            id: toolEventId,
            name: tc.name,
            status: 'done',
            category: norm.category,
            file: norm.path,
            command: norm.command,
            detail: describeToolCall(tc.name, parsedArgs),
            input: parsedArgs,
          };

          const toolResult = await this.executeDshTool(tc.name, parsedArgs, input.cwd);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
        } else {
          yield {
            type: 'tool',
            id: toolEventId,
            name: tc.name,
            status: 'error',
            category: norm.category,
            file: norm.path,
            command: norm.command,
            detail: 'User declined tool execution',
            input: parsedArgs,
          };

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: 'Tool execution was declined by user.',
          });
        }
      }
    }

    yield { type: 'done' };
  }

  /**
   * Helper to execute DSH tools with proper command parsing and git alias support.
   */
  private async executeDshTool(
    name: string,
    args: Record<string, unknown>,
    cwd: string,
  ): Promise<string> {
    if (name === 'git_status') {
      return await ToolService.executeTool(
        'run_command',
        { command: 'git', args: ['status', '--short'] },
        cwd,
      );
    }

    if (name === 'git_diff') {
      return await ToolService.executeTool(
        'run_command',
        { command: 'git', args: ['diff'] },
        cwd,
      );
    }

    if (name === 'run_command') {
      let commandToRun = (args.command as string) || '';
      let commandArgs = (args.args as string[]) || [];

      if (typeof commandToRun === 'string' && commandToRun.includes(' ') && commandArgs.length === 0) {
        const split = commandToRun.trim().split(/\s+/);
        commandToRun = split[0];
        commandArgs = split.slice(1);
      }

      return await ToolService.executeTool(
        'run_command',
        { command: commandToRun, args: commandArgs },
        cwd,
      );
    }

    return await ToolService.executeTool(name, args, cwd);
  }
}
