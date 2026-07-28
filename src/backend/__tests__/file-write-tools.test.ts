import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolService } from '../services/tools.js';

describe('write_file / edit_file', () => {
  let root: string;

  beforeEach(() => {
    // A directory well outside the app, which is exactly the case that used to
    // be silently rewritten to process.cwd().
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-proj-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes into a project root outside the app directory', async () => {
    const result = await ToolService.executeTool(
      'write_file',
      { path: 'notes/policy.md', content: '# Leave policy\n16 weeks.\n' },
      root,
    );

    expect(result).toContain('Created');
    expect(fs.readFileSync(path.join(root, 'notes', 'policy.md'), 'utf-8')).toContain('16 weeks');
  });

  it('reports an overwrite distinctly from a create', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'old');
    const result = await ToolService.executeTool('write_file', { path: 'a.txt', content: 'new' }, root);

    expect(result).toContain('Overwrote');
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf-8')).toBe('new');
  });

  it('refuses to escape the project root', async () => {
    const result = await ToolService.executeTool(
      'write_file',
      { path: '../escaped.txt', content: 'nope' },
      root,
    );

    expect(result).toMatch(/outside project directory/i);
    expect(fs.existsSync(path.join(path.dirname(root), 'escaped.txt'))).toBe(false);
  });

  it('replaces an exact unique string', async () => {
    fs.writeFileSync(path.join(root, 'config.ts'), 'const timeout = 30;\nconst retries = 3;\n');

    const result = await ToolService.executeTool(
      'edit_file',
      { path: 'config.ts', old_string: 'const timeout = 30;', new_string: 'const timeout = 60;' },
      root,
    );

    expect(result).toContain('Edited');
    const updated = fs.readFileSync(path.join(root, 'config.ts'), 'utf-8');
    expect(updated).toContain('timeout = 60');
    expect(updated).toContain('retries = 3');
  });

  it('refuses an ambiguous edit rather than guessing which site to change', async () => {
    fs.writeFileSync(path.join(root, 'dup.ts'), 'value = 1;\nvalue = 1;\n');

    const result = await ToolService.executeTool(
      'edit_file',
      { path: 'dup.ts', old_string: 'value = 1;', new_string: 'value = 2;' },
      root,
    );

    expect(result).toMatch(/appears 2 times/);
    // Nothing was written.
    expect(fs.readFileSync(path.join(root, 'dup.ts'), 'utf-8')).toBe('value = 1;\nvalue = 1;\n');
  });

  it('reports a missing target instead of creating one', async () => {
    fs.writeFileSync(path.join(root, 'x.ts'), 'hello');

    const result = await ToolService.executeTool(
      'edit_file',
      { path: 'x.ts', old_string: 'not there', new_string: 'y' },
      root,
    );

    expect(result).toMatch(/not found/i);
    expect(fs.readFileSync(path.join(root, 'x.ts'), 'utf-8')).toBe('hello');
  });

  it('rejects writes over the size ceiling', async () => {
    const result = await ToolService.executeTool(
      'write_file',
      { path: 'big.txt', content: 'x'.repeat(1024 * 1024 + 1) },
      root,
    );

    expect(result).toMatch(/exceeds/);
    expect(fs.existsSync(path.join(root, 'big.txt'))).toBe(false);
  });
});

describe('git allowlist', () => {
  it('permits read-only subcommands', async () => {
    const definitions = ToolService.getToolDefinitions() as Array<{ function?: { name?: string } }>;
    expect(definitions.map((d) => d.function?.name)).toEqual(
      expect.arrayContaining(['write_file', 'edit_file', 'run_command']),
    );

    // diff was previously rejected, which made reviewing your own changes impossible.
    const result = await ToolService.executeTool('run_command', { command: 'git', args: ['diff', '--stat'] }, null);
    expect(result).not.toMatch(/not on allowlist/);
  });

  it('still blocks history-rewriting subcommands', async () => {
    for (const args of [['commit', '-m', 'x'], ['push'], ['reset', '--hard'], ['branch', '-D', 'main']]) {
      const result = await ToolService.executeTool('run_command', { command: 'git', args }, null);
      expect(result).toMatch(/not on allowlist/);
    }
  });
});
