/**
 * Browser side of the optional access token (VANAILA_ACCESS_TOKEN). The
 * server keeps the token in an HttpOnly cookie after sign-in, so ordinary
 * fetch calls need no changes.
 */

export async function signIn(token: string): Promise<boolean> {
  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Signs in from a `?token=` link (then strips it from the address bar) and
 * reports whether the app may load. An unreachable or older backend counts as
 * no token required, so the app still renders its own connection errors.
 */
export async function ensureAccess(location: Location = window.location, history: History = window.history): Promise<boolean> {
  const url = new URL(location.href);
  const linkToken = url.searchParams.get('token');
  if (linkToken) {
    url.searchParams.delete('token');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    await signIn(linkToken);
  }

  try {
    const response = await fetch('/api/auth/status');
    if (!response.ok) return true;
    const status = (await response.json()) as { required?: boolean; authenticated?: boolean };
    return !status.required || Boolean(status.authenticated);
  } catch {
    return true;
  }
}
