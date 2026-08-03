/**
 * Human-in-the-loop gate for tool calls that change things.
 *
 * The agent loop runs inside a streaming response, which is one-way: the
 * server cannot ask the browser a question mid-stream and read the answer off
 * the same connection. So the request is emitted as a stream event, the loop
 * awaits a promise parked here, and the browser answers through a separate
 * POST that resolves it.
 *
 * Anything unanswered is denied — a request that times out, or a tab that
 * closes mid-decision, must not silently become an approval.
 */

export interface ApprovalRequest {
  id: string;
  tool: string;
  /** Human-readable summary of what will happen, shown in the UI. */
  summary: string;
  /** Tool arguments, for the detail view (file path, diff, command line). */
  details: Record<string, unknown>;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Tools that change state and therefore need a decision before running. */
const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

const pending = new Map<string, PendingApproval>();

/** Default wait before an unanswered request is denied. */
const APPROVAL_TIMEOUT_MS = 5 * 60_000;

export class ApprovalService {
  /**
   * Park the loop until the user decides. Resolves false on timeout so a
   * forgotten prompt fails closed.
   */
  static request(id: string, timeoutMs: number = APPROVAL_TIMEOUT_MS): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        console.warn(`[APPROVAL] ${id} timed out after ${timeoutMs}ms — denying`);
        resolve(false);
      }, timeoutMs);

      // Node keeps the process alive for pending timers; this one must not.
      timer.unref?.();

      pending.set(id, { resolve, timer });
    });
  }

  /** Answer a pending request. Returns false when the id is unknown or already settled. */
  static resolve(id: string, approved: boolean): boolean {
    const entry = pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(approved);
    return true;
  }

  /** Deny everything still waiting — used when a stream aborts. */
  static denyAll(ids: string[]): void {
    for (const id of ids) {
      this.resolve(id, false);
    }
  }

  static isPending(id: string): boolean {
    return pending.has(id);
  }

  /** Test seam. */
  static clear(): void {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    pending.clear();
  }
}

/** One-line description of a pending call, for the approval prompt. */
export function describeToolCall(tool: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;

  if (tool === 'write_file') {
    const content = typeof record.content === 'string' ? record.content : '';
    return `Write ${String(record.path ?? 'unknown file')} (${content.length} bytes)`;
  }

  if (tool === 'edit_file') {
    return `Edit ${String(record.path ?? 'unknown file')}`;
  }

  if (tool === 'run_command') {
    const args_ = Array.isArray(record.args) ? record.args.join(' ') : '';
    return `Run ${String(record.command ?? '')} ${args_}`.trim();
  }

  return `Run ${tool}`;
}
