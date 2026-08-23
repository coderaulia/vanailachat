import { Hono } from 'hono';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';

const execAsync = promisify(exec);

export interface GitStatusResult {
  isGit: boolean;
  branch: string | null;
  isClean: boolean;
  uncommittedCount: number;
  modifiedFiles: string[];
  isMainOrMaster: boolean;
  error?: string;
}

export function createGitRoutes() {
  const router = new Hono();

  // POST /api/git/status
  router.post('/status', async (c) => {
    try {
      const body = await c.req.json<{ projectRoot?: string }>();
      const projectRoot = (body?.projectRoot || '').trim();

      if (!projectRoot || !existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
        return c.json<GitStatusResult>({
          isGit: false,
          branch: null,
          isClean: true,
          uncommittedCount: 0,
          modifiedFiles: [],
          isMainOrMaster: false,
        });
      }

      // Check if inside a git repository
      try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: projectRoot });
      } catch {
        return c.json<GitStatusResult>({
          isGit: false,
          branch: null,
          isClean: true,
          uncommittedCount: 0,
          modifiedFiles: [],
          isMainOrMaster: false,
        });
      }

      // Get current branch
      let branch = 'unknown';
      try {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot });
        branch = stdout.trim();
      } catch {
        // Not on a branch or git failure
      }

      // Get status / porcelain
      let uncommittedCount = 0;
      const modifiedFiles: string[] = [];
      try {
        const { stdout } = await execAsync('git status --porcelain', { cwd: projectRoot });
        const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        uncommittedCount = lines.length;
        for (const line of lines.slice(0, 20)) {
          const filePath = line.replace(/^[MADRCU?! ]+\s+/, '');
          if (filePath) modifiedFiles.push(filePath);
        }
      } catch {
        // Status command failed
      }

      const isMainOrMaster = branch === 'main' || branch === 'master' || branch === 'production' || branch === 'prod';
      const isClean = uncommittedCount === 0;

      return c.json<GitStatusResult>({
        isGit: true,
        branch,
        isClean,
        uncommittedCount,
        modifiedFiles,
        isMainOrMaster,
      });
    } catch (error) {
      return c.json<GitStatusResult>({
        isGit: false,
        branch: null,
        isClean: true,
        uncommittedCount: 0,
        modifiedFiles: [],
        isMainOrMaster: false,
        error: error instanceof Error ? error.message : 'Failed to query git status',
      }, 500);
    }
  });

  // POST /api/git/branch
  router.post('/branch', async (c) => {
    try {
      const body = await c.req.json<{ projectRoot?: string; branchName?: string }>();
      const projectRoot = (body?.projectRoot || '').trim();
      const rawBranchName = (body?.branchName || '').trim();

      if (!projectRoot || !existsSync(projectRoot)) {
        return c.json({ success: false, error: 'Invalid project directory' }, 400);
      }

      // Sanitize branch name
      const branchName = rawBranchName
        .replace(/[^a-zA-Z0-9_\-/.]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!branchName) {
        return c.json({ success: false, error: 'Invalid or empty branch name' }, 400);
      }

      // Create and switch branch: git checkout -b <branchName>
      await execAsync(`git checkout -b "${branchName}"`, { cwd: projectRoot });

      return c.json({ success: true, branch: branchName });
    } catch (error) {
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create git branch',
      }, 500);
    }
  });

  return router;
}
