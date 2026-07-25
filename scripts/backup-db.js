#!/usr/bin/env node
/**
 * Consistent SQLite backup with retention pruning.
 *
 * The database runs in WAL mode, so copying the .sqlite file alone can yield a
 * torn snapshot — the committed tail may still live in the -wal file. This uses
 * better-sqlite3's online backup API, which takes a crash-consistent copy while
 * the app keeps running.
 *
 * Usage:
 *   node scripts/backup-db.js [--out ./backups] [--keep 7]
 *
 * Schedule it however the host does recurring work (cron, systemd timer,
 * Task Scheduler), e.g. daily:
 *   0 3 * * * cd /path/to/vanaila-chat && node scripts/backup-db.js
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    out[key] = value;
    if (value !== 'true') i++;
  }
  return out;
}

const args = parseArgs(process.argv);
const source = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'vanaila.sqlite');
const outDir = path.resolve(args.out || path.join(process.cwd(), 'backups'));
const keep = Number(args.keep ?? 7);

if (!Number.isInteger(keep) || keep < 1) {
  console.error(`--keep must be a positive integer, got: ${args.keep}`);
  process.exit(2);
}

if (!fs.existsSync(source)) {
  console.error(`Database not found: ${source}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(outDir, `vanaila-${stamp}.sqlite`);

const db = new Database(source, { readonly: true });

try {
  await db.backup(target);
  // Owner-only: backups contain full chat history and any stored API keys.
  fs.chmodSync(target, 0o600);
  const { size } = fs.statSync(target);
  console.log(`[backup] ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`);
} finally {
  db.close();
}

// Retention: keep the N newest, drop the rest.
const stale = fs
  .readdirSync(outDir)
  .filter((name) => /^vanaila-.*\.sqlite$/.test(name))
  .sort()
  .reverse()
  .slice(keep);

for (const name of stale) {
  fs.rmSync(path.join(outDir, name));
  console.log(`[backup] pruned ${name}`);
}
