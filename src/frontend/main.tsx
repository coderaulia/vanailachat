import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AccessGate } from './components/AccessGate';
import { ensureAccess } from './lib/access';
import { isTauri } from './lib/api';
import './styles/tokens.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

function renderApp() {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// The desktop app talks to Rust over IPC, so there is no HTTP API to unlock.
if (isTauri) {
  renderApp();
} else {
  void ensureAccess().then((allowed) => {
    if (allowed) renderApp();
    else root.render(<AccessGate onSignedIn={renderApp} />);
  });
}
