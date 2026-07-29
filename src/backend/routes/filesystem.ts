import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';

/**
 * Directory browsing for the in-app folder picker.
 *
 * The native dialog is spawned by the server process, which cannot reliably
 * reach a desktop — it produced a PowerShell process with no window at all and
 * a request that hung until it timed out. Listing directories over HTTP works
 * regardless of how the backend was started, and keeps working if it is ever
 * run somewhere other than the machine holding the browser.
 *
 * Names only: this never reads file contents.
 */
export function filesystemRouter(): Hono {
  const app = new Hono();

  /** Windows volumes, so the picker can start somewhere sensible. */
  async function listWindowsDrives(): Promise<string[]> {
    const candidates = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`);
    const reachable = await Promise.all(
      candidates.map(async (drive) => {
        try {
          await fs.access(drive);
          return drive;
        } catch {
          return null;
        }
      }),
    );
    return reachable.filter((drive): drive is string => drive !== null);
  }

  app.get('/browse', async (context) => {
    try {
      const requested = context.req.query('path');
      const target = requested?.trim() ? path.resolve(requested) : os.homedir();

      const entries = await fs.readdir(target, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        // Dot-directories and node_modules are noise when picking a workspace.
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const parent = path.dirname(target);

      return context.json({
        path: target,
        // At a filesystem root dirname() returns the same path; null tells the
        // UI there is nowhere further up.
        parent: parent === target ? null : parent,
        directories,
        drives: process.platform === 'win32' ? await listWindowsDrives() : ['/'],
        home: os.homedir(),
      });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Unable to read that folder') }, 400);
    }
  });

  return app;
}
