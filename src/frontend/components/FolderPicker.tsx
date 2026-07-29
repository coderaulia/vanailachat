import { useCallback, useEffect, useState } from 'react';
import './FolderPicker.css';

interface BrowseResponse {
  path: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
  drives: string[];
  home: string;
  error?: string;
}

interface FolderPickerProps {
  /** Where to open. Falls back to the home directory when empty. */
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/**
 * In-app folder browser.
 *
 * The native OS dialog is spawned by the server process, which cannot reliably
 * reach a desktop — it produced a window-less process and a request that hung
 * until it timed out, so the button looked dead. Browsing over HTTP behaves the
 * same however the backend was started.
 */
export function FolderPicker({ initialPath, onSelect, onClose }: FolderPickerProps) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const browse = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = target ? `?path=${encodeURIComponent(target)}` : '';
      const response = await fetch(`/api/fs/browse${query}`);
      const body = await response.json() as BrowseResponse;
      if (!response.ok) throw new Error(body.error ?? 'Unable to read that folder');
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to read that folder');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void browse(initialPath?.trim() || undefined);
  }, [browse, initialPath]);

  // Escape closes, matching every other dismissable surface in the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="folder-picker" role="dialog" aria-label="Choose a folder">
      <div className="folder-picker__header">
        <button
          type="button"
          className="folder-picker__up"
          disabled={!data?.parent || loading}
          onClick={() => data?.parent && void browse(data.parent)}
          title="Go up one level"
        >
          ↑
        </button>
        <span className="folder-picker__path" title={data?.path}>{data?.path ?? '…'}</span>
        <button type="button" className="folder-picker__close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="folder-picker__shortcuts">
        {data?.home && (
          <button type="button" onClick={() => void browse(data.home)}>Home</button>
        )}
        {data?.drives.map((drive) => (
          <button key={drive} type="button" onClick={() => void browse(drive)}>{drive}</button>
        ))}
      </div>

      <div className="folder-picker__list">
        {loading && <p className="folder-picker__note">Loading…</p>}
        {error && <p className="folder-picker__note is-error">{error}</p>}
        {!loading && !error && data?.directories.length === 0 && (
          <p className="folder-picker__note">No sub-folders here — you can still choose this folder.</p>
        )}
        {!loading && !error && data?.directories.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className="folder-picker__entry"
            onDoubleClick={() => void browse(entry.path)}
            onClick={() => void browse(entry.path)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {entry.name}
          </button>
        ))}
      </div>

      <div className="folder-picker__actions">
        <button type="button" className="folder-picker__btn" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="folder-picker__btn is-primary"
          disabled={!data?.path}
          onClick={() => data?.path && onSelect(data.path)}
        >
          Use this folder
        </button>
      </div>
    </div>
  );
}
