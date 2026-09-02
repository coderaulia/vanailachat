import { useEffect, useRef, useState } from 'react';
import { clearAppLogs, getAppLogs, installAppLogCapture, subscribeAppLogs, type AppLogEntry } from '../lib/appLog';
import './AppLogPanel.css';

export function AppLogPanel({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<AppLogEntry[]>(getAppLogs);
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => { installAppLogCapture(); return subscribeAppLogs((entry) => setLogs((previous) => [...previous, entry].slice(-500))); }, []);
  useEffect(() => { outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }); }, [logs.length]);
  return <aside className="app-log-panel" aria-label="Application log">
    <div className="app-log-panel__header"><span>Application Log</span><div><button type="button" className="app-log-panel__clear" onClick={() => { clearAppLogs(); setLogs([]); }}>Clear</button><button type="button" className="app-log-panel__close" onClick={onClose} aria-label="Close application log">×</button></div></div>
    <div className="app-log-panel__output" ref={outputRef}>{logs.length === 0 ? <div className="app-log-panel__empty">No application events yet.</div> : logs.map((entry) => <div className={'app-log-entry app-log-entry--' + entry.level} key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span>{entry.level.toUpperCase()}</span><code>{entry.message}</code></div>)}</div>
  </aside>;
}
