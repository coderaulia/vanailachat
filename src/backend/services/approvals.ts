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
const MUTATING_TOOLS = new Set([
  'write_file', 'edit_file', 'run_command',
  'Bash', 'bash', 'Write', 'write', 'Edit', 'edit',
  'FileWrite', 'FileEdit', 'Replace', 'NotebookEditCell',
]);

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name) || MUTATING_TOOLS.has(name.toLowerCase());
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

export interface NormalizedApprovalDetails {
  category: 'command' | 'file_write' | 'file_edit' | 'document' | 'tool';
  command?: string;
  path?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
}

/**
 * Normalizes tool arguments across Claude Code SDK and custom agent tools
 * so the frontend UI gets uniform access to file paths, diffs, and commands.
 */
export function normalizeApprovalDetails(tool: string, args: unknown): NormalizedApprovalDetails {
  const record = (args ?? {}) as Record<string, unknown>;
  const lowerTool = tool.toLowerCase();

  // 1. Command Execution
  if (lowerTool === 'bash' || lowerTool === 'run_command' || lowerTool === 'terminal' || lowerTool === 'exec') {
    const cmdArgs = Array.isArray(record.args) ? ` ${record.args.join(' ')}` : '';
    const cmd = typeof record.command === 'string'
      ? `${record.command}${cmdArgs}`.trim()
      : typeof record.cmd === 'string'
        ? `${record.cmd}${cmdArgs}`.trim()
        : '';
    return {
      ...record,
      category: 'command',
      command: cmd,
    };
  }

  // 2. File Write / Create
  if (
    lowerTool === 'write_file' ||
    lowerTool === 'write' ||
    lowerTool === 'filewrite' ||
    lowerTool === 'create_file'
  ) {
    const filePath = String(record.path ?? record.file_path ?? record.target_file ?? record.filePath ?? 'unknown file');
    const content = typeof record.content === 'string' ? record.content : typeof record.text === 'string' ? record.text : '';
    return {
      ...record,
      category: 'file_write',
      path: filePath,
      content,
    };
  }

  // 3. File Edit / Replace
  if (
    lowerTool === 'edit_file' ||
    lowerTool === 'edit' ||
    lowerTool === 'fileedit' ||
    lowerTool === 'replace' ||
    lowerTool === 'notebookeditcell'
  ) {
    const filePath = String(record.path ?? record.file_path ?? record.target_file ?? record.filePath ?? 'unknown file');
    const oldStr = typeof record.old_string === 'string' ? record.old_string : typeof record.oldString === 'string' ? record.oldString : '';
    const newStr = typeof record.new_string === 'string' ? record.new_string : typeof record.newString === 'string' ? record.newString : '';
    const content = typeof record.content === 'string' ? record.content : undefined;
    return {
      ...record,
      category: 'file_edit',
      path: filePath,
      old_string: oldStr,
      new_string: newStr,
      ...(content ? { content } : {}),
    };
  }

  if (lowerTool === 'create_document') {
    const filename = String(record.filename ?? record.name ?? 'document.docx');
    return {
      ...record,
      category: 'document',
      path: filename,
      content: typeof record.content === 'string' ? record.content : '',
    };
  }

  return {
    ...record,
    category: 'tool',
  };
}

/** Human-readable description of a pending call for the approval prompt. */
export function describeToolCall(tool: string, args: unknown): string {
  const norm = normalizeApprovalDetails(tool, args);

  if (norm.category === 'command') {
    return norm.command ? `Run ${norm.command}` : 'Run terminal command';
  }

  if (norm.category === 'file_write') {
    const sizeStr = norm.content ? ` (${norm.content.length} bytes)` : '';
    return `Write ${norm.path ?? 'file'}${sizeStr}`;
  }

  if (norm.category === 'file_edit') {
    return `Edit ${norm.path ?? 'file'}`;
  }

  if (norm.category === 'document') {
    return `Create document: ${norm.path ?? 'document'}`;
  }

  return `Run tool: ${tool}`;
}
