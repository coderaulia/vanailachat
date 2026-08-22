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
import { ApprovalService, describeToolCall } from './approvals.js';
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
        ...process.env as Record<string, string>,
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
        ...process.env as Record<string, string>,
        ANTHROPIC_BASE_URL: fccUrl,
        ANTHROPIC_API_KEY: 'fcc-vanaila-proxy',
        ANTHROPIC_MODEL: model,
      };
    }

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
          // Fast read-only tools don't require user approval dialogs
          if (tool === 'Read' || tool === 'Glob' || tool === 'Grep' || tool === 'View') {
            return { behavior: 'allow', updatedInput: toolInput };
          }
          const id = `claude_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          input.onApproval?.({
            id,
            tool,
            summary: describeToolCall(tool, toolInput),
            details: toolInput,
          });
          const approved = await ApprovalService.request(id);
          return approved
            ? { behavior: 'allow', updatedInput: toolInput }
            : { behavior: 'deny', message: 'Declined by user' };
        },
      },
    });

    for await (const message of result) {
      const record = message as unknown as Record<string, unknown>;
      const sessionId = typeof record.session_id === 'string' ? record.session_id : null;
      if (sessionId) yield { type: 'session', sessionId };
      if (record.type === 'assistant') {
        const assistant = record.message as Record<string, unknown> | undefined;
        const text = textFromContent(assistant?.content);
        if (text) yield { type: 'text', text };
      }
    }
    input.signal.removeEventListener('abort', abort);
    if (input.signal.aborted) throw new Error('Claude Code run cancelled');
    yield { type: 'done' };
  }
}
