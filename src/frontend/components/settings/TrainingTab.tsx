import { useCallback, useEffect, useState } from 'react';
import { apiExportTrainingData, apiFetchTrainingExamples, apiFetchTrainingStats } from '../../lib/api';
import { toTrainingExample } from './trainingExamples';
import type { TrainingExample, TrainingStats } from './types';

interface ExportResult {
  path: string;
  pairs: number;
  explicit: number;
  distilled: number;
  format: string;
}

export function TrainingTab() {
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'sharegpt' | 'alpaca'>('sharegpt');
  const [includeDistillation, setIncludeDistillation] = useState(false);
  const [examples, setExamples] = useState<TrainingExample[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, rawExamples] = await Promise.all([apiFetchTrainingStats(), apiFetchTrainingExamples()]);
      const next = rawExamples.map(toTrainingExample);
      setStats(data);
      setExamples(next);
      setSelectedIds(new Set(next.map((example) => example.id)));
    } catch {
      setError('Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const exportTrainingData = async () => {
    setExporting(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiExportTrainingData({ format: exportFormat, selectedIds: [...selectedIds], includeDistillation });
      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.path && typeof data.pairs === 'number' && data.format) {
        setResult({ path: data.path, pairs: data.pairs, explicit: data.explicit ?? data.pairs, distilled: data.distilled ?? 0, format: data.format });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const toggleExample = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="settings-section">
      <p className="settings-hint">
        Export your thumbs-up'd assistant messages as a dataset for LoRA fine-tuning.
        Run <code>scripts/finetune/train_lora.py</code> on the file to produce a personal
        model adapter that Ollama can load. See <code>scripts/finetune/README.md</code>
        for the full pipeline.
      </p>

      {loading ? (
        <p className="settings-hint">Loading…</p>
      ) : stats ? (
        <div className="settings-training-stats">
          <div className="settings-about-row">
            <span className="settings-about-label">Explicit 👍 pairs</span>
            <span className="settings-about-value"><strong>{stats.pairs}</strong></span>
          </div>
          <div className="settings-about-row">
            <span className="settings-about-label">Auto-positive (implicit)</span>
            <span className="settings-about-value">{stats.implicit ?? 0}</span>
          </div>
          <div className="settings-about-row">
            <span className="settings-about-label">User-edited answers</span>
            <span className="settings-about-value">{stats.edited}</span>
          </div>
          <div className="settings-about-row">
            <span className="settings-about-label">Distillation pairs available</span>
            <span className="settings-about-value">{stats.distillation ?? 0} from {stats.topChats ?? 0} top chats</span>
          </div>
          {stats.oldest && stats.newest && (
            <>
              <div className="settings-about-row">
                <span className="settings-about-label">Oldest pair</span>
                <span className="settings-about-value">{new Date(stats.oldest).toLocaleString()}</span>
              </div>
              <div className="settings-about-row">
                <span className="settings-about-label">Newest pair</span>
                <span className="settings-about-value">{new Date(stats.newest).toLocaleString()}</span>
              </div>
            </>
          )}

          {stats.pairs < 50 && stats.pairs > 0 && (
            <p className="settings-hint">
              ⚠️ Only <strong>{stats.pairs}</strong> pairs available.
              Fine-tuning is most useful past ~200 examples. Keep using the app
              and rating answers with 👍 to build the dataset.
            </p>
          )}
          {stats.pairs === 0 && (
            <p className="settings-hint">
              No positive-rated messages yet. Click 👍 on assistant replies you like
              to populate the dataset.
            </p>
          )}
        </div>
      ) : (
        <p className="settings-hint">No stats available.</p>
      )}

      {examples.length > 0 && (
        <div className="settings-training-review">
          <div className="settings-training-review__header">
            <div>
              <strong>Review examples</strong>
              <p className="settings-hint">Choose which thumbs-up answers to include. Edited answers use your correction.</p>
            </div>
            <button type="button" className="settings-secondary-btn" onClick={() => setSelectedIds(new Set(examples.map((example) => example.id)))}>Select all</button>
          </div>
          <div className="settings-training-examples">
            {examples.map((example) => {
              const selected = selectedIds.has(example.id);
              return (
                <label key={example.id} className={`settings-training-example ${selected ? 'is-selected' : ''}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleExample(example.id)} />
                  <span className="settings-training-example__body">
                    <span className="settings-training-example__meta">{example.chatTitle} · {example.edited ? 'Edited answer' : 'Thumbs-up'}</span>
                    <span className="settings-training-example__prompt">{example.userContent}</span>
                    <span className="settings-training-example__answer">{example.assistantContent}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="settings-hint">{selectedIds.size} of {examples.length} examples selected. Export includes chat text, so review for private information first.</p>
        </div>
      )}

      <div className="settings-divider" />

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="train-format">Export format</label>
        <select
          id="train-format"
          className="settings-input"
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value as 'sharegpt' | 'alpaca')}
        >
          <option value="sharegpt">ShareGPT — {`{messages: [...]}`} (recommended)</option>
          <option value="alpaca">Alpaca — {`{instruction, input, output}`}</option>
        </select>
      </div>

      <div className="settings-field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeDistillation}
            onChange={(e) => setIncludeDistillation(e.target.checked)}
          />
          <span className="settings-label">Include distillation pairs</span>
        </label>
        <p className="settings-hint">
          Blends pairs from your highest-rated conversations (~30%) to reduce catastrophic forgetting.
          {stats && stats.distillation > 0
            ? ` ${stats.distillation} pairs available from ${stats.topChats} top chats.`
            : ' Needs ≥2 rated messages per chat.'}
        </p>
      </div>

      <div className="settings-button-row">
        <button
          type="button"
          className="settings-primary-btn"
          onClick={exportTrainingData}
          disabled={exporting || !stats || selectedIds.size === 0}
        >
          {exporting ? 'Exporting…' : 'Export dataset'}
        </button>
        <button type="button" className="settings-secondary-btn" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <p className="settings-error">{error}</p>}

      {result && (
        <div className="settings-training-result">
          <p className="settings-hint">
            ✓ Wrote <strong>{result.pairs}</strong> pair{result.pairs === 1 ? '' : 's'}
            {' '}({result.explicit} explicit{result.distilled > 0 ? ` + ${result.distilled} distilled` : ''}, {result.format}) to:
          </p>
          <code className="settings-code-block">{result.path}</code>
          <p className="settings-hint">
            Next: run <code>python scripts/finetune/train_lora.py --data &quot;{result.path}&quot; --base &lt;model&gt; --out data/adapters/v1</code>
          </p>
        </div>
      )}
    </div>
  );
}
