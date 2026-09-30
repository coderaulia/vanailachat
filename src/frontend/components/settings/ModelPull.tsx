import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { apiPullModel } from '../../lib/api';
import type { PullProgress } from '../../lib/api';

type PullState =
  | { phase: 'idle' }
  | { phase: 'pulling'; status: string; percent: number | null }
  | { phase: 'done'; name: string }
  | { phase: 'error'; message: string };

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1e6))} MB`;
}

/** Downloads an Ollama model with a live progress bar. */
export function ModelPull({ onPulled }: { onPulled?: () => void }) {
  const [name, setName] = useState('');
  const [state, setState] = useState<PullState>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  const onProgress = (progress: PullProgress) => {
    const hasBytes = typeof progress.total === 'number' && progress.total > 0;
    const percent = hasBytes ? Math.min(100, Math.round(((progress.completed ?? 0) / progress.total!) * 100)) : null;
    // Layer digests are noise to the reader; show the sizes instead.
    const label = progress.status?.startsWith('pulling ') && hasBytes
      ? `Downloading ${formatBytes(progress.completed ?? 0)} of ${formatBytes(progress.total!)}`
      : progress.status ?? 'Working…';
    setState({ phase: 'pulling', status: label, percent });
  };

  const pull = async (event: FormEvent) => {
    event.preventDefault();
    const model = name.trim();
    if (!model || state.phase === 'pulling') return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ phase: 'pulling', status: 'Starting…', percent: null });
    try {
      await apiPullModel(model, onProgress, controller.signal);
      setState({ phase: 'done', name: model });
      setName('');
      onPulled?.();
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ phase: 'idle' });
        return;
      }
      setState({ phase: 'error', message: error instanceof Error ? error.message : 'Download failed' });
    } finally {
      controllerRef.current = null;
    }
  };

  return (
    <form className="settings-field settings-model-pull" onSubmit={pull}>
      <label className="settings-label" htmlFor="model-pull-name">Download a model</label>
      <div className="settings-model-pull__row">
        <input
          id="model-pull-name"
          className="settings-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. llama3.2:3b, qwen2.5-coder:7b, nomic-embed-text"
          disabled={state.phase === 'pulling'}
        />
        {state.phase === 'pulling' ? (
          <button type="button" className="settings-secondary-btn" onClick={() => controllerRef.current?.abort()}>
            Cancel
          </button>
        ) : (
          <button type="submit" className="settings-primary-btn" disabled={!name.trim()}>
            Download
          </button>
        )}
      </div>
      {state.phase === 'pulling' && (
        <div className="settings-model-pull__progress" role="status" aria-live="polite">
          <div
            className="settings-model-pull__bar"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.percent ?? undefined}
          >
            <span style={{ width: `${state.percent ?? 100}%` }} className={state.percent === null ? 'is-indeterminate' : ''} />
          </div>
          <span className="settings-hint">{state.status}{state.percent !== null ? ` · ${state.percent}%` : ''}</span>
        </div>
      )}
      {state.phase === 'done' && <p className="settings-hint" role="status">✓ {state.name} is ready to use.</p>}
      {state.phase === 'error' && <p className="settings-error" role="alert">{state.message}</p>}
      <p className="settings-hint">
        Browse names at <a href="https://ollama.com/library" target="_blank" rel="noreferrer">ollama.com/library</a>.
      </p>
    </form>
  );
}
