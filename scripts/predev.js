import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// Frees the port recorded by the previous backend run. Windows and Unix share
// no common way to do this, so each platform gets its own lookup + kill.
const PORT_FILE = '.port';
const isWindows = process.platform === 'win32';

function findPids(port) {
  if (isWindows) {
    const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    return result
      .split('\n')
      .map(l => l.trim().split(/\s+/).pop())
      .filter(p => p && /^\d+$/.test(p) && p !== '0');
  }

  // lsof ships with macOS and most Linux distros; fuser covers the rest.
  try {
    const result = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return result.split('\n').map(p => p.trim()).filter(Boolean);
  } catch {
    const result = execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8' });
    return result.trim().split(/\s+/).filter(Boolean);
  }
}

function kill(pid) {
  try {
    execSync(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Backends orphaned by an interrupted run (closed terminal, Ctrl+C that missed
 * the child) keep running without ever binding a port, so clearing the port
 * from .port does not find them. They then sit there while the next run starts
 * a second copy, and .port points at whichever wrote last — which is how the
 * UI ends up rendering empty against a dead backend.
 */
function killOrphanedBackends() {
  const projectDir = process.cwd();

  try {
    if (isWindows) {
      const script =
        `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${projectDir.replaceAll('\\', '\\\\')}*' -and $_.CommandLine -like '*src/backend/index.ts*' } | ` +
        `Select-Object -ExpandProperty ProcessId`;
      const output = execSync(`powershell -NoProfile -Command "${script}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output.split('\n').map((p) => p.trim()).filter(Boolean).filter(kill).length;
    }

    const output = execSync(`pgrep -f "${projectDir}.*src/backend/index.ts"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((pid) => pid !== String(process.pid))
      .filter(kill).length;
  } catch {
    // No matches, or the lookup tool is unavailable — nothing to clean up.
    return 0;
  }
}

if (existsSync(PORT_FILE)) {
  const port = readFileSync(PORT_FILE, 'utf8').trim();
  if (port) {
    try {
      const pids = [...new Set(findPids(port))];
      for (const pid of pids) kill(pid);
      console.log(`[predev] Cleared port ${port}`);
    } catch {}
  }
}

const orphans = killOrphanedBackends();
if (orphans > 0) {
  console.log(`[predev] Stopped ${orphans} orphaned backend process(es)`);
}
