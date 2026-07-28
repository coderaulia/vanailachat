import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { promisify } from 'node:util';
import { SafeSearchType, search } from 'duck-duck-scrape';
import type { Tool, ToolExecutionResult } from './toolInterface.js';
import { toToolDefinition } from './toolInterface.js';

const execFilePromise = promisify(execFile);

/** Ceiling for a single tool write, so a runaway generation cannot fill the disk. */
const MAX_WRITE_BYTES = 1024 * 1024;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function parseStringField(args: unknown, key: string): string | null {
  if (typeof args !== 'object' || args === null) {
    return null;
  }

  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function parseStringArrayField(args: unknown, key: string): string[] | null {
  if (typeof args !== 'object' || args === null) {
    return null;
  }

  const value = (args as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function parseNumberField(args: unknown, key: string): number | null {
  if (typeof args !== 'object' || args === null) {
    return null;
  }

  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveWithinRoot(root: string, requestedPath: string): string {
  const resolvedPath = path.resolve(root, requestedPath);
  if (resolvedPath !== root && !resolvedPath.startsWith(root + path.sep)) {
    throw new Error('Access denied: path outside project directory');
  }

  return resolvedPath;
}

/**
 * Resolve path within root AND realpath-check the result so symlinks pointing
 * outside the project cannot be followed. Falls back to the lexical path when
 * realpath fails (target does not exist yet) — for read_file the read will
 * then fail naturally with ENOENT.
 */
async function resolveWithinRootRealpath(root: string, requestedPath: string): Promise<string> {
  const lexical = resolveWithinRoot(root, requestedPath);

  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch {
    return lexical;
  }

  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    realRoot = root;
  }

  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error('Access denied: symlink target outside project directory');
  }

  return real;
}

function isIgnoredPath(relativePath: string, patterns: string[]): boolean {
  if (!relativePath) {
    return false;
  }

  const normalized = relativePath.replaceAll('\\', '/');
  const normalizedNoSlash = normalized.replace(/\/$/, '');

  if (normalizedNoSlash === '.git' || normalizedNoSlash.startsWith('.git/')) {
    return true;
  }

  if (normalizedNoSlash === 'node_modules' || normalizedNoSlash.startsWith('node_modules/')) {
    return true;
  }

  return patterns.some((pattern) => {
    const clean = pattern.replace(/^\//, '').replace(/\/$/, '');
    if (!clean) {
      return false;
    }

    return normalizedNoSlash === clean || normalizedNoSlash.startsWith(`${clean}/`);
  });
}

/**
 * Detect IPs that should never be reached by the agent: loopback, link-local,
 * private RFC1918, cloud metadata services, reserved ranges.
 *
 * IPv4: 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16, 172.16/12,
 *       192.168/16, 198.18/15, 224/4 (multicast), 240/4 (reserved).
 * IPv6: ::1, fc00::/7 (ULA), fe80::/10 (link-local), ::ffff:* (IPv4-mapped).
 */
function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
        lower.startsWith('fea') || lower.startsWith('feb')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice(7);
      if (net.isIP(mapped) === 4) return isBlockedIp(mapped);
    }
    return false;
  }
  return false;
}

/**
 * Validate an outbound URL: scheme must be http(s), hostname must not resolve
 * to a blocked IP range. Mitigates SSRF (cloud metadata, internal services,
 * Ollama, etc.).
 */
async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`scheme not allowed: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) throw new Error('missing hostname');

  // Reject localhost aliases explicitly
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.localhost') ||
      lowered === 'metadata' || lowered === 'metadata.google.internal') {
    throw new Error('hostname not allowed');
  }

  // If literal IP, check directly
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error(`IP not allowed: ${hostname}`);
    return;
  }

  // Otherwise resolve DNS and check every returned address
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`DNS resolution failed for ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`hostname resolves to blocked IP: ${address}`);
    }
  }
}

