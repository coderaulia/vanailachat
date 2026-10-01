/**
 * Regenerates the shared data files the desktop (Rust) build embeds from the
 * web backend's source of truth. Run with `pnpm contracts:update` after
 * editing personas or the skills catalog.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { personasContract, skillsCatalogContract } from './contracts.js';

const root = resolve(import.meta.dirname, '..', 'contracts');
writeFileSync(resolve(root, 'personas.json'), JSON.stringify(personasContract(), null, 2) + '\n');
writeFileSync(resolve(root, 'skills-catalog.json'), JSON.stringify(skillsCatalogContract(), null, 2) + '\n');
console.log('Wrote contracts/personas.json and contracts/skills-catalog.json');
