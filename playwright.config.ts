import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Isolated DB so E2E never touches data/vanaila.sqlite.
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-e2e-'));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --import tsx src/backend/index.ts',
      env: { PORT: '8787', DATABASE_PATH: path.join(dbDir, 'e2e.sqlite') },
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
