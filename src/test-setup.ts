import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Guarantee that if any test interacts with SQLite without an explicit path,
// it never touches or pollutes the real data/vanaila.sqlite database.
if (!process.env.DATABASE_PATH) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-vitest-'));
  process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');
}
