import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { personasContract, skillsCatalogContract } from '../../../scripts/contracts.js';

const read = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../contracts', name), 'utf-8'));

// The desktop build embeds these files. If this fails, run `pnpm contracts:update`
// and commit the result.
describe('shared data for the desktop build', () => {
  it('personas.json matches the web personas', () => {
    expect(read('personas.json')).toEqual(personasContract());
  });

  it('skills-catalog.json matches the web skills catalog', () => {
    expect(read('skills-catalog.json')).toEqual(skillsCatalogContract());
  });
});
