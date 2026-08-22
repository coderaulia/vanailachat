import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

describe('git routes', () => {
  it('returns isGit false for non-git directory', async () => {
    const app = createApp();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-non-git-'));
    try {
      const res = await app.request('/api/git/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { isGit: boolean; branch: string | null };
      expect(data.isGit).toBe(false);
      expect(data.branch).toBeNull();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects git branch and handles branch creation in a real git directory', async () => {
    const app = createApp();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-git-'));
    try {
      execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@vanaila.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test');
      execSync('git add . && git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });

      // Check status
      const resStatus = await app.request('/api/git/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir }),
      });
      expect(resStatus.status).toBe(200);
      const data = await resStatus.json() as { isGit: boolean; branch: string; isMainOrMaster: boolean };
      expect(data.isGit).toBe(true);
      expect(data.branch).toBe('main');
      expect(data.isMainOrMaster).toBe(true);

      // Create new branch
      const resBranch = await app.request('/api/git/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir, branchName: 'feature/new-api' }),
      });
      expect(resBranch.status).toBe(200);
      const branchData = await resBranch.json() as { success: boolean; branch: string };
      expect(branchData.success).toBe(true);
      expect(branchData.branch).toBe('feature/new-api');

      // Verify branch switched
      const resStatus2 = await app.request('/api/git/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir }),
      });
      const data2 = await resStatus2.json() as { branch: string; isMainOrMaster: boolean };
      expect(data2.branch).toBe('feature/new-api');
      expect(data2.isMainOrMaster).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
