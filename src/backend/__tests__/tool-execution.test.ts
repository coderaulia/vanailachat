import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executableForPlatform, ToolService } from '../services/tools';

const temporaryFiles: string[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryFiles.splice(0).map(async (filePath) => {
      await fs.rm(filePath, { force: true });
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await fs.rm(directoryPath, { recursive: true, force: true });
    }),
  );
});

describe('tool execution', () => {
  it('reads local files within the project', async () => {
    const filePath = path.join(process.cwd(), '.tmp-tool-read.txt');
    temporaryFiles.push(filePath);
    await fs.writeFile(filePath, 'tool-content', 'utf8');

    const content = await ToolService.executeTool('read_file', { path: '.tmp-tool-read.txt' }, null);

    expect(content).toBe('tool-content');
  });

  it('blocks path traversal attempts', async () => {
    const content = await ToolService.executeTool('read_file', { path: '../outside.txt' }, null);

    expect(content).toContain('Access denied');
  });

  it('returns a clear response for unknown tools', async () => {
    const result = await ToolService.executeTool('missing_tool', {}, null);

    expect(result).toBe('Unknown tool: missing_tool');
  });

  it('advertises downloadable document generation to models', () => {
    const definitions = ToolService.getToolDefinitions() as Array<{
      function?: { name?: string; parameters?: { required?: string[] } };
    }>;
    const createDocument = definitions.find((tool) => tool.function?.name === 'create_document');

    expect(createDocument?.function?.parameters?.required).toEqual(['filename', 'content']);
  });

  it('searches files without requiring grep or rg', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanaila-search-'));
    temporaryDirectories.push(root);
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'app.ts'), 'const CrossPlatformNeedle = true;\n');
    await fs.writeFile(path.join(root, 'src', 'app.js'), 'const CrossPlatformNeedle = false;\n');

    const result = await ToolService.executeTool(
      'search_files',
      { query: 'crossplatformneedle', file_pattern: '**/*.ts' },
      root,
    );

    expect(result).toContain('src/app.ts:1');
    expect(result).not.toContain('app.js');
  });

  it('maps grep-style compatibility calls to the same Node search', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanaila-grep-'));
    temporaryDirectories.push(root);
    await fs.writeFile(path.join(root, 'notes.txt'), 'portable search value\n');

    const result = await ToolService.executeTool(
      'run_command',
      { command: 'grep', args: ['portable search', '.'] },
      root,
    );

    expect(result).toContain('notes.txt:1');
  });

  it('maps Windows and Unix file aliases to Node filesystem operations', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanaila-alias-'));
    temporaryDirectories.push(root);
    await fs.writeFile(path.join(root, 'portable.txt'), 'same on every OS\n');

    const listed = await ToolService.executeTool(
      'run_command',
      { command: 'dir', args: [] },
      root,
    );
    const readWithPowerShellAlias = await ToolService.executeTool(
      'run_command',
      { command: 'Get-Content', args: ['portable.txt'] },
      root,
    );
    const readWithUnixAlias = await ToolService.executeTool(
      'run_command',
      { command: 'cat', args: ['portable.txt'] },
      root,
    );

    expect(listed).toContain('portable.txt');
    expect(readWithPowerShellAlias).toBe('same on every OS');
    expect(readWithUnixAlias).toBe('same on every OS');
  });

  it('keeps project search inside the selected root', async () => {
    const result = await ToolService.executeTool(
      'search_files',
      { query: 'secret', path: '..' },
      process.cwd(),
    );

    expect(result).toContain('Access denied');
  });

  it('resolves npm executable names for each operating system', () => {
    expect(executableForPlatform('npm', 'win32')).toBe('npm.cmd');
    expect(executableForPlatform('npm', 'linux')).toBe('npm');
    expect(executableForPlatform('npm', 'darwin')).toBe('npm');
    expect(executableForPlatform('git', 'win32')).toBe('git');
  });

  it('blocks read_url SSRF: loopback', async () => {
    const result = await ToolService.executeTool('read_url', { url: 'http://127.0.0.1:11434/api/tags' }, null);
    expect(result).toMatch(/read_url failed.*not allowed/i);
  });

  it('blocks read_url SSRF: cloud metadata IP', async () => {
    const result = await ToolService.executeTool('read_url', { url: 'http://169.254.169.254/latest/meta-data/' }, null);
    expect(result).toMatch(/read_url failed.*not allowed/i);
  });

  it('blocks read_url SSRF: localhost hostname', async () => {
    const result = await ToolService.executeTool('read_url', { url: 'http://localhost:8080/admin' }, null);
    expect(result).toMatch(/read_url failed.*not allowed/i);
  });

  it('blocks read_url SSRF: file scheme', async () => {
    const result = await ToolService.executeTool('read_url', { url: 'file:///etc/passwd' }, null);
    expect(result).toMatch(/read_url failed.*scheme not allowed/i);
  });

  it('blocks read_url SSRF: private RFC1918 IP', async () => {
    const result = await ToolService.executeTool('read_url', { url: 'http://10.0.0.1/' }, null);
    expect(result).toMatch(/read_url failed.*not allowed/i);
  });

  it('blocks read_file symlink pointing outside project root', async () => {
    const sandboxDir = path.join(process.cwd(), '.tmp-symlink-sandbox');
    await fs.mkdir(sandboxDir, { recursive: true });
    temporaryDirectories.push(sandboxDir);

    // Create target file outside the sandbox projectRoot
    const outsideFile = path.join(process.cwd(), '.tmp-symlink-target.txt');
    await fs.writeFile(outsideFile, 'secret-content', 'utf8');
    temporaryFiles.push(outsideFile);

    // Create symlink inside sandbox projectRoot pointing to outside file
    const linkPath = path.join(sandboxDir, '.tmp-evil-symlink.txt');
    try {
      await fs.symlink(outsideFile, linkPath);
    } catch {
      // Symlink creation may fail on Windows without admin/dev mode — skip test then
      return;
    }
    temporaryFiles.push(linkPath);

    const result = await ToolService.executeTool('read_file', { path: '.tmp-evil-symlink.txt' }, sandboxDir);
    expect(result).toContain('Access denied');
    expect(result).not.toContain('secret-content');
  });
});
