import { useState } from 'react';
import type { FormEvent } from 'react';
import { signIn } from '../lib/access';
import './AccessGate.css';

/** Shown instead of the app when the server requires an access token. */
export function AccessGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    const ok = await signIn(token.trim());
    setBusy(false);
    if (ok) onSignedIn();
    else setError('That token was not accepted.');
  };

  return (
    <div className="access-gate">
      <form className="access-gate__card" onSubmit={submit}>
        <h1 className="access-gate__title">Vanaila Chat</h1>
        <p className="access-gate__hint">
          This server requires an access token. Use the value of <code>VANAILA_ACCESS_TOKEN</code> it was started with.
        </p>
        <input
          className="access-gate__input"
          type="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Access token"
          placeholder="Access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {error && <p className="access-gate__error" role="alert">{error}</p>}
        <button className="access-gate__button" type="submit" disabled={busy || !token.trim()}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
