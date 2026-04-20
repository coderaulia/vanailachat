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

    const content = await ToolService.executeTool('read_file', { path: '.tmp-tool-read.txt' });

    expect(content).toBe('tool-content');
  });

  it('blocks path traversal attempts', async () => {
    const content = await ToolService.executeTool('read_file', { path: '../outside.txt' });

    expect(content).toContain('Access denied');
  });

  it('returns a clear response for unknown tools', async () => {
    const result = await ToolService.executeTool('missing_tool', {});

    expect(result).toBe('Unknown tool: missing_tool');
  });
});
