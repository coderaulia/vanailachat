import { useEffect, useState } from 'react';
import { apiCheckForUpdate, apiOpenExternal } from '../lib/api';
import type { UpdateInfo } from '../lib/api';
import './UpdateNotice.css';

const CHECKED_AT_KEY = 'vanaila_update_checked_at';
const DISMISSED_KEY = 'vanaila_update_dismissed';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the check simply repeats next launch.
  }
}

/** Desktop only: a dismissible note when GitHub has a newer release. At most one check a day. */
export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const last = Number(read(CHECKED_AT_KEY) ?? 0);
    if (Date.now() - last < CHECK_INTERVAL_MS) return;
    let cancelled = false;
    apiCheckForUpdate()
      .then((info) => {
        write(CHECKED_AT_KEY, String(Date.now()));
        if (!cancelled && info?.available && read(DISMISSED_KEY) !== info.latest) setUpdate(info);
      })
      .catch(() => {
        // Offline or rate-limited — try again next launch.
      });
    return () => { cancelled = true; };
  }, []);

  if (!update) return null;

  const dismiss = () => {
    write(DISMISSED_KEY, update.latest);
    setUpdate(null);
  };

  return (
    <div className="update-notice" role="status">
      <span>Vanaila Chat {update.latest} is available (you have {update.current}).</span>
      <button type="button" className="update-notice__link" onClick={() => void apiOpenExternal(update.url)}>
        Download
      </button>
      <button type="button" className="update-notice__dismiss" aria-label="Dismiss update notice" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