function isAllowedCommand(command: string, args: string[]): boolean {
  if (command === 'git') {
    // Read-only subcommands only. Anything that rewrites history, moves refs,
    // or touches the network (commit, push, reset, checkout, clean) stays out
    // until there is an approval prompt in front of it.
    const READ_ONLY_GIT = ['log', 'status', 'diff', 'show', 'branch', 'blame', 'ls-files'];
    if (args.length === 0) return false;
    if (!READ_ONLY_GIT.includes(args[0])) return false;
    // `git branch -D name` deletes; only the plain listing form is allowed.
    if (args[0] === 'branch' && args.some((arg) => arg.startsWith('-') && arg !== '-a' && arg !== '-v')) {
      return false;
    }
    return true;
  }

  if (command === 'npm') {
    if (args.length === 1 && args[0] === 'test') {
      return true;
    }

    return args.length === 2 && args[0] === 'run' && args[1] === 'lint';
  }

  if (command === 'cat' || command === 'ls') {
    return true;
  }

  return false;
}

/**
 * Native stand-in for `cat` and `ls`. Both are coreutils, so shelling out to
 * them only works on Unix; reading through fs keeps run_command identical
 * across platforms and avoids depending on whatever is on PATH.
 */
async function readWithFs(
  command: 'cat' | 'ls',
  args: string[],
  baseRoot: string,
): Promise<string> {
  const paths = args.filter((arg) => !arg.startsWith('-'));
  const targets = paths.length > 0 ? paths : ['.'];

  const sections = await Promise.all(
    targets.map(async (target) => {
      const safePath = await resolveWithinRootRealpath(baseRoot, target);
      if (command === 'cat') {
        return await fs.readFile(safePath, 'utf-8');
      }
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        .sort((a, b) => a.localeCompare(b))
        .join('\n');
    }),
  );

  return sections.join('\n').trim() || 'Command completed with no output';
}

export class ToolService {
  /**
   * Resolve the directory tools operate in.
   *
   * projectRoot comes from the chat record — the user typed it into the
   * project-root field — so an absolute path outside the app is honoured.
   * Previously anything outside process.cwd() was silently rewritten to the
   * app's own directory, which meant the tools could only ever read the chat
   * app itself, never the repo the user was actually asking about.
   *
   * This is not a hole for the model to widen: tool arguments are still
   * confined to whatever root resolves here (resolveWithinRootRealpath), and
   * the model cannot choose the root.
   */
  private static getExecutionRoot(projectRoot: string | null): string {
    const cwd = process.cwd();
    if (!projectRoot || !projectRoot.trim()) {
      return cwd;
    }

    const resolvedRoot = path.resolve(cwd, projectRoot);

    // A root that does not exist (typo, stale path from another machine) falls
    // back to cwd rather than failing every tool call with ENOENT.
    try {
      if (!statSync(resolvedRoot).isDirectory()) {
        return cwd;
      }
    } catch {
      return cwd;
    }

    return resolvedRoot;
  }

