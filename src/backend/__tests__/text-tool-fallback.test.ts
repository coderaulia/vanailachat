import { describe, expect, it } from 'vitest';
import {
  isProjectInspectionPreamble,
  parseTextReadToolCalls,
} from '../services/textToolFallback.js';

const ROOT = 'C:\\Users\\Administrator\\Documents\\atelier';

describe('textual read-tool fallback parser', () => {
  it('recognizes repeated ls output from a model', () => {
    expect(parseTextReadToolCalls('Let me explore systematically.\n\nls -la ls -la', ROOT)).toEqual([
      { name: 'list_directory', args: { path: '.', maxDepth: 3 } },
    ]);
  });

  it('extracts files from flattened cd and cat chains', () => {
    const content =
      `cd "${ROOT}" && cat package.json cd "${ROOT}" && cat CLAUDE.md ` +
      `cd "${ROOT}" && cat CONTEXT.md`;

    expect(parseTextReadToolCalls(content, ROOT)).toEqual([
      { name: 'read_file', args: { path: 'package.json' } },
      { name: 'read_file', args: { path: 'CLAUDE.md' } },
      { name: 'read_file', args: { path: 'CONTEXT.md' } },
    ]);
  });

  it('does not interpret ordinary prose as commands', () => {
    expect(parseTextReadToolCalls('The cat package is unrelated and the directory is clean.', ROOT)).toEqual([]);
  });

  it('converts absolute paths inside the selected root to relative paths', () => {
    expect(parseTextReadToolCalls(`cat "${ROOT}\\package.json"`, ROOT)).toEqual([
      { name: 'read_file', args: { path: 'package.json' } },
    ]);
  });

  it('maps Unix grep and rg commands to search_files', () => {
    expect(parseTextReadToolCalls('grep -R "needle" src', ROOT)).toEqual([
      { name: 'search_files', args: { query: 'needle', path: 'src' } },
    ]);
    expect(parseTextReadToolCalls('rg -g "*.ts" "needle" src', ROOT)).toEqual([
      {
        name: 'search_files',
        args: { query: 'needle', path: 'src', file_pattern: '*.ts' },
      },
    ]);
  });

  it('maps PowerShell search output to search_files', () => {
    expect(
      parseTextReadToolCalls('Select-String -Path "src\\*.ts" -Pattern "needle"', ROOT),
    ).toEqual([
      {
        name: 'search_files',
        args: { query: 'needle', path: '.', file_pattern: 'src/*.ts' },
      },
    ]);
  });

  it('recognizes a tool-use announcement that contains no actual tool call', () => {
    expect(
      isProjectInspectionPreamble(
        '<think></think>Let me use the proper tools to read the key files.',
      ),
    ).toBe(true);
    expect(isProjectInspectionPreamble('The bug is caused by a missing null check.')).toBe(false);
  });
});
