import { getDb } from './connection.js';
import { generateId } from './shared.js';
import type { SkillRecord, SkillRow, UpsertSkillInput } from './types.js';

function mapSkill(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    sourceUrl: row.source_url,
    enabled: row.enabled === 1,
    installedAt: row.installed_at,
  };
}

export function listSkills(): SkillRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills ORDER BY name ASC')
    .all() as SkillRow[];
  return rows.map(mapSkill);
}

export function getSkill(id: string): SkillRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills WHERE id = ?')
    .get(id) as SkillRow | undefined;
  return row ? mapSkill(row) : null;
}

export function getSkillByName(name: string): SkillRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills WHERE name = ?')
    .get(name) as SkillRow | undefined;
  return row ? mapSkill(row) : null;
}

export function upsertSkill(input: UpsertSkillInput): SkillRecord {
  const db = getDb();
  const id = input.id ?? generateId('skill');
  db.prepare(
    `INSERT INTO skills (id, name, description, content, source_url, enabled, installed_at)
     VALUES (@id, @name, @description, @content, @source_url, @enabled, @installed_at)
     ON CONFLICT(name) DO UPDATE SET
       description = excluded.description,
       content = excluded.content,
       source_url = excluded.source_url,
       enabled = excluded.enabled`
  ).run({
    id,
    name: input.name,
    description: input.description,
    content: input.content,
    source_url: input.sourceUrl ?? null,
    enabled: input.enabled !== false ? 1 : 0,
    installed_at: Date.now(),
  });
  const saved = getSkillByName(input.name);
  if (!saved) throw new Error('Failed to save skill');
  return saved;
}

export function setSkillEnabled(id: string, enabled: boolean): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE skills SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function deleteSkill(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes > 0;
}

export function listEnabledSkills(): SkillRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, name, description, content, source_url, enabled, installed_at FROM skills WHERE enabled = 1 ORDER BY name ASC')
    .all() as SkillRow[];
  return rows.map(mapSkill);
}
