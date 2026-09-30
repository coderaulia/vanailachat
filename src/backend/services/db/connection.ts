import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from '../migrations.js';
import { ensureDefaultProject } from './projects.js';

let connection: Database.Database | null = null;
let connectionPath: string | null = null;

const MAX_MIGRATION_BACKUPS = 5;
/** Databases created before schema_migrations existed were at this version. */
const LEGACY_SCHEMA_VERSION = 4;

/**
 * Snapshots the database before pending migrations run, so a bad migration
 * can be rolled back by hand. Keeps the newest few snapshots only. A failed
 * backup is logged rather than blocking startup.
 */
export function backupBeforeMigrations(db: Database.Database, dbPath: string, targetVersion: number): string | null {
  if (dbPath === ':memory:') return null;
  const backupDir = path.join(path.dirname(dbPath), 'backups');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(dbPath, path.extname(dbPath))}-pre-v${targetVersion}-${stamp}.sqlite`);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    db.prepare('VACUUM INTO ?').run(backupPath);
    const old = fs.readdirSync(backupDir)
      .filter((name) => name.includes('-pre-v') && name.endsWith('.sqlite'))
      .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(MAX_MIGRATION_BACKUPS);
    for (const { name } of old) fs.rmSync(path.join(backupDir, name), { force: true });
    console.log(`[DB] Backed up database before migrating to v${targetVersion}: ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.warn('[DB] Pre-migration backup failed; continuing without one:', error);
    return null;
  }
}

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
  connectionPath = finalPath;
  runMigrations();
}

/** Closes the connection so the next call reopens (tests use a fresh file each). */
export function close(): void {
  connection?.close();
  connection = null;
  connectionPath = null;
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
  // that already has migrations up to LEGACY_SCHEMA_VERSION applied.
  if (hasProjectsTable && hasMigrations.count === 0) {
    console.log(`[DB] Detected legacy database. Initializing migration state to version ${LEGACY_SCHEMA_VERSION}.`);
    const stmt = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    const now = Date.now();
    const insertMany = db.transaction((migs: typeof migrations) => {
      for (const mig of migs) {
        stmt.run(mig.version, mig.name, now);
      }
    });
    insertMany(migrations.filter((mig) => mig.version <= LEGACY_SCHEMA_VERSION));
  }

  const appliedMigrations = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(r => r.version)
  );

  const pending = migrations.filter((migration) => !appliedMigrations.has(migration.version));
  const hasUserData = Boolean(hasProjectsTable) || appliedMigrations.size > 0;
  if (pending.length > 0 && hasUserData && connectionPath) {
    backupBeforeMigrations(db, connectionPath, pending[pending.length - 1].version);
  }

  for (const migration of pending) {
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

  ensureDefaultProject();
}
