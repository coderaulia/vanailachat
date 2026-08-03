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

/** Claude Code CLI adapter. The harness owns filesystem and command execution. */
export class ClaudeCodeHarness implements CodingHarness {
  readonly id = 'claude-code' as const;

  /**
   * Key from Settings first, environment second — the same order every other
   * provider uses. Reading only the environment meant the key could not be set
   * from the UI at all, and nothing in the app said where to put it.
   */
  private apiKey(): string {
    try {
      const stored = DatabaseService.getSetting('anthropic_api_key')?.trim();
      if (stored) return stored;
    } catch {
      // Database unavailable — fall through to the environment.
    }
    return process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  }

  async status(): Promise<CodingHarnessStatus> {
    if (!this.apiKey()) {
      return {
        id: this.id,
        label: 'Claude Code',
        available: false,
        reason: 'Add an Anthropic API key in Settings → AI Connection to use Claude Code',
      };
    }
    return { id: this.id, label: 'Claude Code', available: true };
  }

  async *run(input: CodingRunInput): AsyncIterable<CodingEvent> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      throw new Error('Add an Anthropic API key in Settings → AI Connection to use Claude Code');
    }

    const abortController = new AbortController();
    const abort = () => abortController.abort();
    input.signal.addEventListener('abort', abort, { once: true });
    const result = query({
      prompt: input.prompt,
      options: {
        cwd: input.cwd,
        // env REPLACES the subprocess environment rather than merging, so
        // process.env is spread to keep PATH and friends intact.
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
        resume: input.sessionId ?? undefined,
        maxTurns: 12,
        permissionMode: input.mode === 'plan' ? 'plan' : 'default',
        // Read-only exploration stays fast; edits and commands are always
        // sent through the application's existing explicit approval dialog.
        allowedTools: ['Read', 'Glob', 'Grep'],
        abortController,
        canUseTool: async (tool, toolInput) => {
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
