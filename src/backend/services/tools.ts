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
import { generateDocument } from './generatedDocuments.js';

const execFilePromise = promisify(execFile);

/** Ceiling for a single tool write, so a runaway generation cannot fill the disk. */
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_OUTPUT_CHARS = 40_000;

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

function parseBooleanField(args: unknown, key: string): boolean | null {
  if (typeof args !== 'object' || args === null) return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinPath(root: string, candidate: string): boolean {
  const comparableRoot = comparablePath(root);
  const comparableCandidate = comparablePath(candidate);
  return (
    comparableCandidate === comparableRoot ||
    comparableCandidate.startsWith(comparableRoot + path.sep)
  );
}

function resolveWithinRoot(root: string, requestedPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, requestedPath);
  if (!isWithinPath(resolvedRoot, resolvedPath)) {
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

  if (!isWithinPath(realRoot, real)) {
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

    if (clean.includes('*') || clean.includes('?')) {
      const target = clean.includes('/') ? normalizedNoSlash : path.basename(normalizedNoSlash);
      return globRegex(clean).test(target);
    }

    return normalizedNoSlash === clean || normalizedNoSlash.startsWith(`${clean}/`);
  });
}

async function getIgnorePatterns(root: string): Promise<string[]> {
  try {
    return (await fs.readFile(path.join(root, '.gitignore'), 'utf-8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));
  } catch {
    return [];
  }
}

function globRegex(pattern: string): RegExp {
  const normalized = pattern.replaceAll('\\', '/');
  let expression = '^';
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    if (char === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index++;
      }
    } else if (char === '*') {
      expression += '[^/]*';
    } else if (char === '?') {
      expression += '[^/]';
    } else {
      expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(expression + '$', 'i');
}

async function searchFilesWithFs(options: {
  baseRoot: string;
  query: string;
  requestedPath: string;
  filePattern: string | null;
  caseSensitive: boolean;
  maxResults: number;
}): Promise<string> {
  const { baseRoot, query, requestedPath, filePattern, caseSensitive, maxResults } = options;
  const targetPath = await resolveWithinRootRealpath(baseRoot, requestedPath);
  const ignorePatterns = await getIgnorePatterns(baseRoot);
  const patternRegex = filePattern ? globRegex(filePattern) : null;
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: string[] = [];

  const inspectFile = async (filePath: string) => {
    if (matches.length >= maxResults) return;
    const relative = path.relative(baseRoot, filePath).replaceAll('\\', '/');
    const patternTarget = filePattern?.includes('/') ? relative : path.basename(relative);
    if (patternRegex && !patternRegex.test(patternTarget)) return;

    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || stats.size > MAX_SEARCH_FILE_BYTES) return;
      const bytes = await fs.readFile(filePath);
      if (bytes.subarray(0, 8192).includes(0)) return;
      const lines = bytes.toString('utf-8').split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < maxResults; index++) {
        const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
        if (haystack.includes(needle)) {
          matches.push(`${relative}:${index + 1}: ${lines[index].slice(0, 500)}`);
        }
      }
    } catch {
      // A file can disappear or become unreadable during a recursive scan.
    }
  };

  const walk = async (currentPath: string): Promise<void> => {
    if (matches.length >= maxResults) return;
    const stats = await fs.stat(currentPath);
    if (stats.isFile()) {
      await inspectFile(currentPath);
      return;
    }
    if (!stats.isDirectory()) return;

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (matches.length >= maxResults) break;
      const absolute = path.join(currentPath, entry.name);
      const relative = path.relative(baseRoot, absolute);
      if (isIgnoredPath(relative, ignorePatterns)) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) await inspectFile(absolute);
      // Symlinks are deliberately not followed.
    }
  };

  await walk(targetPath);
  if (matches.length === 0) {
    return `No matches for ${JSON.stringify(query)} under ${requestedPath}`;
  }
  return matches.join('\n').slice(0, MAX_SEARCH_OUTPUT_CHARS);
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
  command = command.toLowerCase();
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

  if (
    ['cat', 'type', 'get-content', 'ls', 'dir', 'get-childitem', 'grep', 'rg', 'select-string', 'findstr']
      .includes(command)
  ) {
    return true;
  }

  return false;
}

/**
 * Platform-independent stand-in for shell-style read and list aliases.
 */
