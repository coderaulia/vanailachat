import { useState, useCallback } from 'react';
import './ABTestModal.css';

interface ABResult {
  model: string;
  content: string;
  latencyMs: number;
}

interface ABResponse {
  a: ABResult;
  b: ABResult;
}

interface ABTestModalProps {
  availableModels: string[];
  defaultModel?: string;
  onClose: () => void;
}

export function ABTestModal({ availableModels, defaultModel, onClose }: ABTestModalProps) {
  const [prompt, setPrompt] = useState('');
  const [modelA, setModelA] = useState(availableModels[0] ?? defaultModel ?? '');
  const [modelB, setModelB] = useState(availableModels[1] ?? availableModels[0] ?? defaultModel ?? '');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ABResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const [pickedSide, setPickedSide] = useState<'a' | 'b' | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [savedPair, setSavedPair] = useState(false);

  const runComparison = useCallback(async () => {
    if (!prompt.trim() || !modelA || !modelB) return;
    setRunning(true);
    setError(null);
    setResults(null);
    setPickedSide(null);
    setSavedPair(false);
    setPickError(null);

    try {
      const res = await fetch('/api/ab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), modelA, modelB }),
      });
      const data = await res.json() as ABResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setRunning(false);
    }
  }, [prompt, modelA, modelB]);

  const pickWinner = useCallback(async (side: 'a' | 'b') => {
    if (!results || !prompt.trim()) return;
    setPicking(side);
    setPickError(null);

    const winner = results[side];
    const loser = results[side === 'a' ? 'b' : 'a'];

    try {
      const res = await fetch('/api/ab/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userContent: prompt.trim(),
          winnerContent: winner.content,
          winnerModel: winner.model,
          loserModel: loser.model,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPickedSide(side);
      setSavedPair(true);
    } catch (err) {
      setPickError(err instanceof Error ? err.message : 'Failed to save pick');
    } finally {
      setPicking(null);
    }
  }, [results, prompt]);

  const reset = () => {
    setResults(null);
    setPickedSide(null);
    setSavedPair(false);
    setPickError(null);
    setError(null);
  };

  return (
    <div className="ab-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ab-card">
        {/* Header */}
        <div className="ab-header">
          <h2 className="ab-title">A/B Model Comparison</h2>
          <p className="ab-subtitle">Compare two models on the same prompt. Pick the winner to save as a training pair.</p>
          <button type="button" className="ab-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Config row */}
        <div className="ab-config">
          <div className="ab-field">
            <label className="ab-label">Model A</label>
            <select className="ab-select" value={modelA} onChange={(e) => setModelA(e.target.value)} disabled={running}>
              {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="ab-vs">vs</div>
          <div className="ab-field">
            <label className="ab-label">Model B</label>
            <select className="ab-select" value={modelB} onChange={(e) => setModelB(e.target.value)} disabled={running}>
              {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Prompt */}
        <div className="ab-prompt-area">
          <label className="ab-label">Prompt</label>
          <textarea
            className="ab-textarea"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt to compare both models on…"
            disabled={running}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.metaKey) void runComparison();
            }}
          />
        </div>

        {/* Actions */}
        <div className="ab-actions">
          {results && !running && (
            <button type="button" className="ab-btn-secondary" onClick={reset}>
              New Comparison
            </button>
          )}
          <button
            type="button"
            className="ab-btn-primary"
            onClick={() => void runComparison()}
            disabled={running || !prompt.trim() || !modelA || !modelB}
          >
            {running ? (
              <>
                <span className="ab-spinner" />
                Comparing…
              </>
            ) : results ? 'Re-run' : 'Compare'}
          </button>
        </div>

        {error && <p className="ab-error">{error}</p>}

        {/* Results */}
        {results && (
          <div className="ab-results">
            {(['a', 'b'] as const).map((side) => {
              const res = results[side];
              const isPicked = pickedSide === side;
              const isOther = pickedSide !== null && pickedSide !== side;
              return (
                <div
                  key={side}
                  className={`ab-pane ${isPicked ? 'ab-pane--winner' : ''} ${isOther ? 'ab-pane--loser' : ''}`}
                >
                  <div className="ab-pane__header">
                    <span className="ab-pane__label">Model {side.toUpperCase()}</span>
                    <span className="ab-pane__model">{res.model}</span>
                    <span className="ab-pane__latency">{(res.latencyMs / 1000).toFixed(1)}s</span>
                    {isPicked && <span className="ab-pane__badge ab-pane__badge--win">Winner ✓</span>}
                    {isOther && <span className="ab-pane__badge ab-pane__badge--lose">Not picked</span>}
                  </div>
                  <div className="ab-pane__content">{res.content}</div>
                  {!pickedSide && (
                    <button
                      type="button"
                      className="ab-pick-btn"
                      onClick={() => void pickWinner(side)}
                      disabled={picking !== null}
                    >
                      {picking === side ? (
                        <><span className="ab-spinner" /> Saving…</>
                      ) : (
                        `👍 Pick ${side.toUpperCase()} as winner`
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pickError && <p className="ab-error">{pickError}</p>}

        {savedPair && (
          <div className="ab-saved">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Saved as training pair — will appear in Settings → Training export.
          </div>
        )}
      </div>
    </div>
  );
}
