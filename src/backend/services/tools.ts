import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { SafeSearchType, search } from 'duck-duck-scrape';

const execFilePromise = promisify(execFile);

type ToolSchema = {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
};

interface Tool {
  description: string;
  execute: (args: unknown) => Promise<string>;
  name: string;
  parameters: ToolSchema;
}

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
  if (!resolvedPath.startsWith(root)) {
    throw new Error('Access denied: path outside project directory');
  }

  return resolvedPath;
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

function isAllowedCommand(command: string, args: string[]): boolean {
  if (command === 'git') {
    return args.length > 0 && (args[0] === 'log' || args[0] === 'status');
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

export class ToolService {
  private static executionRoot: string | null = null;

  private static getExecutionRoot(): string {
    const cwd = process.cwd();
    if (!this.executionRoot) {
      return cwd;
    }

    const resolvedRoot = path.resolve(cwd, this.executionRoot);
    if (!resolvedRoot.startsWith(cwd)) {
      return cwd;
    }

    return resolvedRoot;
  }

  static setExecutionRoot(projectRoot: string | null | undefined): void {
    if (!projectRoot || !projectRoot.trim()) {
      this.executionRoot = null;
      return;
    }

    this.executionRoot = projectRoot;
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
      execute: async (args: unknown) => {
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
      execute: async (args: unknown) => {
        const requestedPath = parseStringField(args, 'path');
        if (!requestedPath) {
          return 'Failed to read file: missing path';
        }

        console.log(`[TOOL] Reading file: ${requestedPath}`);

        try {
          const baseRoot = this.getExecutionRoot();
          const safePath = resolveWithinRoot(baseRoot, requestedPath);
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
      execute: async (args: unknown) => {
        const requestedPath = parseStringField(args, 'path') || '.';
        const maxDepth = Math.max(0, Math.min(6, parseNumberField(args, 'maxDepth') ?? 3));

        try {
          const baseRoot = this.getExecutionRoot();
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
      execute: async (args: unknown) => {
        const command = parseStringField(args, 'command');
        const commandArgs = parseStringArrayField(args, 'args') || [];

        if (!command) {
          return 'Command failed: missing command';
        }

        if (!isAllowedCommand(command, commandArgs)) {
          return 'Command rejected: command not on allowlist';
        }

        try {
          const baseRoot = this.getExecutionRoot();
          const { stdout, stderr } = await execFilePromise(command, commandArgs, {
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
  };

  static getToolDefinitions() {
    return Object.values(this.tools).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  static async executeTool(name: string, args: unknown): Promise<string> {
    const tool = this.tools[name];
    if (tool) {
      return tool.execute(args);
    }
    return `Unknown tool: ${name}`;
  }
}
