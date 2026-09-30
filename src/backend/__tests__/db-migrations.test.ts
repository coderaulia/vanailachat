import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DatabaseService } from '../services/database.js';
import { backupBeforeMigrations } from '../services/db/connection.js';
import { migrations } from '../services/migrations.js';

function freshPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-mig-')), 'test.sqlite');
}

function backups(dbPath: string): string[] {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function appliedVersions(dbPath: string): number[] {
  const db = new Database(dbPath);
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
  db.close();
  return rows.map((row) => row.version);
}

const latest = migrations[migrations.length - 1].version;

describe('database migrations', () => {
  afterEach(() => DatabaseService.close());

  it('does not back up a brand-new database', () => {
    const dbPath = freshPath();
    DatabaseService.initialize(dbPath);
    expect(backups(dbPath)).toHaveLength(0);
  });

  it('backs up an existing database before applying pending migrations', () => {
    const dbPath = freshPath();
    DatabaseService.initialize(dbPath);
    DatabaseService.upsertSetting('user_name', 'Alex');
    DatabaseService.close();

    // Pretend an idempotent migration has not run yet.
    const raw = new Database(dbPath);
    raw.prepare('DELETE FROM schema_migrations WHERE version = 4').run();
    raw.close();

    DatabaseService.initialize(dbPath);
    const files = backups(dbPath);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('-pre-v4-');

    const snapshot = new Database(path.join(path.dirname(dbPath), 'backups', files[0]), { readonly: true });
    const row = snapshot.prepare("SELECT value FROM settings WHERE key = 'user_name'").get() as { value: string };
    snapshot.close();
    expect(row.value).toBe('Alex');
  });

  it('keeps only the newest five backups', () => {
    const dbPath = freshPath();
    const db = new Database(dbPath);
    for (let version = 1; version <= 7; version++) backupBeforeMigrations(db, dbPath, version);
    db.close();
    expect(backups(dbPath)).toHaveLength(5);
  });

  it('runs every migration after v4 on a database from before schema_migrations existed', () => {
    const dbPath = freshPath();
    const raw = new Database(dbPath);
    for (const migration of migrations.filter((m) => m.version <= 4)) migration.up(raw);
    raw.close();

    DatabaseService.initialize(dbPath);
    DatabaseService.upsertSetting('theme', 'dark');
    expect(DatabaseService.getSetting('theme')).toBe('dark');
    DatabaseService.close();

    expect(appliedVersions(dbPath)).toEqual(migrations.map((m) => m.version));
    expect(appliedVersions(dbPath).at(-1)).toBe(latest);
    expect(backups(dbPath)).toHaveLength(1);
  });
});
