/**
 * Claude Code CLI / Agent SDK Adapter
 *
 * Integrated with Free Claude Code (alishahryar1/free-claude-code):
 * https://github.com/alishahryar1/free-claude-code
 *
 * Enables Claude Code to run in the browser using direct Anthropic credentials
 * OR free/local/cloud providers via the Free Claude Code compatibility proxy.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ApprovalService, describeToolCall, normalizeApprovalDetails } from './approvals.js';
import { DatabaseService } from './database.js';
import type { CodingEvent, CodingHarness, CodingHarnessStatus, CodingRunInput } from './codingHarness.js';

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === 'object')
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function getLocalBackendUrl(): string {
  try {
    const portFile = resolve(process.cwd(), '.port');
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, 'utf-8').trim();
      if (port) return `http://127.0.0.1:${port}/api/fcc`;
    }
  } catch {
    // fallback below
  }
  const port = process.env.PORT || '5173';
  return `http://127.0.0.1:${port}/api/fcc`;
}

export class ClaudeCodeHarness implements CodingHarness {
  readonly id = 'claude-code' as const;

  /**
   * Direct Anthropic API Key (if provided by user).
   */
  private directAnthropicKey(): string {
    try {
      const stored = DatabaseService.getSetting('anthropic_api_key')?.trim();
      if (stored) return stored;
    } catch {
      // Database unavailable — fall through to the environment.
    }
    return process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  }

  async status(): Promise<CodingHarnessStatus> {
    const directKey = this.directAnthropicKey();
    if (directKey) {
      return { id: this.id, label: 'Claude Code (Direct Anthropic API)', available: true };
    }

    // Default: Powered by Free Claude Code integration
    return {
      id: this.id,
      label: 'Claude Code (via Free Claude Code)',
      available: true,
    };
  }

  async *run(input: CodingRunInput): AsyncIterable<CodingEvent> {
    const directKey = this.directAnthropicKey();
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    input.signal.addEventListener('abort', abort, { once: true });

    let envConfig: Record<string, string>;

    if (directKey) {
      // Direct Anthropic API
      envConfig = {
        ...(process.env as Record<string, string>),
        ANTHROPIC_API_KEY: directKey,
      };
    } else {
      // Free Claude Code Integration Proxy
      const fccUrl =
        DatabaseService.getSetting('fcc_server_url') ||
        process.env.FCC_SERVER_URL ||
        getLocalBackendUrl();

      const model =
        input.model ||
        DatabaseService.getSetting('coding_model') ||
        'openrouter:0x-alpha/model';

      envConfig = {
        ...(process.env as Record<string, string>),
        ANTHROPIC_BASE_URL: fccUrl,
        ANTHROPIC_API_KEY: 'fcc-vanaila-proxy',
        ANTHROPIC_MODEL: model,
      };
    }

    const eventQueue: CodingEvent[] = [];
    let resolveQueue: (() => void) | null = null;
    let isDone = false;
    let queryError: unknown = null;

    const pushEvent = (evt: CodingEvent) => {
      eventQueue.push(evt);
      const wake = resolveQueue;
      resolveQueue = null;
      wake?.();
    };

    const isAutoApprove = () => {
      if (input.autoApprove === true) return true;
      try {
        return DatabaseService.getSetting('require_tool_approval') === 'false';
      } catch {
        return false;
      }
    };

    const result = query({
      prompt: input.prompt,
      options: {
        cwd: input.cwd,
        env: envConfig,
        resume: input.sessionId ?? undefined,
        maxTurns: 16,
        permissionMode: input.mode === 'plan' ? 'plan' : 'default',
        abortController,
        canUseTool: async (tool, toolInput) => {
          const norm = normalizeApprovalDetails(tool, toolInput);
          const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          // Fast read-only tools don't require user approval dialogs
          if (tool === 'Read' || tool === 'Glob' || tool === 'Grep' || tool === 'View') {
            pushEvent({
              type: 'tool',
              id: toolId,
              name: tool,
              status: 'done',
              category: 'file_read',
              file: norm.path,
              detail: norm.path ? `Read ${norm.path}` : `Inspected ${tool}`,
              input: toolInput as Record<string, unknown>,
            });
            return { behavior: 'allow', updatedInput: toolInput };
          }

          if (isAutoApprove()) {
            pushEvent({
              type: 'tool',
              id: toolId,
              name: tool,
              status: 'done',
              category: norm.category,
              file: norm.path,
              command: norm.command,
              detail: describeToolCall(tool, toolInput),
              input: toolInput as Record<string, unknown>,
            });
            return { behavior: 'allow', updatedInput: toolInput };
          }

          const id = `claude_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          input.onApproval?.({
            id,
            tool,
            summary: describeToolCall(tool, toolInput),
            details: norm,
          });

          pushEvent({
            type: 'tool',
            id: toolId,
            name: tool,
            status: 'start',
            category: norm.category,
            file: norm.path,
            command: norm.command,
            detail: `Waiting for approval: ${describeToolCall(tool, toolInput)}`,
            input: toolInput as Record<string, unknown>,
          });

          const approved = await ApprovalService.request(id);
          if (approved) {
            pushEvent({
              type: 'tool',
              id: toolId,
              name: tool,
              status: 'done',
              category: norm.category,
              file: norm.path,
              command: norm.command,
              detail: describeToolCall(tool, toolInput),
              input: toolInput as Record<string, unknown>,
            });
            return { behavior: 'allow', updatedInput: toolInput };
          } else {
            pushEvent({
              type: 'tool',
              id: toolId,
              name: tool,
              status: 'error',
              category: norm.category,
              file: norm.path,
              command: norm.command,
              detail: 'Declined by user',
              input: toolInput as Record<string, unknown>,
            });
            return { behavior: 'deny', message: 'Declined by user' };
          }
        },
      },
    });

    // Run query in background and push to eventQueue
    (async () => {
      let hasEmittedUsage = false;
      let totalTextChars = 0;
      try {
        for await (const message of result) {
          const record = message as unknown as Record<string, unknown>;
          const sessionId = typeof record.session_id === 'string' ? record.session_id : null;
          if (sessionId) pushEvent({ type: 'session', sessionId });

          // Extract token usage if provided by upstream
          const rawUsage = (record.usage || (record.message as Record<string, unknown> | undefined)?.usage) as {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
            prompt_tokens?: number;
            completion_tokens?: number;
          } | undefined;

          if (rawUsage) {
            hasEmittedUsage = true;
            pushEvent({
              type: 'usage',
              usage: {
                prompt_tokens: rawUsage.prompt_tokens ?? rawUsage.input_tokens,
                completion_tokens: rawUsage.completion_tokens ?? rawUsage.output_tokens,
                total_tokens: rawUsage.total_tokens ?? ((rawUsage.input_tokens ?? 0) + (rawUsage.output_tokens ?? 0)),
              },
            });
          }

          if (record.type === 'assistant') {
            const assistant = record.message as Record<string, unknown> | undefined;
            const text = textFromContent(assistant?.content ?? record.content ?? record.text);
            if (text) {
              totalTextChars += text.length;
              pushEvent({ type: 'text', text });
            }
          } else if (record.type === 'text' && typeof record.text === 'string' && record.text) {
            totalTextChars += record.text.length;
            pushEvent({ type: 'text', text: record.text });
          } else if (record.type === 'result' && typeof record.result === 'string' && record.result) {
            totalTextChars += record.result.length;
            pushEvent({ type: 'text', text: record.result });
          } else if (typeof record.content === 'string' && record.content) {
            totalTextChars += record.content.length;
            pushEvent({ type: 'text', text: record.content });
          }
        }

        if (!hasEmittedUsage) {
          const estPrompt = Math.ceil(input.prompt.length / 4);
          const estComp = Math.ceil(totalTextChars / 4);
          pushEvent({
            type: 'usage',
            usage: {
              prompt_tokens: estPrompt,
              completion_tokens: estComp,
              total_tokens: estPrompt + estComp,
            },
          });
        }

        pushEvent({ type: 'done' });
      } catch (error) {
        queryError = error;
      } finally {
        isDone = true;
        input.signal.removeEventListener('abort', abort);
        const wake = resolveQueue as (() => void) | null;
        resolveQueue = null;
        wake?.();
      }
    })();

    while (true) {
      while (eventQueue.length > 0) {
        const evt = eventQueue.shift()!;
        yield evt;
        if (evt.type === 'done') return;
      }

      if (isDone) {
        if (input.signal.aborted) throw new Error('Claude Code run cancelled');
        if (queryError) throw queryError;
        return;
      }

      await new Promise<void>((resolve) => {
        resolveQueue = resolve;
      });
    }
  }
}
