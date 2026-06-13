import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolService } from '../services/tools';

const temporaryFiles: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryFiles.splice(0).map(async (filePath) => {
      await fs.rm(filePath, { force: true });
    })
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
    // Create target file outside project
    const outsideFile = path.join(process.cwd(), '..', '.tmp-symlink-target.txt');
    await fs.writeFile(outsideFile, 'secret-content', 'utf8');
    temporaryFiles.push(outsideFile);

    // Create symlink inside project pointing to outside file
    const linkPath = path.join(process.cwd(), '.tmp-evil-symlink.txt');
    try {
      await fs.symlink(outsideFile, linkPath);
    } catch {
      // Symlink creation may fail on Windows without admin/dev mode — skip test then
      return;
    }
    temporaryFiles.push(linkPath);

    const result = await ToolService.executeTool('read_file', { path: '.tmp-evil-symlink.txt' }, null);
    expect(result).toContain('Access denied');
    expect(result).not.toContain('secret-content');
  });
});
