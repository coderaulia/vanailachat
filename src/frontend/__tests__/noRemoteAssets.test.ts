import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function files(dir: string, ext: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : files(full, ext);
    return ext.some((e) => full.endsWith(e)) ? [full] : [];
  });
}

describe('privacy-first assets', () => {
  it('loads no stylesheet or font from a remote host', () => {
    const offenders = [...files('src/frontend', ['.css']), 'index.html']
      .filter((file) => /@import\s+url\(\s*['"]?https?:|<link[^>]+href=["']https?:|src:\s*url\(\s*['"]?https?:/i.test(readFileSync(file, 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