  private static tools: Record<string, Tool> = {
    search_web: {
      name: 'search_web',
      description: 'Search the web for real-time information using DuckDuckGo',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
      execute: async (args: unknown, _projectRoot: string | null) => {
        const query = parseStringField(args, 'query');
        if (!query) {
          return 'Search failed: missing query';
        }

        console.log(`[TOOL] Searching web for: ${query}`);

        try {
          const results = await search(query, { safeSearch: SafeSearchType.MODERATE });
          return JSON.stringify(
            (results.results || []).slice(0, 5).map((result) => ({
              title: result.title,
              url: result.url,
              description: result.description,
            }))
          );
        } catch (error) {
          return `Search failed: ${getErrorMessage(error)}`;
        }
      },
    },
    read_url: {
      name: 'read_url',
      description: 'Fetch and extract readable text from a web page URL. Use after search_web to read the full content of a result.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch and read' },
          max_chars: { type: 'number', description: 'Max characters to return (default 8000)' },
        },
        required: ['url'],
      },
      timeoutMs: 20_000,
      execute: async (args: unknown, _projectRoot: string | null) => {
        const url = parseStringField(args, 'url');
        const maxChars = parseNumberField(args, 'max_chars') ?? 8000;
        if (!url) return 'read_url failed: missing url';

        console.log(`[TOOL] Reading URL: ${url}`);

        try {
          await assertSafeOutboundUrl(url);

          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; VanailaChat/1.0; +research-agent)',
              'Accept': 'text/html,text/plain',
            },
            redirect: 'manual',
          });

          if (response.status >= 300 && response.status < 400) {
            return `read_url failed: redirect to ${response.headers.get('location') ?? 'unknown'} not followed (SSRF protection)`;
          }

          if (!response.ok) {
            return `HTTP ${response.status}: ${response.statusText}`;
          }

          const contentType = response.headers.get('content-type') ?? '';
          const text = await response.text();

          // Strip HTML tags and clean up whitespace
          let content: string;
          if (contentType.includes('text/html')) {
            content = text
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s{2,}/g, ' ')
              .trim();
          } else {
            content = text;
          }

          return content.slice(0, maxChars);
        } catch (error) {
          return `read_url failed: ${getErrorMessage(error)}`;
        }
      },
    },
    read_file: {
      name: 'read_file',
      description: 'Read the contents of a local file in the current project',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['path'],
      },
      execute: async (args: unknown, projectRoot: string | null) => {
        const requestedPath = parseStringField(args, 'path');
        if (!requestedPath) {
          return 'Failed to read file: missing path';
        }

        console.log(`[TOOL] Reading file: ${requestedPath}`);

        try {
          const baseRoot = this.getExecutionRoot(projectRoot);
          const safePath = await resolveWithinRootRealpath(baseRoot, requestedPath);
          return await fs.readFile(safePath, 'utf-8');
        } catch (error) {
          return `Failed to read file: ${getErrorMessage(error)}`;
        }
      },
    },
    list_directory: {
      name: 'list_directory',
      description: 'List files and folders in a directory recursively up to a depth limit',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to list' },
          maxDepth: { type: 'number', description: 'Maximum recursion depth (default 3)' },
        },
        required: [],
      },
      execute: async (args: unknown, projectRoot: string | null) => {
        const requestedPath = parseStringField(args, 'path') || '.';
        const maxDepth = Math.max(0, Math.min(6, parseNumberField(args, 'maxDepth') ?? 3));

        try {
          const baseRoot = this.getExecutionRoot(projectRoot);
          const targetPath = resolveWithinRoot(baseRoot, requestedPath);
          const gitignorePath = path.join(baseRoot, '.gitignore');

          let ignorePatterns: string[] = [];
          try {
            const gitignore = await fs.readFile(gitignorePath, 'utf-8');
            ignorePatterns = gitignore
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));
          } catch {
            // No .gitignore found.
          }

          const treeLines: string[] = [];

          const walk = async (directoryPath: string, depth: number, indent: string) => {
            const entries = await fs.readdir(directoryPath, { withFileTypes: true });
            entries.sort((a, b) => a.name.localeCompare(b.name));

            for (const entry of entries) {
              const absoluteEntryPath = path.join(directoryPath, entry.name);
              const relativeEntryPath = path.relative(baseRoot, absoluteEntryPath);

              if (isIgnoredPath(relativeEntryPath, ignorePatterns)) {
                continue;
              }

              const linePrefix = indent ? `${indent}- ` : '- ';
              treeLines.push(`${linePrefix}${entry.name}${entry.isDirectory() ? '/' : ''}`);

              if (entry.isDirectory() && depth < maxDepth) {
                await walk(absoluteEntryPath, depth + 1, `${indent}  `);
              }
            }
          };

          const rootLabel = path.relative(baseRoot, targetPath) || '.';
          treeLines.push(`${rootLabel}/`);
          await walk(targetPath, 0, '');

          return treeLines.join('\n');
        } catch (error) {
          return `Failed to list directory: ${getErrorMessage(error)}`;
        }
      },
    },
    run_command: {
      name: 'run_command',
      description: 'Run a safe allowlisted command in the project root',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command executable name (git, npm, cat, ls)' },
          args: { type: 'array', description: 'Command arguments as array of strings' },
        },
        required: ['command'],
      },
      execute: async (args: unknown, projectRoot: string | null) => {
        const command = parseStringField(args, 'command');
        const commandArgs = parseStringArrayField(args, 'args') || [];

        if (!command) {
          return 'Command failed: missing command';
        }

        if (!isAllowedCommand(command, commandArgs)) {
          return 'Command rejected: command not on allowlist';
        }

        try {
          const baseRoot = this.getExecutionRoot(projectRoot);

          // cat/ls are coreutils and do not exist on Windows. Serve them from
          // fs so the allowlist behaves identically on every platform.
          if (command === 'cat' || command === 'ls') {
            return await readWithFs(command, commandArgs, baseRoot);
          }

          // npm ships as npm.cmd on Windows and Node refuses to execFile a
          // .cmd without a shell. Passed as a single command line because
          // isAllowedCommand restricts npm's arguments to the fixed literals
          // "test" and "run lint" — nothing here is caller-controlled.
          const { stdout, stderr } =
            process.platform === 'win32' && command === 'npm'
              ? await execFilePromise(`npm.cmd ${commandArgs.join(' ')}`, {
                  cwd: baseRoot,
                  maxBuffer: 1024 * 1024,
                  shell: true,
                })
              : await execFilePromise(command, commandArgs, {
                  cwd: baseRoot,
                  maxBuffer: 1024 * 1024,
                });

          return [stdout, stderr].filter(Boolean).join('\n').trim() || 'Command completed with no output';
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'stderr' in error) {
            const stderr = String((error as { stderr?: unknown }).stderr || '').trim();
            if (stderr) {
              return `Command failed: ${stderr}`;
            }
          }

          return `Command failed: ${getErrorMessage(error)}`;
        }
      },
    },
    write_file: {
      name: 'write_file',
      description:
        'Create a file or replace its entire contents, relative to the project root. Use edit_file for a targeted change to an existing file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the project root' },
          content: { type: 'string', description: 'Full file contents to write' },
        },
        required: ['path', 'content'],
      },
      execute: async (args: unknown, projectRoot: string | null) => {
        const requestedPath = parseStringField(args, 'path');
        const content = parseStringField(args, 'content');

        if (!requestedPath) return 'Write failed: missing path';
        if (content === null) return 'Write failed: missing content';
        if (content.length > MAX_WRITE_BYTES) {
          return `Write failed: content exceeds ${MAX_WRITE_BYTES} bytes`;
        }

        try {
          const baseRoot = this.getExecutionRoot(projectRoot);
          const safePath = await resolveWithinRootRealpath(baseRoot, requestedPath);

          const existed = await fs
            .stat(safePath)
            .then(() => true)
            .catch(() => false);

          await fs.mkdir(path.dirname(safePath), { recursive: true });
          await fs.writeFile(safePath, content, 'utf-8');

          const relative = path.relative(baseRoot, safePath);
          console.log(`[TOOL] ${existed ? 'Overwrote' : 'Created'} ${relative}`);
          return `${existed ? 'Overwrote' : 'Created'} ${relative} (${content.length} bytes)`;
        } catch (error) {
          return `Write failed: ${getErrorMessage(error)}`;
        }
      },
    },
    edit_file: {
      name: 'edit_file',
      description:
        'Replace an exact string in an existing file. The old_string must appear exactly once, so include enough surrounding context to be unambiguous.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the project root' },
          old_string: { type: 'string', description: 'Exact text to replace, including indentation' },
          new_string: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
      execute: async (args: unknown, projectRoot: string | null) => {
        const requestedPath = parseStringField(args, 'path');
        const oldString = parseStringField(args, 'old_string');
        const newString = parseStringField(args, 'new_string');

        if (!requestedPath) return 'Edit failed: missing path';
        if (!oldString) return 'Edit failed: missing old_string';
        if (newString === null) return 'Edit failed: missing new_string';

        try {
          const baseRoot = this.getExecutionRoot(projectRoot);
          const safePath = await resolveWithinRootRealpath(baseRoot, requestedPath);
          const original = await fs.readFile(safePath, 'utf-8');

          // Ambiguity here means silently editing the wrong line, so it is an
          // error rather than a first-match replacement.
          const occurrences = original.split(oldString).length - 1;
          if (occurrences === 0) {
            return `Edit failed: old_string not found in ${requestedPath}`;
          }
          if (occurrences > 1) {
            return `Edit failed: old_string appears ${occurrences} times in ${requestedPath}; include more surrounding context to make it unique`;
          }

          const updated = original.replace(oldString, newString);
          if (updated.length > MAX_WRITE_BYTES) {
            return `Edit failed: result exceeds ${MAX_WRITE_BYTES} bytes`;
          }

          await fs.writeFile(safePath, updated, 'utf-8');

          const relative = path.relative(baseRoot, safePath);
          console.log(`[TOOL] Edited ${relative}`);
          return `Edited ${relative} (${oldString.length} -> ${newString.length} bytes at one site)`;
        } catch (error) {
          return `Edit failed: ${getErrorMessage(error)}`;
        }
      },
    },
    load_skill: {
      name: 'load_skill',
      description:
        'Load the full instructions for one of the skills listed under [Available Skills] in the system prompt. Call this before acting on a skill — the system prompt only lists names and summaries.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name exactly as listed under [Available Skills]' },
        },
        required: ['name'],
      },
      execute: async (args: unknown) => {
        const name = parseStringField(args, 'name');
        if (!name) {
          return 'Failed to load skill: missing name';
        }

        try {
          const { DatabaseService } = await import('./database.js');
          const enabled = DatabaseService.listEnabledSkills();
          const match =
            enabled.find((skill) => skill.name === name) ??
            enabled.find((skill) => skill.name.toLowerCase() === name.toLowerCase());

          if (!match) {
            const available = enabled.map((skill) => skill.name).join(', ') || 'none';
            return `Skill '${name}' is not enabled. Available skills: ${available}`;
          }

          console.log(`[TOOL] Loading skill: ${match.name} (${match.content.length} chars)`);
          return `[Skill: ${match.name}]\n${match.content}`;
        } catch (error) {
          return `Failed to load skill: ${getErrorMessage(error)}`;
        }
      },
    },
  };

  static getToolDefinitions() {
    return Object.values(this.tools).map(toToolDefinition);
  }

  /**
   * Execute a tool with timeout protection.
   * Wraps execution with a configurable timeout and duration tracking.
   */
  static async executeTool(
    name: string,
    args: unknown,
    projectRoot: string | null,
  ): Promise<string> {
    const tool = this.tools[name];
    if (!tool) {
      return `Unknown tool: ${name}`;
    }

    const timeoutMs = tool.timeoutMs ?? 30_000;

    try {
      const result = await Promise.race([
        tool.execute(args, projectRoot),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return result;
    } catch (error) {
      return `Tool failed: ${getErrorMessage(error)}`;
    }
  }

  /**
   * Execute with full result metadata (for agent loop debugging).
   */
  static async executeToolWithResult(
    name: string,
    args: unknown,
    projectRoot: string | null,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools[name];
    if (!tool) {
      return { success: false, output: `Unknown tool: ${name}`, durationMs: 0, toolName: name };
    }

    const timeoutMs = tool.timeoutMs ?? 30_000;
    const start = performance.now();

    try {
      const output = await Promise.race([
        tool.execute(args, projectRoot),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return {
        success: true,
        output,
        durationMs: Math.round(performance.now() - start),
        toolName: name,
      };
    } catch (error) {
      return {
        success: false,
        output: `Tool failed: ${getErrorMessage(error)}`,
        durationMs: Math.round(performance.now() - start),
        toolName: name,
      };
    }
  }

  /** Register an external/custom tool at runtime */
  static registerTool(tool: Tool): void {
    this.tools[tool.name] = tool;
  }

  /** Remove a tool by name */
  static unregisterTool(name: string): void {
    delete this.tools[name];
  }

  /** List all registered tool names */
  static getToolNames(): string[] {
    return Object.keys(this.tools);
  }
}
