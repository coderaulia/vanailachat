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

if (existsSync(PORT_FILE)) {
  const port = readFileSync(PORT_FILE, 'utf8').trim();
  if (port) {
    try {
      const pids = [...new Set(findPids(port))];
      for (const pid of pids) {
        try {
          execSync(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, { stdio: 'ignore' });
        } catch {}
      }
      console.log(`[predev] Cleared port ${port}`);
    } catch {}
  }
}
