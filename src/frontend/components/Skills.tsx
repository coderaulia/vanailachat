import { useEffect, useState, useCallback } from 'react';
import './Skills.css';

interface CatalogEntry {
  name: string;
  rawUrl: string;
  installed: boolean;
  enabled: boolean;
  id: string | null;
  description: string | null;
}

interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sourceUrl: string | null;
  installedAt: number;
}

const API = '/api/skills';

export function Skills() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);

  const refreshCatalog = useCallback(async () => {
    try {
      const res = await fetch(`${API}/catalog`);
      const data = await res.json() as { catalog: CatalogEntry[] };
      setCatalog(data.catalog);
    } catch (e) {
      setError('Failed to load skills catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  const install = async (name: string) => {
    setInstalling((prev) => new Set(prev).add(name));
    setError(null);
    try {
      const res = await fetch(`${API}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Install failed');
      } else {
        await refreshCatalog();
      }
    } catch {
      setError('Network error during install.');
    } finally {
      setInstalling((prev) => {
        const s = new Set(prev);
        s.delete(name);
        return s;
      });
    }
  };

  const toggle = async (entry: CatalogEntry) => {
    if (!entry.id) return;
    const next = !entry.enabled;
    // optimistic update
    setCatalog((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, enabled: next } : e))
    );
    await fetch(`${API}/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
  };

  const uninstall = async (entry: CatalogEntry) => {
    if (!entry.id) return;
    await fetch(`${API}/${entry.id}`, { method: 'DELETE' });
    await refreshCatalog();
  };

  const SKILL_LABELS: Record<string, { emoji: string; category: string }> = {
    'frontend-design':      { emoji: '🎨', category: 'Design' },
    'algorithmic-art':      { emoji: '🌀', category: 'Creative' },
    'brand-guidelines':     { emoji: '🏷️', category: 'Enterprise' },
    'canvas-design':        { emoji: '🖼️', category: 'Design' },
    'claude-api':           { emoji: '⚡', category: 'Dev' },
    'doc-coauthoring':      { emoji: '📝', category: 'Docs' },
    'internal-comms':       { emoji: '📢', category: 'Enterprise' },
    'mcp-builder':          { emoji: '🔧', category: 'Dev' },
    'skill-creator':        { emoji: '✨', category: 'Dev' },
    'theme-factory':        { emoji: '🎭', category: 'Design' },
    'web-artifacts-builder':{ emoji: '🏗️', category: 'Dev' },
    'webapp-testing':       { emoji: '🧪', category: 'Dev' },
  };

  if (loading) {
    return (
      <div className="skills-panel">
        <div className="skills-loading">
          <span className="skills-spinner" />
          Loading skills…
        </div>
      </div>
    );
  }

  const installedEntries = catalog.filter((e) => e.installed);
  const availableEntries = catalog.filter((e) => !e.installed);

  return (
    <div className="skills-panel">
      <div className="skills-header">
        <div className="skills-title-row">
          <span className="skills-icon">🧠</span>
          <div>
            <h2 className="skills-title">Agent Skills</h2>
            <p className="skills-subtitle">Official Anthropic skills for your local model</p>
          </div>
        </div>
        {installedEntries.length > 0 && (
          <span className="skills-badge">{installedEntries.filter(e => e.enabled).length} active</span>
        )}
      </div>

      {error && (
        <div className="skills-error" role="alert">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
        </div>
      )}

      {installedEntries.length > 0 && (
        <section className="skills-section">
          <p className="skills-section-label">Installed</p>
          <ul className="skills-list" role="list">
            {installedEntries.map((entry) => {
              const meta = SKILL_LABELS[entry.name] ?? { emoji: '📦', category: 'Other' };
              const isExpanded = expandedName === entry.name;
              return (
                <li key={entry.name} className={`skill-item ${entry.enabled ? 'is-enabled' : 'is-disabled'}`}>
                  <div className="skill-item__main">
                    <span className="skill-item__emoji">{meta.emoji}</span>
                    <div className="skill-item__info">
                      <span className="skill-item__name">{entry.name}</span>
                      <span className="skill-item__cat">{meta.category}</span>
                    </div>
                    <div className="skill-item__controls">
                      <button
                        type="button"
                        className="skill-item__info-btn"
                        aria-label={isExpanded ? 'Hide description' : 'Show description'}
                        onClick={() => setExpandedName(isExpanded ? null : entry.name)}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                      <button
                        type="button"
                        className={`skill-toggle ${entry.enabled ? 'skill-toggle--on' : 'skill-toggle--off'}`}
                        aria-label={entry.enabled ? 'Disable skill' : 'Enable skill'}
                        aria-pressed={entry.enabled}
                        onClick={() => toggle(entry)}
                      >
                        <span className="skill-toggle__knob" />
                      </button>
                      <button
                        type="button"
                        className="skill-uninstall"
                        aria-label="Uninstall skill"
                        title="Uninstall"
                        onClick={() => uninstall(entry)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {isExpanded && entry.description && (
                    <p className="skill-item__desc">{entry.description}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {availableEntries.length > 0 && (
        <section className="skills-section">
          <p className="skills-section-label">Available from Anthropic</p>
          <ul className="skills-list skills-list--available" role="list">
            {availableEntries.map((entry) => {
              const meta = SKILL_LABELS[entry.name] ?? { emoji: '📦', category: 'Other' };
              const isLoading = installing.has(entry.name);
              const isExpanded = expandedName === entry.name;
              return (
                <li key={entry.name} className="skill-item skill-item--available">
                  <div className="skill-item__main">
                    <span className="skill-item__emoji">{meta.emoji}</span>
                    <div className="skill-item__info">
                      <span className="skill-item__name">{entry.name}</span>
                      <span className="skill-item__cat">{meta.category}</span>
                    </div>
                    <div className="skill-item__controls">
                      <button
                        type="button"
                        className="skill-item__info-btn"
                        aria-label={isExpanded ? 'Hide description' : 'Show description'}
                        onClick={() => setExpandedName(isExpanded ? null : entry.name)}
                        disabled={!entry.description}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                      <button
                        type="button"
                        className="skill-install-btn"
                        aria-label={`Install ${entry.name} skill`}
                        onClick={() => install(entry.name)}
                        disabled={isLoading}
                      >
                        {isLoading ? <span className="skills-spinner skills-spinner--sm" /> : '+ Install'}
                      </button>
                    </div>
                  </div>
                  {isExpanded && entry.description && (
                    <p className="skill-item__desc">{entry.description}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {catalog.length === 0 && !loading && (
        <p className="skills-empty">No skills found. Check your network connection.</p>
      )}
    </div>
  );
}
