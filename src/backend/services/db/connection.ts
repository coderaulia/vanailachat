import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from '../migrations.js';
import { ensureDefaultProject } from './projects.js';

let connection: Database.Database | null = null;

export function initialize(databasePath?: string): void {
  if (connection) {
    return;
  }

  const finalPath =
    databasePath || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'vanaila.sqlite');

  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  const db = new Database(finalPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  connection = db;
  runMigrations();
}

/** Closes the connection so the next call reopens (tests use a fresh file each). */
export function close(): void {
  connection?.close();
  connection = null;
}

export function getDb(): Database.Database {
  if (!connection) {
    initialize();
  }

  if (!connection) {
    throw new Error('Failed to initialize SQLite database');
  }

  return connection;
}

/**
 * Runs synchronous writes inside one transaction. Bulk inserts issued
 * outside a transaction pay an fsync each, which made imports scale
 * terribly. Falls back to a direct call when no database is available so
 * routes driven by injected mocks still work.
 */
export function runInTransaction<T>(fn: () => T): T {
  let db: Database.Database;
  try {
    db = getDb();
  } catch {
    return fn();
  }
  return db.transaction(fn)();
}

export function runMigrations(): void {
  const db = getDb();

  // Check if we have an existing database without schema_migrations
  const hasProjectsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const hasMigrations = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number };
  
  // If we have projects table but no migrations recorded, it's a legacy DB
  // Assume it has all migrations up to version 4 applied
  if (hasProjectsTable && hasMigrations.count === 0) {
    console.log('[DB] Detected legacy database. Initializing migration state to version 4.');
    const stmt = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    const now = Date.now();
    const insertMany = db.transaction((migs: typeof migrations) => {
      for (const mig of migs) {
        stmt.run(mig.version, mig.name, now);
      }
    });
    insertMany(migrations);
  }

  const appliedMigrations = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(r => r.version)
  );

  for (const migration of migrations) {
    if (!appliedMigrations.has(migration.version)) {
      console.log(`[DB] Running migration: ${migration.version}_${migration.name}`);
      const transaction = db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
          migration.version,
          migration.name,
          Date.now()
        );
      });
      transaction();
    }
  }

  ensureDefaultProject();
}
