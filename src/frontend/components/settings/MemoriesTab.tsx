import { useEffect, useState } from 'react';
import { apiAddMemory, apiClearMemories, apiDeleteMemory, apiFetchMemories } from '../../lib/api';
import type { SettingsStore } from './useSettingsStore';
import type { MemoryEntry } from './types';

export function MemoriesTab({ store }: { store: SettingsStore }) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const memoryEnabled = store.values.memory_enabled !== 'false';

  useEffect(() => {
    apiFetchMemories()
      .then(setMemories)
      .catch(() => {/* best-effort */})
      .finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      setMemories(await apiFetchMemories());
    } catch {
      // best-effort
    }
    setLoading(false);
  };

  const deleteMemory = async (id: string) => {
    setDeleting(id);
    try {
      await apiDeleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // best-effort
    }
    setDeleting(null);
  };

  const addMemory = async () => {
    const content = window.prompt('What should the assistant remember?');
    if (!content?.trim()) return;
    try {
      const memory = await apiAddMemory(content.trim());
      if (memory) setMemories((prev) => [memory, ...prev.filter((m) => m.id !== memory.id)]);
    } catch {
      setError('Could not save memory');
    }
  };

  const forgetAll = async () => {
    if (!window.confirm('Forget all saved memories? Your chats will not be deleted.')) return;
    try {
      await apiClearMemories();
      setMemories([]);
    } catch {
      setError('Could not delete memories');
    }
  };

  const emptyState = (hint: string) => (
    <div className="memories-empty">
      <span className="memories-empty-icon">🧩</span>
      <p className="memories-empty-title">No memories yet</p>
      <p className="memories-empty-hint">{hint}</p>
    </div>
  );

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={memoryEnabled}
            onChange={(e) => {
              const value = e.target.checked ? 'true' : 'false';
              void store.saveNow({ memory_enabled: value }, [['memory_enabled', value]]);
            }}
          />
          <span>Use saved memories in chats</span>
        </label>
        <p className="settings-hint">
          When enabled, relevant saved details may be added to new conversations. Turning
          this off pauses recall and automatic saving; it does not delete existing memories.
        </p>
      </div>
      <p className="settings-hint" style={{ marginBottom: 12 }}>
        Saved details help the assistant give more relevant answers across chats. You can
        add, inspect, or remove them here. Chats are not deleted when memories are removed.
      </p>

      <div className="memories-header">
        <span className="memories-count">
          {memories.length} {memories.length === 1 ? 'memory' : 'memories'} stored
        </span>
        <button type="button" className="settings-refresh-btn" onClick={refresh} disabled={loading}>
          {loading ? '⏳ Refreshing…' : '🔄 Refresh'}
        </button>
        <div className="settings-button-row">
          <button type="button" className="settings-secondary-btn" onClick={addMemory}>Add memory</button>
          <button type="button" className="settings-secondary-btn" onClick={forgetAll} disabled={memories.length === 0}>Forget all</button>
        </div>
      </div>

      {error && <p className="settings-error">{error}</p>}

      {loading && memories.length === 0 ? (
        emptyState('Memories are created automatically as you chat. You can also manually add them via the API.')
      ) : (
        <div className="memories-list">
          {memories.map((m) => (
            <div key={m.id} className="memories-item">
              <div className="memories-item__meta">
                <span className={`memories-type-badge memories-type--${m.type}`}>{m.type}</span>
                <span className="memories-date">
                  {new Date(m.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="memories-item__content">{m.content.slice(0, 300)}{m.content.length > 300 ? '…' : ''}</p>
              <button
                type="button"
                className="memories-delete-btn"
                onClick={() => deleteMemory(m.id)}
                disabled={deleting === m.id}
                title="Delete memory"
              >
                {deleting === m.id ? '⏳' : '🗑️'}
              </button>
            </div>
          ))}

          {memories.length === 0 && !loading && emptyState('Memories are created automatically as you chat.')}
        </div>
      )}
    </div>
  );
}