async function readWithFs(
  command: 'cat' | 'ls',
  args: string[],
  baseRoot: string,
): Promise<string> {
  const paths = args.filter((arg) => !arg.startsWith('-') && !/^\/[A-Za-z]+$/.test(arg));
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

export function executableForPlatform(command: string, platform: NodeJS.Platform): string {
  return platform === 'win32' && command.toLowerCase() === 'npm' ? 'npm.cmd' : command;
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
    search_files: {
      name: 'search_files',
      description:
        'Search text inside project files using a platform-independent filesystem scan. Use this instead of grep, rg, findstr, or Select-String.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Plain text to find' },
          path: { type: 'string', description: 'Relative file or directory to search (default: .)' },
          file_pattern: { type: 'string', description: 'Optional glob such as *.ts or src/**/*.tsx' },
          case_sensitive: { type: 'boolean', description: 'Use case-sensitive matching (default: false)' },
          max_results: { type: 'number', description: 'Maximum matching lines, 1-200 (default: 100)' },
        },
        required: ['query'],
      },
      execute: async (args: unknown, projectRoot: string | null) => {
        const query = parseStringField(args, 'query');
        if (!query) return 'Search failed: missing query';

        try {
          return await searchFilesWithFs({
            baseRoot: this.getExecutionRoot(projectRoot),
            query,
            requestedPath: parseStringField(args, 'path') || '.',
            filePattern: parseStringField(args, 'file_pattern'),
            caseSensitive: parseBooleanField(args, 'case_sensitive') ?? false,
            maxResults: Math.max(1, Math.min(200, parseNumberField(args, 'max_results') ?? 100)),
          });
        } catch (error) {
          return `Search failed: ${getErrorMessage(error)}`;
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
          const targetPath = await resolveWithinRootRealpath(baseRoot, requestedPath);
          const ignorePatterns = await getIgnorePatterns(baseRoot);

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
      description:
        'Run an allowlisted Git or npm command. For files, use list_directory, read_file, and search_files instead of OS shell commands.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command executable name (git or npm)' },
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
          const normalizedCommand = command.toLowerCase();

          // Shell-style read aliases are implemented with Node filesystem
          // APIs, so their native executables are never required.
          if (['cat', 'type', 'get-content'].includes(normalizedCommand)) {
            return await readWithFs('cat', commandArgs, baseRoot);
          }
          if (['ls', 'dir', 'get-childitem'].includes(normalizedCommand)) {
            return await readWithFs('ls', commandArgs, baseRoot);
          }
          if (['grep', 'rg', 'select-string', 'findstr'].includes(normalizedCommand)) {
            const operands = commandArgs.filter((arg) => !arg.startsWith('-') && !arg.startsWith('/'));
            const query = operands[0];
            if (!query) return 'Search failed: missing query';
            return await searchFilesWithFs({
              baseRoot,
              query,
              requestedPath: operands[1] && !operands[1].includes('*') ? operands[1] : '.',
              filePattern: operands[1]?.includes('*') ? operands[1] : null,
              caseSensitive: false,
              maxResults: 100,
            });
          }

          // npm ships as npm.cmd on Windows; only fixed allowlisted arguments
          // reach the platform-specific executable below.
          const executable = executableForPlatform(normalizedCommand, process.platform);
          const { stdout, stderr } = await execFilePromise(executable, commandArgs, {
            cwd: baseRoot,
            maxBuffer: 1024 * 1024,
            shell: process.platform === 'win32' && executable.endsWith('.cmd'),
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
    create_document: {
      name: 'create_document',
      description:
        'Create a real downloadable Microsoft Word .docx file on the application server. Use this whenever the user asks to generate, export, save, or download a document. Never claim a document exists without calling this tool.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Download filename, ending in .docx' },
          content: { type: 'string', description: 'Complete document text. Markdown headings and bullets are converted to Word formatting.' },
        },
        required: ['filename', 'content'],
      },
      timeoutMs: 30_000,
      execute: async (args: unknown) => {
        const filename = parseStringField(args, 'filename');
        const content = parseStringField(args, 'content');
        if (!filename) return 'Document creation failed: missing filename';
        if (content === null) return 'Document creation failed: missing content';

        try {
          const generated = await generateDocument(filename, content);
          console.log(`[TOOL] Generated downloadable document: ${generated.name}`);
          return JSON.stringify(generated);
        } catch (error) {
          return `Document creation failed: ${getErrorMessage(error)}`;
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
