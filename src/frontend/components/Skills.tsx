import { useEffect, useState, useCallback, useRef } from 'react';
import './Skills.css';

interface CatalogEntry {
  name: string;
  rawUrl: string;
  installed: boolean;
  enabled: boolean;
  id: string | null;
  description: string | null;
}

const API = '/api/skills';

const SKILL_META: Record<string, { emoji: string; category: string }> = {
  'frontend-design':       { emoji: '🎨', category: 'Design' },
  'algorithmic-art':       { emoji: '🌀', category: 'Creative' },
  'brand-guidelines':      { emoji: '🏷️', category: 'Enterprise' },
  'canvas-design':         { emoji: '🖼️', category: 'Design' },
  'claude-api':            { emoji: '⚡', category: 'Dev' },
  'doc-coauthoring':       { emoji: '📝', category: 'Docs' },
  'internal-comms':        { emoji: '📢', category: 'Enterprise' },
  'mcp-builder':           { emoji: '🔧', category: 'Dev' },
  'skill-creator':         { emoji: '✨', category: 'Dev' },
  'theme-factory':         { emoji: '🎭', category: 'Design' },
  'web-artifacts-builder': { emoji: '🏗️', category: 'Dev' },
  'webapp-testing':        { emoji: '🧪', category: 'Dev' },
};

export function Skills() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [tab, setTab] = useState<'catalog' | 'custom'>('catalog');

  // Custom upload state
  const [customContent, setCustomContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/catalog`);
      const data = await res.json() as { catalog: CatalogEntry[] };
      setCatalog(data.catalog);
    } catch {
      setError('Failed to load skills catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshCatalog(); }, [refreshCatalog]);

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
      setInstalling((prev) => { const s = new Set(prev); s.delete(name); return s; });
    }
  };

  const toggle = async (entry: CatalogEntry) => {
    if (!entry.id) return;
    const next = !entry.enabled;
    setCatalog((prev) => prev.map((e) => (e.id === entry.id ? { ...e, enabled: next } : e)));
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

  const uploadCustom = async (raw: string) => {
    if (!raw.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: raw }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Upload failed');
      } else {
        setCustomContent('');
        setTab('catalog');
        await refreshCatalog();
      }
    } catch {
      setError('Network error during upload.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCustomContent(ev.target?.result as string ?? '');
    reader.readAsText(file);
    e.target.value = '';
  };

  const installedEntries = catalog.filter((e) => e.installed);
  const availableEntries = catalog.filter((e) => !e.installed);

  return (
    <div className="skills-panel">
      {/* Tabs */}
      <div className="skills-tabs">
        <button
          type="button"
          className={`skills-tab ${tab === 'catalog' ? 'is-active' : ''}`}
          onClick={() => setTab('catalog')}
        >
          Catalog
          {installedEntries.length > 0 && (
            <span className="skills-tab-badge">{installedEntries.filter(e => e.enabled).length}</span>
          )}
        </button>
        <button
          type="button"
          className={`skills-tab ${tab === 'custom' ? 'is-active' : ''}`}
          onClick={() => setTab('custom')}
        >
          + Custom
        </button>
      </div>

      {error && (
        <div className="skills-error" role="alert">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Catalog tab ── */}
      {tab === 'catalog' && (
        <div className="skills-scroll">
          {loading ? (
            <div className="skills-loading"><span className="skills-spinner" />Loading…</div>
          ) : (
            <>
              {installedEntries.length > 0 && (
                <section className="skills-section">
                  <p className="skills-section-label">Installed</p>
                  <ul className="skills-list" role="list">
                    {installedEntries.map((entry) => {
                      const meta = SKILL_META[entry.name] ?? { emoji: '📦', category: 'Other' };
                      const isExpanded = expandedName === entry.name;
                      return (
                        <li key={entry.name} className={`skill-item ${entry.enabled ? 'is-enabled' : ''}`}>
                          <div className="skill-item__main">
                            <span className="skill-item__emoji">{meta.emoji}</span>
                            <div className="skill-item__info">
                              <span className="skill-item__name" title={entry.name}>{entry.name}</span>
                              <span className="skill-item__cat">{meta.category}</span>
                            </div>
                            <div className="skill-item__controls">
                              {entry.description && (
                                <button
                                  type="button"
                                  className="skill-item__info-btn"
                                  aria-label={isExpanded ? 'Hide' : 'Show description'}
                                  onClick={() => setExpandedName(isExpanded ? null : entry.name)}
                                >
                                  {isExpanded ? '▾' : '▸'}
                                </button>
                              )}
                              <button
                                type="button"
                                className={`skill-toggle ${entry.enabled ? 'skill-toggle--on' : 'skill-toggle--off'}`}
                                aria-label={entry.enabled ? 'Disable' : 'Enable'}
                                aria-pressed={entry.enabled}
                                onClick={() => toggle(entry)}
                              >
                                <span className="skill-toggle__knob" />
                              </button>
                              <button
                                type="button"
                                className="skill-uninstall"
                                aria-label="Uninstall"
                                title="Uninstall"
                                onClick={() => uninstall(entry)}
                              >×</button>
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
                  <p className="skills-section-label">
                    {installedEntries.length > 0 ? 'More from Anthropic' : 'Available from Anthropic'}
                  </p>
                  <ul className="skills-list" role="list">
                    {availableEntries.map((entry) => {
                      const meta = SKILL_META[entry.name] ?? { emoji: '📦', category: 'Other' };
                      const isLoading = installing.has(entry.name);
                      return (
                        <li key={entry.name} className="skill-item skill-item--available">
                          <div className="skill-item__main">
                            <span className="skill-item__emoji">{meta.emoji}</span>
                            <div className="skill-item__info">
                              <span className="skill-item__name" title={entry.name}>{entry.name}</span>
                              <span className="skill-item__cat">{meta.category}</span>
                            </div>
                            <button
                              type="button"
                              className="skill-install-btn"
                              aria-label={`Install ${entry.name}`}
                              onClick={() => install(entry.name)}
                              disabled={isLoading}
                            >
                              {isLoading ? <span className="skills-spinner skills-spinner--sm" /> : '+ Install'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {catalog.length === 0 && (
                <p className="skills-empty">No skills found.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Custom tab ── */}
      {tab === 'custom' && (
        <div className="skills-custom">
          <p className="skills-custom-hint">
            Paste or upload a <code>SKILL.md</code> file with YAML frontmatter
            (<code>name</code> + <code>description</code> required).
          </p>
          <div className="skills-custom-actions">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".md,text/markdown,text/plain"
              onChange={handleFileUpload}
            />
            <button
              type="button"
              className="skill-upload-file-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              📂 Upload file
            </button>
          </div>
          <textarea
            className="skills-custom-textarea"
            placeholder={`---\nname: my-skill\ndescription: What this skill does\n---\n\n# My Skill\n\nInstructions here...`}
            value={customContent}
            onChange={(e) => setCustomContent(e.target.value)}
            rows={10}
            spellCheck={false}
          />
          <button
            type="button"
            className="skill-install-btn skill-install-btn--block"
            disabled={!customContent.trim() || uploading}
            onClick={() => uploadCustom(customContent)}
          >
            {uploading ? <><span className="skills-spinner skills-spinner--sm" /> Installing…</> : '+ Install Skill'}
          </button>
        </div>
      )}
    </div>
  );
}
