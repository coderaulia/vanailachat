import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { CodingEvent, CodingHarness, CodingHarnessStatus, CodingRunInput } from './codingHarness.js';

const require = createRequire(import.meta.url);

function executablePath(): string | null {
  try {
    const packagePath = require.resolve('@anthropic-ai/claude-code/package.json');
    return path.join(path.dirname(packagePath), 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  } catch {
    return null;
  }
}

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

  async status(): Promise<CodingHarnessStatus> {
    const executable = executablePath();
    if (!executable) {
      return { id: this.id, label: 'Claude Code', available: false, reason: 'Claude Code is not installed' };
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return { id: this.id, label: 'Claude Code', available: false, reason: 'Set ANTHROPIC_API_KEY to use Claude Code' };
    }
    return { id: this.id, label: 'Claude Code', available: true };
  }

  async *run(input: CodingRunInput): AsyncIterable<CodingEvent> {
    const executable = executablePath();
    if (!executable) throw new Error('Claude Code is not installed');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for Claude Code');

    const args = [
      '-p', input.prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', '12',
    ];
    if (input.mode === 'plan') args.push('--permission-mode', 'plan');
    if (input.sessionId) args.push('--resume', input.sessionId);

    const child = spawn(executable, args, {
      cwd: input.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });
    const abort = () => child.kill();
    input.signal.addEventListener('abort', abort, { once: true });

    const lines: string[] = [];
    let closed = false;
    let failure = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => lines.push(...chunk.split(/\r?\n/).filter(Boolean)));
    child.stderr.on('data', (chunk: string) => { failure += chunk; });
    child.on('close', () => { closed = true; });
    child.on('error', (error) => { failure = error.message; closed = true; });

    while (!closed || lines.length > 0) {
      const line = lines.shift();
      if (!line) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
        if (sessionId) yield { type: 'session', sessionId };
        const message = event.message as Record<string, unknown> | undefined;
        const text = textFromContent(message?.content ?? event.content);
        if (text) yield { type: 'text', text };
        if (event.type === 'tool_use' && typeof event.name === 'string') {
          yield { type: 'tool', name: event.name, input: (event.input as Record<string, unknown>) ?? {} };
        }
      } catch {
        // Claude may emit a non-JSON diagnostic; it is reported on stderr or final result.
      }
    }
    input.signal.removeEventListener('abort', abort);
    if (input.signal.aborted) throw new Error('Claude Code run cancelled');
    if (failure.trim()) throw new Error(failure.trim().slice(0, 2000));
    yield { type: 'done' };
  }
}
