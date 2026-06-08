import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const PORT_FILE = '.port';
if (existsSync(PORT_FILE)) {
  const port = readFileSync(PORT_FILE, 'utf8').trim();
  if (port) {
    try {
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const pids = [...new Set(
        result.split('\n')
          .map(l => l.trim().split(/\s+/).pop())
          .filter(p => p && /^\d+$/.test(p) && p !== '0')
      )];
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch {}
      }
      console.log(`[predev] Cleared port ${port}`);
    } catch {}
  }
}
