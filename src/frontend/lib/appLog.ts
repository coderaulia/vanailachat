export interface AppLogEntry {
  id: number;
  timestamp: number;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
}

const entries: AppLogEntry[] = [];
const listeners = new Set<(entry: AppLogEntry) => void>();
let nextId = 1;
let installed = false;

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function addAppLog(level: AppLogEntry['level'], ...values: unknown[]): void {
  const entry = { id: nextId++, timestamp: Date.now(), level, message: values.map(stringify).join(' ') };
  entries.push(entry);
  if (entries.length > 500) entries.shift();
  listeners.forEach((listener) => listener(entry));
}

export function getAppLogs(): AppLogEntry[] { return [...entries]; }
export function clearAppLogs(): void { entries.length = 0; }
export function subscribeAppLogs(listener: (entry: AppLogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installAppLogCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => { addAppLog(level, ...values); original(...values); };
  });
  window.addEventListener('error', (event) => addAppLog('error', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => addAppLog('error', event.reason));
}
