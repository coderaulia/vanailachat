import { getDb } from './connection.js';
import { DEFAULT_PROJECT_NAME, generateId, normalizeTimestamp } from './shared.js';
import type { CreateProjectInput, ProjectRecord, ProjectRow, UpdateProjectInput } from './types.js';

export function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    instructions: row.instructions ?? null,
    memory: row.memory ?? null,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
  };
}

export function ensureDefaultProject(): ProjectRecord {
  const db = getDb();
  const existing = db
    .prepare('SELECT id, name, description, instructions, memory, created_at FROM projects ORDER BY created_at ASC LIMIT 1')
    .get() as ProjectRow | undefined;

  if (existing) {
    return mapProject(existing);
  }

  const project: ProjectRow = {
    id: generateId('project'),
    name: DEFAULT_PROJECT_NAME,
    description: null,
    instructions: null,
    memory: null,
    pinned: 0,
    created_at: Date.now(),
  };

  db.prepare('INSERT INTO projects (id, name, description, instructions, memory, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    project.id,
    project.name,
    project.description,
    project.instructions,
    project.memory,
    project.pinned,
    project.created_at
  );

  return mapProject(project);
}

export function listProjects(): ProjectRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, name, description, instructions, memory, pinned, created_at FROM projects ORDER BY created_at ASC')
    .all() as ProjectRow[];

  return rows.map((row) => mapProject(row));
}

export function createProject(input: CreateProjectInput): ProjectRecord {
  const db = getDb();
  const name = input.name.trim();
  if (!name) {
    throw new Error('Project name cannot be empty');
  }

  const project = {
    id: input.id && input.id.trim() ? input.id : generateId('project'),
    name,
    description: input.description ?? null,
    instructions: input.instructions ?? null,
    memory: input.memory ?? null,
    pinned: input.pinned ? 1 : 0,
    created_at: normalizeTimestamp(input.createdAt),
  };

  db.prepare('INSERT INTO projects (id, name, description, instructions, memory, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    project.id,
    project.name,
    project.description,
    project.instructions,
    project.memory,
    project.pinned,
    project.created_at
  );

  return mapProject(project);
}

export function getProject(id: string): ProjectRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT id, name, description, instructions, memory, pinned, created_at FROM projects WHERE id = ?')
    .get(id) as ProjectRow | undefined;

  return row ? mapProject(row) : null;
}

export function updateProject(id: string, input: UpdateProjectInput): ProjectRecord {
  const db = getDb();
  const existing = getProject(id);
  if (!existing) {
    throw new Error('Project not found');
  }

  const name = input.name?.trim() || existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const instructions = input.instructions !== undefined ? input.instructions : existing.instructions;
  const memory = input.memory !== undefined ? input.memory : existing.memory;

  const pinned = input.pinned !== undefined ? (input.pinned ? 1 : 0) : (existing.pinned ? 1 : 0);
 
  db.prepare(`
    UPDATE projects 
    SET name = ?, description = ?, instructions = ?, memory = ?, pinned = ?
    WHERE id = ?
  `).run(name, description, instructions, memory, pinned, id);

  const updated = getProject(id);
  if (!updated) {
    throw new Error('Failed to update project');
  }
  return updated;
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}
